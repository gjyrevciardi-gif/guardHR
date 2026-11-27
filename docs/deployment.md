# Deployment

The development stack (`docker-compose.yml`) is not meant for the internet: it publishes the API and database ports and ships a mail catcher. Production adds an overlay and one reverse proxy.

## Production checklist

1. **Server**: Docker with Compose >= 2.24, a DNS name, and a TLS certificate. Camera, microphone and screen share only work on HTTPS.
2. **Certificates**: put `fullchain.pem` and `privkey.pem` in `deploy/certs/` (git-ignored) or point `TLS_CERT_DIR` at your certificate directory.
3. **`.env`** (never commit it):

   ```env
   APP_ENV=production            # set by the overlay; shown for clarity
   PUBLIC_APP_URL=https://hr.example.com
   POSTGRES_PASSWORD=<strong>
   JWT_SECRET=<python -c "import secrets; print(secrets.token_hex(32))">
   SECRETS_ENCRYPTION_KEY=<python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())">   # back it up apart from the database
   INITIAL_ADMIN_EMAIL=you@example.com
   INITIAL_ADMIN_PASSWORD=<strong, not ChangeMe123!>
   SMTP_HOST=smtp.example.com    # a real SMTP relay; there is no mail catcher in production
   SMTP_PORT=587
   SMTP_USE_TLS=true
   SMTP_USERNAME=...
   SMTP_PASSWORD=...
   SMTP_FROM_EMAIL=NemoGuardHR <no-reply@example.com>
   ```

4. **Start**:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
   ```

   The overlay removes every published port except Nginx (80 redirects to 443), serves the API under `/api` on the same origin as the UI, and enables `TRUST_PROXY_HEADERS` (Nginx *overwrites* `X-Forwarded-For`, so the value the backend sees is trustworthy).
5. **Test the mail relay.** Invitations, email codes and password resets depend on it, and a broken one only shows up as a candidate who never gets a code:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml exec backend python -m app.mailcheck you@example.com
   ```

   It prints `OK` or the relay's own error and exits non-zero on failure. "Accepted" is not "delivered": check that the message arrived and was not filed as spam (set up SPF/DKIM for the `SMTP_FROM_EMAIL` domain with your provider).
6. **First login** with the initial admin, **turn on two-step verification** in Settings (in production the API refuses administrator features until you do; see `docs/account-security.md`), then create HR accounts with `POST /api/auth/users` (`role: "hr"`). Public registration is closed in production unless you set `REGISTRATION_ENABLED=true`.

With `APP_ENV=production` the backend **refuses to start** when `JWT_SECRET` is shorter than 32 characters or still a placeholder, when `SECRETS_ENCRYPTION_KEY` is missing or malformed, when `INITIAL_ADMIN_PASSWORD` is the default, or when `PUBLIC_APP_URL` is not https.

## TURN (candidates behind strict NATs)

The room uses WebRTC. STUN alone fails for symmetric NATs and many corporate networks, so production needs a TURN relay. Two ways:

