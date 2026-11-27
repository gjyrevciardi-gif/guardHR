# Account security

Hosts and administrators sign in with an email and a password. Three things protect that account beyond the password: a way to sign out everywhere, a password reset by email, and two-step verification with an authenticator app. Candidates have no account, so none of this applies to them.

## Sessions and signing out everywhere

A session is a signed token (HttpOnly cookie, or a Bearer token for API clients) that carries the account's `token_version`. The check runs in one place, `user_from_token`, which both HTTP routes and the WebSocket handshake of the live room use. Raising the version makes every token issued before it stop working, on the next request or the next connection.

| Action | Effect on sessions |
|---|---|
| `POST /api/auth/logout-everywhere` (Settings → "Dil nga të gjitha pajisjet") | Every session ends, including the one that asked. Audit entry `auth.sessions_revoked`. |
| `POST /api/auth/password` (Settings → Fjalëkalimi) | Needs the current password. Every other device is signed out; the device that asked gets a fresh session. `auth.password_changed`. |
| Password reset (below) | Every session ends. `auth.password_reset`. |
| `POST /api/auth/logout` | Only clears this browser's cookie, as before. The token itself stays valid until it expires (8 hours by default). |

A call already open in a host's browser keeps its WebSocket until it closes; the host is signed out when the socket reconnects or the next request is made.

Tokens issued before migration `0007` have no version claim and count as version 0, which is every account's starting version, so the upgrade signs nobody out.

## Password reset

