# Candidate checks: system test and email code

Two steps in the candidate's pre-join panel, before "Hyr në call".

## System check (always available)

A "Testo pajisjen" button runs, in the candidate's browser, with nothing sent to or stored on the server:

| Check | How | Result |
|---|---|---|
| Browser | HTTPS, `getUserMedia`, WebRTC, WebSocket, and `getDisplayMedia` when the host requires screen sharing | pass / fail |
| Camera | opens the chosen camera, shows a preview, passes once a frame has a size | pass / warn / fail with a reason (denied, not found, in use elsewhere) |
| Microphone | opens the chosen microphone and shows a level meter; passes when sound is heard | pass / warn after 8 s of silence / fail |
| Server link | 3 requests to `/api/health`, median time | pass up to 400 ms, warn up to 1.5 s, fail above or unreachable |
| Network for video | gathers ICE candidates against the configured STUN/TURN servers for up to 4 s | pass with `srflx` or `relay`, warn with only local candidates (strict NAT, VPN), fail with none |
| Face monitoring | the self-hosted model file is reachable and WebAssembly exists | pass / warn (the call still works, the host just gets no face signals) |

The check never blocks joining: the consent page says camera and microphone are optional, so a failure is advice ("you can join anyway, but the host may not see or hear you"). The camera and microphone are released as soon as the candidate joins. Each result is shown with an icon and text, not colour alone, and announced to screen readers.

Limits: it tests what the browser reports. It cannot tell whether the picture is the right way up or sharp, and "srflx" means a STUN server answered, not that the host's network will accept the connection. Screen sharing cannot be tested without starting it, so only browser support is checked.

## Email code (host's option, on by default for new calls)

The new-call form has a checkbox "Verifiko email-in e pjesëmarrësit me kod njëpërdorimsh". When it is on:

1. After consent the candidate asks for a code and a 6-digit code is emailed to the invited address (the page shows the address masked, `a**@example.com`).
2. `POST /api/public/sessions/{token}/start` returns 403 until the code has been entered. Everything the candidate does in a call (events, heartbeats, frames, test, WebSocket room) already requires an in-progress call, so this one gate covers them all.
3. The host's session page shows when the email was verified ("Email-i i verifikuar") or that it has not been yet.

Rules (constants in `backend/app/verification.py`):

| Rule | Value |
|---|---|
| Code | 6 digits, valid 10 minutes, single use |
| Wrong guesses | 5 per code, then a new code is needed |
| Resend | 30 s between codes, at most 10 codes per call |
| Stored | only an HMAC of the code (keyed with `JWT_SECRET`, bound to the call); the plain code is never stored or audited |
| Audited | `candidate.verification.code_sent`, `code_failed`, `locked`, `succeeded`, with the candidate's IP |

At most 10 x 5 guesses out of 1,000,000 are possible for one call.

### What it does and does not prove

- It proves the person holding the link can read the mailbox the host typed. A leaked or forwarded link is no longer enough on its own.
- It does **not** prove who the person is. Someone who controls the candidate's mailbox, or a candidate who lets a friend read the code to them, passes. It is not an ID check.
- The code gates the **start** of the call. It is not a login: once a call is verified and started, anyone who has the link can still open it again, because the verification is recorded on the call, not tied to a browser. Binding it to the candidate's browser (a signed cookie issued at verification and required on later requests) is the next step if that matters.
- The host chooses the address. A mistyped address means the real candidate never gets the code; the host has to create a new call.
- Anyone with the link can use up the 10 codes and lock the real candidate out. The host fixes that with a new call. Per-call lockout was judged better than allowing unlimited guesses.
- Sending is synchronous so a failure is reported to the candidate (HTTP 502) and does not start the cooldown; the SMTP error is written to the server log only.

### Operations

- It needs working SMTP (`SMTP_*` in `docs/deployment.md`). With a broken relay, calls with the option on cannot be started. Test the relay before turning on real invitations, or untick the box per call.
- Migration `0005` adds the columns; it is additive and downgradable, and every existing call keeps verification off.
- The API default is off (`verify_candidate_email: false`), so API clients and old scripts behave as before. Only the new-call form ticks it by default.
- The consent page and `/privacy` disclose the code step and that the verification time and IP are kept.
- The email text is Albanian with an English line. Localising invitations and codes properly is a separate item.
