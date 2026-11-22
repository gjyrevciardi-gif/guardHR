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
5. **First login** with the initial admin, **turn on two-step verification** in Settings (in production the API refuses administrator features until you do; see `docs/account-security.md`), then create HR accounts with `POST /api/auth/users` (`role: "hr"`). Public registration is closed in production unless you set `REGISTRATION_ENABLED=true`.

With `APP_ENV=production` the backend **refuses to start** when `JWT_SECRET` is shorter than 32 characters or still a placeholder, when `INITIAL_ADMIN_PASSWORD` is the default, or when `PUBLIC_APP_URL` is not https.

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
| Health | `GET /api/health` returns `{"status": "ok", "vision": true|false, "frames": {...}}` (the frame counters are described under *Known limits*). The backend image has a Docker healthcheck. |
| Backups | Back up the `interviewguard_data` volume (PostgreSQL). Video and audio are never stored. |

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

The interface has a light and a dark theme (a toggle in every header; the choice is kept in the browser's local storage). Nothing server-side changed for this, and no new environment variable is needed.

## Known limits (deliberate)

- **One backend worker.** WebSocket rooms and rate-limit counters live in process memory, and the Dockerfile pins `--workers 1`. Running several workers or replicas needs Redis pub/sub for signaling and shared rate-limit counters, or sticky routing by room token.
- **Rate limits are per client IP**, so behind a proxy `TRUST_PROXY_HEADERS` must be on (the production overlay does this); otherwise every client shares the proxy's address.
- **Sessions are stateless JWTs.** Logging out clears the cookie but does not revoke a token that was copied before; tokens expire after `JWT_EXPIRE_MINUTES` (default 480).
- **A running call stays valid after `expires_at`.** The expiry only blocks starting; an in-progress session continues until it finishes.
- **Duplicate public submissions** are prevented per email with an application check, not a database constraint, so two simultaneous submissions with the same email can both succeed.
- **The in-progress retention job runs in the API process.** With several replicas it would run on each; it is idempotent, but a single cron is cleaner at that point.
- **Frame analysis is serialised.** Phone/extra-person detection runs one frame at a time (Ultralytics models are not thread-safe) in a thread, so it cannot stall signaling. A frame that waits more than 3 s gets `503` and is dropped; the client treats vision as best-effort and retries on its next 5 s tick. Many simultaneous candidates on a slow CPU will therefore be analysed less often; `/api/health` counts what happened: `frames.analyzed` (frames the detector processed), `frames.dropped` (frames answered `503` because the detector stayed busy), and `frames.inference_ms_avg` / `inference_ms_max` (time from handing a frame to the detector until its result, `null` until the first frame). They count since the process started, so they reset on every restart and deploy. The image runs one worker, so they cover the whole host. Frames from a deployment without the CV libraries, and frames rejected as invalid images, are not counted. Rule of thumb for sizing: if `dropped` keeps growing relative to `analyzed` during real calls, the host is too slow for that many simultaneous candidates. The counters are aggregate numbers with no identifiers; if you do not want them public, have the reverse proxy serve `/api/health` without the body or restrict it to your monitoring.
- Phone/extra-person detection needs the `INSTALL_CV=true` image and the `yolo11n.pt` weights (downloaded on first use unless `YOLO_MODEL_PATH` points to a local file).

## Privacy page

`/privacy` describes what the software does. The consent page shows the host's name and the retention period from the database. Before real candidates use a deployment, the operator should add their own legal entity, contact address and legal basis to `frontend/app/privacy/page.tsx`: the page does not name an operator because the software cannot know it, and nothing in it is legal advice.

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