1. The login page links to `/forgot-password`. `POST /api/auth/password-reset/request` always answers `202 {"status": "accepted"}` whether or not the address has an account, so it cannot be used to discover which emails exist. Only active accounts get a message.
2. The email (Albanian with an English line, sent in a background task through the same SMTP relay as invitations) carries `PUBLIC_APP_URL/reset-password?token=…`. The token is 256 random bits; the database stores only its keyed hash (HMAC-SHA-256 with `JWT_SECRET`). It expires after 60 minutes, works once, and a newer request replaces an older link.
3. `POST /api/auth/password-reset/confirm` sets the new password, clears the token and signs every device out. Unknown, expired and already used links all get the same `400`.
4. The page that opens from the link sends `Referrer-Policy: no-referrer` through a meta tag and is marked `noindex`.
5. The owner sees `auth.password_reset_requested` (with the requester's IP) in their own audit log. A reset does **not** turn two-step verification off: someone who controls the mailbox still needs the second factor.

Limits: 5 requests per hour per client IP, 3 per hour per address, 10 confirmations per hour per client IP. A failed delivery is `auth.password_reset_email_failed` plus a server log line; the user still sees the neutral message.

## Two-step verification (TOTP)

Standards-based (RFC 6238: HMAC-SHA-1, 30 s steps, 6 digits), so it works with Google Authenticator, Microsoft Authenticator, Aegis, 1Password and similar. The code arithmetic uses the standard library only (`app/mfa.py`); encrypting the stored secret uses `cryptography` (see below).

**Enrolling** (Settings → Verifikimi në dy hapa): `POST /api/auth/mfa/setup` returns a fresh secret and an `otpauth://` URI; the page shows the secret in groups and the link. It only counts once `POST /api/auth/mfa/enable` has seen a valid code from it, and that call returns **eight single-use recovery codes, once**. Only their keyed hashes are stored.

**Signing in:** `POST /api/auth/login` checks the password first. For an account with two-step verification and no `code` it answers `401` with the detail `mfa_required` and sets no cookie; the login page then asks for the code. Asking reveals nothing to someone without the password. The code can be an authenticator code or a recovery code (any spelling of the dash and case); a recovery code is spent when used.

- A code is accepted for the current 30 s step and one step either side (clock drift), and never twice: the last accepted step is stored and the same code, or an older one, is refused.
- Wrong codes are limited to 5 per 5 minutes per account. A wrong code after a right password is a `auth.login_failed` entry in the owner's log (reason `second_factor`).
- **Turning it off** needs the password and a current code or recovery code, so a stolen session alone cannot remove the second step. `auth.mfa_enabled`, `auth.mfa_disabled`.

### Administrators

`REQUIRE_ADMIN_MFA` (blank = on in production, off in development; `true`/`false` overrides) makes `require_admin` answer `403` until an administrator has two-step verification on. Today the only administrator-only route is `POST /api/auth/users`. `GET /api/auth/me` returns `mfa_enabled` and `mfa_setup_required` (an administrator who still has to enrol); the Settings page shows an explanation in that case. An administrator can always sign in and reach Settings, so the requirement cannot lock anyone out. HR users are never forced; they can turn it on themselves.

## Encrypting the secret

`users.mfa_secret` is stored as `enc1:` + a Fernet token (AES-128-CBC with an HMAC-SHA-256, from the `cryptography` package), written and read by `app/secrets_box.py` through the column type, so the rest of the code only ever sees the plain secret.

- **Generate a key** once: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`, and set it as `SECRETS_ENCRYPTION_KEY`. **In production the API refuses to start without one** (and with a malformed one). In development a blank key stores the secret as plain text, as before.
- **Back the key up separately from the database backups** (a password manager or secret store). Without it nobody who enrolled can sign in with a code: the secret cannot be decrypted, and the API says so (`SECRETS_ENCRYPTION_KEY does not match…`) instead of treating the code as wrong. Recovery is the manual database edit described below.
- **Rotating the key:** put the new key first and keep the old one after a comma (`NEW,OLD`), restart, run `python -m app.secrets_box` (re-encrypts every secret with the first key), then drop `OLD` and restart.
- **Upgrading an existing database:** migration `0012` widens the column and encrypts every secret already stored, using the key in the environment the migration runs in (the backend container runs it on start, so set the key first). With no key it only widens the column; run `python -m app.secrets_box` once a key is set. Values written before the key existed stay readable until then. The migration is reversible: the downgrade decrypts back to plain text and needs the key.
- Rotating `JWT_SECRET` does not affect this key, and changing this key does not sign anybody out.

## Known limits

- **The TOTP secret is encrypted, with a key that lives next to the app, not in the database.** A code can only be checked with the secret, so it has to be readable to the API: `SECRETS_ENCRYPTION_KEY` (a Fernet key, see [Encrypting the secret](#encrypting-the-secret)) is in the API's environment. A leaked dump, a stolen backup or read-only access to the `users` table no longer gives the secret; someone who can read the API's environment, or run code in it, still can. It does not protect the recovery codes (they are one-way hashes already) or the password (Argon2).
- **No QR code.** Drawing one needs a dependency; the page shows the secret and an `otpauth://` link instead. Authenticator apps all support manual entry.
- **No recovery-code regeneration** and no "which recovery codes are left" view. Turn two-step verification off and on again to get a new set.
- **No administrator-initiated reset of someone else's second factor.** An HR user who loses both the phone and the recovery codes needs a database edit (clear `mfa_enabled`, `mfa_secret`, `mfa_recovery_hashes`).
- **Rate limits are per API process** (in memory), like the login limits. Run one worker or move the counters to Redis (see `app/ratelimit.py`).
- **Timing:** the reset request does slightly more work for an address that has an account than for one that does not (a database write, no mail wait). The per-address and per-IP limits make this impractical to exploit; it is not constant time.
- Rotating `JWT_SECRET` invalidates sessions, outstanding reset links and every recovery code. Authenticator codes keep working (they depend on `SECRETS_ENCRYPTION_KEY`, not on `JWT_SECRET`).
- Failed password attempts for a known account are not shown in that account's own audit log (they are recorded without an owner, as before) so that guessing cannot flood it.

## Tests

`backend/tests/test_account_security.py` (29 tests): revocation for Bearer, cookie and the live-room WebSocket (`test_signaling.py`), password change and its failures, the whole reset flow (neutral answer, single use, expiry, replacement, hash-only storage, rate limit, email content, failed delivery), TOTP against the RFC 6238 test vector, drift window, replay, recovery codes, disabling, administrator enforcement, and the migration (`test_migrations.py`, PostgreSQL). The browser flow, including every new screen in both themes, was checked with axe; see `docs/accessibility.md`.