- **Your own coturn (bundled).** `docker-compose.prod.yml` has a `turn` service behind the `turn` profile and `deploy/turnserver.conf` configures it. Set `TURN_URLS` (comma-separated `turn:`/`turns:` URLs) and `TURN_SECRET` (random, at least 32 characters in production; the backend refuses to start with only one of the two) and start with `--profile turn`. The backend then adds a TURN entry to `/api/rtc-config` with a credential that expires after 8 hours, derived from the secret with HMAC-SHA1 (coturn's `use-auth-secret` scheme), so no password is ever published. The full procedure, ports and checks are in [staging.md](staging.md).
- **An external relay.** List it in `ICE_SERVERS` (JSON, read by the backend at runtime and served from `/api/rtc-config`, so no frontend rebuild is needed):

  ```env
  ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"user","credential":"secret"}]
  ```

  Whatever is written there is visible to anyone who opens a call link, so use a provider's short-lived credentials rather than a shared password.

## Operations

| Topic | What happens |
|---|---|
| Migrations | The backend container runs `alembic upgrade head` on every start. To run it by hand: `docker compose exec backend alembic upgrade head`. |
| Retention | An in-process job purges expired data when the API starts and then every `RETENTION_PURGE_INTERVAL_HOURS` (default 24; `0` disables it). Run `python -m app.retention` from cron instead if you prefer. A call still `in_progress` `ABANDONED_SESSION_HOURS` (default 12) after it started is closed as abandoned (audit entry `session.auto_closed`, `ended_at` = last event or start time) so it ages out like any finished call; links that expired before the retention cutoff without ever running lose their stored consent IP. See the README for what is deleted. |
| Deleting data | `DELETE /api/sessions/{id}` and `DELETE /api/tests/{id}` hard-delete, including candidate PII left in audit entries. |
| Invites | Sent in a background task after the response. The outcome is an audit entry (`participant.invite.email_sent` / `email_failed`); SMTP errors are written to the server log only. |
| Health | `GET /api/health` runs `SELECT 1` and returns `{"status": "ok", "database": true, "vision": true|false, "frames": {...}}`; with the database unreachable it answers `503` and `{"status": "degraded", "database": false}` (the driver's error text is only logged). The backend image's Docker healthcheck therefore turns *unhealthy* during a database outage, and an external uptime monitor pointed at this URL sees it too. The frame counters are described under *Known limits*. |
| Backups | `./deploy/backup.sh`, see [Backups](#backups). Video and audio are never stored. |
| Error reporting | Optional, `SENTRY_DSN`; see [Error reporting](#error-reporting-sentry). |

## Backups

`deploy/backup.sh` writes a compressed `pg_dump` to `backups/` (override with `BACKUP_DIR`), reads the archive back to prove it is not truncated, and deletes dumps older than `KEEP_DAYS` (default 14). The file is created owner-only and written under a temporary name, so a failed run never leaves something that looks like a backup. It exits non-zero on any failure. Run it from cron on the host:

```cron
23 2 * * * cd /srv/nemoguard && ./deploy/backup.sh >> backups/backup.log 2>&1
```

- **A copy on the same server is not a backup.** Copy `backups/` to another machine or storage account (`rclone`, `rsync` over SSH), and alert if the newest file there is older than a day.
- **A dump is as sensitive as the database.** It holds candidate names, emails, answers and review notes, and the two-step verification secrets, which are encrypted with a key the dump does not contain (see [account-security.md](account-security.md#encrypting-the-secret)); keep that key off the backup storage. Keep the off-host copy encrypted and readable only by the people who may restore it.
- **Backups outlive the retention purge.** Retention and `DELETE /api/sessions/{id}` act on the live database at once; the same data stays in older dumps until they are pruned, up to `KEEP_DAYS` + 1 days. Say so in your privacy notice, and keep `KEEP_DAYS` no longer than you can justify. To erase one person from backups sooner you must delete those dumps (or restore one, delete the person, and dump again).
- **Secrets are not in the dump.** Keep `.env` safe separately. Restoring with a different `JWT_SECRET` works, but invalidates sessions, reset links and recovery codes.
- Video and audio are never stored, so there is nothing else to back up.

**Restore drill.** Do this once before you rely on the backups and then every few months. `deploy/restore-drill.sh` restores the newest dump (or the one you name) into a scratch database, checks that it holds users and a migration version, prints it next to the live database, and drops the scratch copy again:

```bash
./deploy/restore-drill.sh                                          # the newest dump in ./backups
./deploy/restore-drill.sh backups/nemoguard-20260101T022300Z.dump  # or a specific one
```

It fails (non-zero) when there is no dump, when the newest dump is older than 36 hours (`MAX_AGE_HOURS`; the nightly backup has stopped, which is the thing worth finding out), when the restore errors, or when the restored copy is empty. It only reads the live database, and it refuses to run if `SCRATCH_DB` (default `restore_check`) is the live database's name. A dump that merely reads back (what `backup.sh` checks) is not the same as one that restores, which is why this exists.

Verified here against a real PostgreSQL with a stand-in for `docker compose exec` (success, no dump, a stale newest dump, a corrupt dump, an empty dump, and the live-database refusal); not against your compose stack, so run it once there. The two rows printed can differ by whatever changed since the dump; a restored copy with far fewer users or sessions than you expect is the sign to look closer. **A real restore** after losing the database: start only `db`, `createdb` the (empty) database, `pg_restore --no-owner -d <db>` the dump as above, then start the rest; the backend runs `alembic upgrade head` on start, so a dump from an older release is migrated.

## Error reporting (Sentry)

Set `SENTRY_DSN` and unhandled errors, and anything logged at error level, are sent to that Sentry project. Blank (the default) sends nothing and the SDK stays idle. What is sent is deliberately narrow, because the app handles candidate data: the stack trace, the exception type and message, the release and the server name. Not sent: the request (URL, headers, cookies, body, so join links and candidate answers stay out), the signed-in user and IP address, breadcrumbs and local variables (`app/monitoring.py`, covered by `tests/test_operations.py`). Anything that looks like an email address in an error message is replaced by `[email]`, because an SMTP failure can quote the recipient.

- **Sentry becomes a processor.** Error text still leaves your server, so list the provider in your privacy notice and pick a region that fits your obligations (EU data residency is an option when you create the Sentry project).
- Only the **backend** reports. Browser errors are not sent, because a browser SDK would attach the page URL, which contains the candidate's join token.
- Errors that were caught and answered with a `4xx` are not reported; only crashes (`5xx`) and error-level log lines are. A database outage shows up through `/api/health`, not as a stream of Sentry events.

## Upgrading from the previous release

Migration `0004` adds `integrity_events.severity` (backfilled from the event type) and the heartbeat columns on `interview_sessions`; it is additive and downgradable, existing review statuses are not recomputed, and calls that began earlier report coverage as unknown rather than as a failure (see `docs/signals.md`). Migration `0003` only adds an index on `audit_logs(session_id, action, created_at)` and can be downgraded. Dependency pins moved (FastAPI 0.165 / Starlette 1.x, PyJWT 2.15, python-multipart 0.0.31, pypdf 6.21, Next.js 15.5.29); rebuild both images rather than reusing cached layers. Calls abandoned before the upgrade are closed by the first purge after the API starts.

Migration `0005` adds the optional email-code columns on `interview_sessions` (`verify_candidate_email` defaults to false, so existing calls start exactly as before); it is additive and downgradable. Calls created with the option need a working SMTP relay, because the candidate cannot start without the emailed code (see `docs/candidate-checks.md`).

Migration `0006` adds one nullable column, `interview_sessions.host_notes`, for the host's private working notes; it is additive and downgradable (downgrading discards the notes). The notes are only returned on the call detail endpoint to the call's owner, never to the candidate, and, like reviews, they are kept until the host deletes the call: the retention purge does not touch them, so say so in your own privacy notice if hosts will write about candidates.

The invitation email is now written in Albanian with a short English line, names the host, shows the deadline in Kosovo time (`Europe/Belgrade`; it falls back to UTC on images without tzdata) and mentions screen sharing, the test and the email code only when that call uses them. The subject changed from `NemoGuardHR invite: …` to `Ftesë për call: …`, so adjust any mail filters that match the old subject.

Migration `0007` adds seven columns to `users` for account security (`token_version`, the reset-link hash and expiry, and the two-step verification secret, flag, last used step and recovery-code hashes); it is additive and downgradable (downgrading discards secrets and recovery codes, so users enrol again). Nobody is signed out by the upgrade: sessions issued before it count as version 0, every user's starting version. What changes for operators:

- **Administrators must enrol before using administrator features in production** (`REQUIRE_ADMIN_MFA` blank = on in production, off in development; `true`/`false` overrides). In practice the only administrator-only route today is `POST /api/auth/users`. An administrator can still sign in and reach Settings to enrol, so this cannot lock anyone out. HR users are never forced.
- **Password reset emails** go through the same SMTP relay as invitations. Without a working relay the reset page says "sent" (it must not reveal which emails exist) but nothing arrives; the failure is an audit entry (`auth.password_reset_email_failed`) and a line in the server log. Links use `PUBLIC_APP_URL`.
- **Changing `JWT_SECRET`** already signed everyone out; it now also invalidates outstanding reset links and every recovery code (they are keyed hashes). Authenticator codes keep working because the TOTP secret is stored as is.
- **Rate limits are per API process** (reset requests 5 per hour per address and 3 per hour per email; code guesses 5 per 5 minutes per account), like the existing login limits.

Migration `0009` adds the `exam_attempts` table and the time limit and shuffle settings for public exams (see [exam-protection.md](exam-protection.md#upgrading)); it is additive and downgradable, and existing tests behave as before. Public exams now store the candidate's name, email and IP **when they start**, not only when they submit, and the retention purge removes those attempts. An exam page open during the upgrade cannot submit, so deploy between exams.

Migration `0010` adds the email code for public exams: `tests.verify_candidate_email` (default off, so existing tests behave as before), the `exam_email_codes` table, and `email_verified_at` on attempts and submissions (see [exam-protection.md](exam-protection.md#email-code-the-hosts-option)); it is additive and downgradable. A test with the option on needs a working SMTP relay (the `SMTP_*` settings above): with a broken relay nobody can start it, and the candidate is told the code could not be sent. Test the relay before turning the option on for a real exam. The table holds the addresses of everyone who asked for a code, and the retention purge removes them like attempts.

Migration `0011` adds `exam_attempts.draft_answers` and `draft_saved_at`: the answers a candidate has written so far, saved while they work and emptied on submit (see [exam-protection.md](exam-protection.md#saved-answers)). It is additive and downgradable. A candidate who never submits leaves a partial draft in their attempt; it is removed with the attempt by the retention purge, so say so in your own privacy notice, and note that backups hold it until pruned.

Migration `0012` encrypts the two-step verification secrets already stored (see [account-security.md](account-security.md#encrypting-the-secret)). **Set `SECRETS_ENCRYPTION_KEY` before deploying it**: the production overlay will not start without one, and the migration encrypts with the key it finds. Back the key up apart from the database; losing it means every enrolled user needs a manual two-step reset. It is the one new required setting, and it adds one dependency (`cryptography`), so rebuild the backend image. Downgrading decrypts the secrets back to plain text and needs the key.

Migration `0013` adds `tests.invited_emails`, the optional list of addresses allowed to take an exam that checks email (see [exam-protection.md](exam-protection.md#email-code-the-hosts-option)). Existing tests get an empty list and keep letting anyone with the link ask for a code. It is additive and downgradable. The list holds email addresses the host typed; it is kept with the test and deleted with it, so mention it in your own privacy notice if hosts will use it, and note that backups hold it until pruned.

The interface has a light and a dark theme (a toggle in every header; the choice is kept in the browser's local storage). Nothing server-side changed for this, and no new environment variable is needed.

## Known limits (deliberate)

- **One backend worker.** WebSocket rooms and rate-limit counters live in process memory, and the Dockerfile pins `--workers 1`. Running several workers or replicas needs Redis pub/sub for signaling and shared rate-limit counters, or sticky routing by room token.
- **Rate limits are per client IP**, so behind a proxy `TRUST_PROXY_HEADERS` must be on (the production overlay does this); otherwise every client shares the proxy's address.
- **Sessions are stateless JWTs.** Plain logging out clears the cookie but does not revoke a token that was copied before; tokens expire after `JWT_EXPIRE_MINUTES` (default 480). "Dil nga të gjitha pajisjet", a password change and a password reset do revoke every token at once (`docs/account-security.md`).
- **A running call stays valid after `expires_at`.** The expiry only blocks starting; an in-progress session continues until it finishes.
- **Duplicate public submissions** to a plain form are prevented per email with an application check, not a database constraint, so two simultaneous submissions with the same email can both succeed. A public exam is stricter: one attempt per test and email is a database constraint, and submitting locks the attempt row.
- **The in-progress retention job runs in the API process.** With several replicas it would run on each; it is idempotent, but a single cron is cleaner at that point.
- **Frame analysis is serialised.** Phone/extra-person detection runs one frame at a time (Ultralytics models are not thread-safe) in a thread, so it cannot stall signaling. A frame that waits more than 3 s gets `503` and is dropped; the client treats vision as best-effort and retries on its next 5 s tick. Many simultaneous candidates on a slow CPU will therefore be analysed less often; `/api/health` counts what happened: `frames.analyzed` (frames the detector processed), `frames.dropped` (frames answered `503` because the detector stayed busy), and `frames.inference_ms_avg` / `inference_ms_max` (time from handing a frame to the detector until its result, `null` until the first frame). They count since the process started, so they reset on every restart and deploy. The image runs one worker, so they cover the whole host. Frames from a deployment without the CV libraries, and frames rejected as invalid images, are not counted. Rule of thumb for sizing: if `dropped` keeps growing relative to `analyzed` during real calls, the host is too slow for that many simultaneous candidates. The counters are aggregate numbers with no identifiers; if you do not want them public, have the reverse proxy serve `/api/health` without the body or restrict it to your monitoring.
- Phone/extra-person detection needs the `INSTALL_CV=true` image and the `yolo11n.pt` weights (downloaded on first use unless `YOLO_MODEL_PATH` points to a local file).

## Privacy page

`/privacy` describes what the software does. The consent page shows the host's name and the retention period from the database. Before real candidates use a deployment, name the operator in `.env` (no rebuild; restart the frontend):

```env
OPERATOR_NAME=Your Company L.L.C., Rr. Example 1, Ferizaj
OPERATOR_CONTACT=privacy@example.com
OPERATOR_LEGAL_BASIS=<your own wording: what lets you process this data, in Albanian>
```

With a name and a contact set, `/privacy` shows an "Operatori i këtij sistemi" section with them and with the legal basis, if you wrote one. Without them the section is absent, and `deploy/check-staging.sh` reports it. The software cannot know who you are or which legal basis applies, and it does not invent either: write the legal basis yourself, ideally with a lawyer, and list the providers that see candidate data (the SMTP relay, Sentry if you use it, and your TURN host). Nothing on the page is legal advice.

The face-detection model and its WASM runtime are served from the app itself (`frontend/public/mediapipe/`, see the README there), so the candidate's browser makes no CDN request. Candidate pages load no third-party scripts; the only third party a candidate's IP reaches is the STUN/TURN server in `ICE_SERVERS` (Google STUN by default; point it at your own relay, as in [staging.md](staging.md), to remove even that).

## Upgrading from the pre-Alembic version

1. Back up the database.
2. Deploy the new images. On start, `alembic upgrade head` runs migration `0001` (idempotent: it creates what is missing and adds the columns the old startup code used to add, including a wider `event_type` check) and `0002` (candidates become per-HR-user; a candidate shared by several HR users is split, candidates without any session are deleted). `0002` cannot be reversed automatically.
3. HR users sign in again; the browser drops the old `localStorage` token.
4. If you used the old `database/schema.sql` mount, it is gone: Alembic is the single source of the schema.
5. **Review the accounts that came with the old database.** The old seed script added a new `admin` every time `INITIAL_ADMIN_EMAIL` changed, so a long-lived database can hold forgotten admins that still have a default password. List them and deactivate what you do not recognise (inactive users cannot log in, and their history is kept):

   ```sql
   SELECT email, role, is_active FROM users ORDER BY created_at;
   UPDATE users SET is_active = false WHERE email IN ('old-admin@example.com');
   ```
