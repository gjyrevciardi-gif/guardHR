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

Standards-based (RFC 6238: HMAC-SHA-1, 30 s steps, 6 digits), so it works with Google Authenticator, Microsoft Authenticator, Aegis, 1Password and similar. Implemented with the standard library only (`app/mfa.py`); there is no new dependency.

**Enrolling** (Settings → Verifikimi në dy hapa): `POST /api/auth/mfa/setup` returns a fresh secret and an `otpauth://` URI; the page shows the secret in groups and the link. It only counts once `POST /api/auth/mfa/enable` has seen a valid code from it, and that call returns **eight single-use recovery codes, once**. Only their keyed hashes are stored.

**Signing in:** `POST /api/auth/login` checks the password first. For an account with two-step verification and no `code` it answers `401` with the detail `mfa_required` and sets no cookie; the login page then asks for the code. Asking reveals nothing to someone without the password. The code can be an authenticator code or a recovery code (any spelling of the dash and case); a recovery code is spent when used.

- A code is accepted for the current 30 s step and one step either side (clock drift), and never twice: the last accepted step is stored and the same code, or an older one, is refused.
- Wrong codes are limited to 5 per 5 minutes per account. A wrong code after a right password is a `auth.login_failed` entry in the owner's log (reason `second_factor`).
- **Turning it off** needs the password and a current code or recovery code, so a stolen session alone cannot remove the second step. `auth.mfa_enabled`, `auth.mfa_disabled`.

### Administrators

`REQUIRE_ADMIN_MFA` (blank = on in production, off in development; `true`/`false` overrides) makes `require_admin` answer `403` until an administrator has two-step verification on. Today the only administrator-only route is `POST /api/auth/users`. `GET /api/auth/me` returns `mfa_enabled` and `mfa_setup_required` (an administrator who still has to enrol); the Settings page shows an explanation in that case. An administrator can always sign in and reach Settings, so the requirement cannot lock anyone out. HR users are never forced; they can turn it on themselves.

## Known limits

- **The TOTP secret is stored as is.** A code can only be checked with the secret, and the project has no encryption-at-rest dependency, so anyone who can read the `users` table can read it. A database leak therefore weakens the second factor (not the password, which is an Argon2 hash). Encrypting the column with a key kept outside the database is the upgrade path.
- **No QR code.** Drawing one needs a dependency; the page shows the secret and an `otpauth://` link instead. Authenticator apps all support manual entry.
- **No recovery-code regeneration** and no "which recovery codes are left" view. Turn two-step verification off and on again to get a new set.
- **No administrator-initiated reset of someone else's second factor.** An HR user who loses both the phone and the recovery codes needs a database edit (clear `mfa_enabled`, `mfa_secret`, `mfa_recovery_hashes`).
- **Rate limits are per API process** (in memory), like the login limits. Run one worker or move the counters to Redis (see `app/ratelimit.py`).
- **Timing:** the reset request does slightly more work for an address that has an account than for one that does not (a database write, no mail wait). The per-address and per-IP limits make this impractical to exploit; it is not constant time.
- Rotating `JWT_SECRET` invalidates sessions, outstanding reset links and every recovery code. Authenticator codes keep working.
- Failed password attempts for a known account are not shown in that account's own audit log (they are recorded without an owner, as before) so that guessing cannot flood it.

## Tests

`backend/tests/test_account_security.py` (29 tests): revocation for Bearer, cookie and the live-room WebSocket (`test_signaling.py`), password change and its failures, the whole reset flow (neutral answer, single use, expiry, replacement, hash-only storage, rate limit, email content, failed delivery), TOTP against the RFC 6238 test vector, drift window, replay, recovery codes, disabling, administrator enforcement, and the migration (`test_migrations.py`, PostgreSQL). The browser flow, including every new screen in both themes, was checked with axe; see `docs/accessibility.md`.
