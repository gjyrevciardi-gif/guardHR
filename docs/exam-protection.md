# Exams: protecting the questions and recording page signals

A **test** shared as a public link (`/forms/<link>`, `form_mode` off) is an exam. A plain **form** (`form_mode` on) is never monitored. Tests taken inside a call are covered by the call's own monitoring ([README](../README.md)); this page is about the public link, which has no call around it.

## What the candidate goes through

1. A notice says what is recorded and blocked, with a link to `/privacy`. The questions are **not** in the page, and not in the response that loaded it.
2. They give their name and email (both required) and tick that they have read it. **Fillo testin** sends them to `POST /api/public/tests/<link>/start`. An email that already submitted is refused here (409), before the exam rather than after it.
3. The server answers with the questions and an **attempt**: a signed token that says "this person started this test". The questions appear, with their name, email and the start time tiled faintly over them as a watermark.
4. On submit the answers, the attempt and the collected signals go to the server in one request. An exam submission without a valid attempt for that test is refused (400), and it is recorded for the name and email in the attempt, whatever the request body says.

## What is recorded, blocked, and not possible

| | |
|---|---|
| **Recorded** (never the text itself) | the page or tab losing the screen, with how long (`tab_hidden`, source `visibilitychange` or `window_blur`; a focus loss under 0.7 s is ignored); text pasted in (`copy_paste`, `operation: paste`, only length and line count); copy or cut of the page (`copy`/`cut`, `blocked: true`); printing (`print`); the Print Screen key (`screenshot_key`) |
| **Blocked** | copy and cut outside the answer boxes, right-click and drag outside the answer boxes, selecting the question text, printing (the questions are hidden in print) |
| **Deliberately allowed** | pasting (recorded, not blocked: these are signals for review, not verdicts, and a blocked paste breaks assistive tools); copying one's own answer inside the answer box |
| **Not possible in a browser** | stopping a screenshot (Win+Shift+S, Mac shortcuts, phone), a photo of the screen, a second device, reading the page with developer tools, or a modified browser that sends no signals. The watermark is the answer to leaks: a screenshot or photo then says whose it is |

Severity is decided by the server, never by the browser: pasting, printing and Print Screen are *medium*, a blocked copy is *low*, an absence is *low* until it is long (`signals.LONG_ABSENCE_SECONDS`), then *medium*. The host sees them as chips on each public submission (**Tests → the test → Përgjigje publike**), worded as something to look at, not a finding.

## Limits to know before relying on it

- **Signals come from the candidate's browser.** Their absence does not prove nothing happened.
- **A candidate who never submits leaves nothing.** Signals travel with the submission, because there is no session to post them to. Closing the tab mid-exam records no attempt.
- **The link alone reveals nothing, but starting is open.** `GET /api/public/tests/<link>` carries the title and the number of questions; the questions come from `/start`, which needs a name and a well-formed email, nothing more. Someone willing to give a made-up name and email can read the questions (from the network response) without taking the exam, and the watermark then carries that made-up name. Rate limit: 20 starts an hour per IP and test. For a stricter exam, run it inside a call.
- The attempt is stateless (valid six hours, `security.EXAM_ATTEMPT_HOURS`), so the server keeps nothing at the start. A candidate can start again, which gives them the questions again and a fresh attempt; there is no per-attempt time limit; two attempts started before either is submitted give one submission (the second is refused as a duplicate).
- Anyone with the link can take it once per email; the email is self-declared and not verified.
- Mobile browsers have no Print Screen key and mostly no print dialog; there the notice, the watermark and the focus signals are what remain.

## Data

Signals are stored in `test_submissions.integrity_events` (JSON, migration `0008`, at most 300 per submission, only `tab_hidden` and `copy_paste` accepted). They are part of the submission row, so the retention purge, deleting the test and deleting the call remove them with the answers. The server drops anything sent for a plain form. `/privacy` and the exam notice describe the processing; as the operator you still decide the legal basis (see [deployment.md](deployment.md#privacy-page)).

## Possible next steps (not built)

Per-candidate shuffling of question and option order (makes sharing "question 3 is B" useless), and a time limit. Both want an attempts table (one row per start, with its start time) instead of the stateless token: that would also record a candidate who starts and never submits, and stop restarts.

## Upgrading

An exam page opened before the upgrade cannot submit afterwards (it has no attempt): the candidate gets "Start the test before submitting it" and has to reload. Deploy between exams, not during one. Plain forms are unaffected.
