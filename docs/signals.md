# Signals: severity, review queue and monitoring coverage

Everything below is computed by `backend/app/signals.py` from what the candidate's browser reports. The candidate controls that browser, so none of it is proof. It tells the host how much weight a signal, or the absence of one, deserves.

## Severity

Each event gets a severity when it is stored (`integrity_events.severity`: 0 info, 1 low, 2 medium, 3 high).

| Event | Severity |
|---|---|
| `phone_detected`, `multiple_people`, `screen_share_stopped` | high |
| `face_not_visible`, `camera_disabled` | medium |
| `tab_hidden` lasting 30 s or more | medium (low while still open or shorter) |
| `copy_paste` with operation `paste` | medium (copy and cut are low) |
| `fullscreen_exit`, `multiple_monitors` | low (`multiple_monitors` is false-positive prone: docks, mirrored displays) |
| `window_resized`, `connection_interruption` | info |

## Review queue

A call moves from `No events detected` to `Requires review` when it has **one high**, **two medium** or **six low** signals (`REVIEW_HIGH`, `REVIEW_MEDIUM`, `REVIEW_LOW`). Info signals never count. This is an assumption, not a measured threshold: tune the constants. It only ever moves forward; a review the host has saved is never reset by later events.

Until the rule trips, the host still sees what exists: the badge reads "Sinjal për t'u parë" (one medium signal) or "Vetëm sinjale të vogla" (low or info only) instead of a bare `No events detected`. The `review_status` values themselves are unchanged.

## One tab switch, one event

The browser posts a `tab_hidden` event when the candidate leaves (so the host sees it live) and closes it with `PATCH /api/public/sessions/{token}/events/{id}` when they return, which fills in `ended_at` and `duration_seconds` and re-evaluates severity. An event can be closed once. The host's live room gets an `integrity-event-closed` message.

## Monitoring coverage

The browser sends `POST /api/public/sessions/{token}/heartbeat` every 10 s with whether face detection is running. The server adds the time since the previous heartbeat to `monitored_seconds` when that gap is at most 45 s (`HEARTBEAT_MAX_GAP_SECONDS`); a longer silence counts as one `monitor_gaps` and adds nothing. Time is the server's, not the client's.

The API returns `monitoring` on every session:

| Field | Meaning |
|---|---|
| `coverage_percent` | monitored time ÷ call length (to `ended_at`, or to now while in progress), capped at 100 |
| `face_percent` | the same for time with face detection running |
| `gaps`, `last_seen_at` | silences over 45 s; last heartbeat |
| `quality` | `good` (80% or more), `partial`, `none` (no heartbeat counted), `unknown` |

`unknown` covers calls under 30 s, calls not started, and calls that began before this feature existed (their coverage columns are NULL, so they are not reported as failures). While a call is in progress and the last heartbeat is more than 60 s old, the host page warns that the candidate may have closed the page.

A call with no heartbeats and no events used to read as clean. Now the host page says the monitor may not have run, and the dashboard badge reads "Pa sinjale · monitorim jo i plotë".

## Abandoned calls

A call whose last heartbeat (or start, if none) is older than `ABANDONED_SESSION_HOURS` is closed by the retention job at the time of its last sign of life. A long call that keeps sending heartbeats is never closed.

## Limits

- Heartbeats and events can be forged by anyone who has the link and can script requests. Coverage proves that *something* reported, not that the real monitor ran untampered.
- Silences of up to 45 s are counted as covered, so a candidate can hide the monitor for that long without it showing as a gap.
- Nothing here detects a second device or a person off camera. Do not present absence of signals as absence of cheating.
- Severity and the review rule are heuristics chosen by the developer. Existing calls keep their review status: the migration backfills severity but does not re-queue or un-queue anything.
