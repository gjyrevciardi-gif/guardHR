# Exams: protecting the questions and recording page signals

A **test** shared as a public link (`/forms/<link>`, `form_mode` off) is an exam. A plain **form** (`form_mode` on) is never monitored. Tests taken inside a call are covered by the call's own monitoring ([README](../README.md)); this page is about the public link, which has no call around it.

## What the candidate goes through

1. A notice says what is recorded and blocked, with a link to `/privacy`. The questions are **not** in the page yet.
2. They give their name and email (both required) and tick that they have read it. Only then does **Fillo testin** work.
3. The questions appear, with their name, email and the start time tiled faintly over them as a watermark.
4. On submit the answers and the collected signals go to the server in one request.

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
- **The questions reach the browser when the link loads** (`GET /api/public/tests/<link>`). The page hides them until the candidate starts, which stops a casual look, not someone reading the network response. For a stricter exam, run it inside a call.
- Anyone with the link can take it once per email; the email is self-declared and not verified.
- Mobile browsers have no Print Screen key and mostly no print dialog; there the notice, the watermark and the focus signals are what remain.

## Data

Signals are stored in `test_submissions.integrity_events` (JSON, migration `0008`, at most 300 per submission, only `tab_hidden` and `copy_paste` accepted). They are part of the submission row, so the retention purge, deleting the test and deleting the call remove them with the answers. The server drops anything sent for a plain form. `/privacy` and the exam notice describe the processing; as the operator you still decide the legal basis (see [deployment.md](deployment.md#privacy-page)).

## Possible next steps (not built)

Per-candidate shuffling of question and option order (makes sharing "question 3 is B" useless), a time limit, and sending the questions only after the start (a per-attempt token) so the link alone reveals nothing.
