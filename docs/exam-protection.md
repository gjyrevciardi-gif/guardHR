# Exams: protecting the questions and recording page signals

A **test** shared as a public link (`/forms/<link>`, `form_mode` off) is an exam. A plain **form** (`form_mode` on) is never monitored. Tests taken inside a call are covered by the call's own monitoring ([README](../README.md)); this page is about the public link, which has no call around it. The time limit and the shuffle below apply to the public link only.

## What the candidate goes through

1. A notice says what is recorded and blocked, and the time limit if there is one, with a link to `/privacy`. The questions are **not** in the page, and not in the response that loaded it.
2. They give their name and email (both required) and tick that they have read it. **Fillo testin** sends them to `POST /api/public/tests/<link>/start`. An email that already submitted is refused here (409), before the exam rather than after it.
3. The server writes an **attempt** (name, email, IP, start time, the order shown) and answers with the questions and the attempt's id. The questions appear, with the name, email and start time tiled faintly over them as a watermark, and a countdown when there is a limit.
4. Starting again with the same email, for example after a refresh or a crash, **picks the same attempt up**: same start time, same order, the clock still running. It never gives a fresh start.
5. On submit the answers, the attempt and the collected signals go to the server in one request. An exam submission without a valid, unsubmitted attempt for that test is refused (400, or 409 if it was already submitted), and it is recorded for the name and email in the attempt, whatever the request body says.

## Time limit

`tests.time_limit_minutes` (1 to 480, empty = none), set in the editor under **Për linkun publik**. The clock starts at the attempt's start and is the server's: the page counts down from the seconds left the server reports, so a wrong clock on the candidate's device neither shortens nor stretches it.

- At zero the page sends what has been answered so far, complete or not.
- After the limit the server **does not hand out the questions again** (400 "Time is up"); the host sees the person under **Kanë nisur, pa dorëzuar** with "koha ka mbaruar".
- A submission that arrives late is **accepted and flagged**, not thrown away: the answers are kept and the host sees "N min mbi kufirin e kohës". Within 30 seconds of the limit nothing is flagged (`exams.OVER_LIMIT_GRACE_SECONDS`), because the page sends at 0:00 and the request takes time. A modified browser can ignore the countdown; the flag is what remains, and it is a signal for review like the others.
- Every submission also shows how long it took (`started_at` to `submitted_at`).

## Shuffle

`tests.shuffle` (default off, so existing tests behave as before). When on, each attempt gets its own order of questions and of the options inside each question, fixed at the start and stored on the attempt (`exam_attempts.layout`), so a refresh shows the same order. The page numbers questions by where they are shown. Answers come back as "the option at this position"; the server maps them through the attempt's order to the test's own option numbers before grading, and stores them that way, so scoring uses the host's key and the host's review reads like any other. Editing a test while someone is sitting it is tolerated: a removed question is skipped, an added one is shown last, and a question whose options changed is shown in its original order.

## What is recorded, blocked, and not possible

| | |
|---|---|
| **Recorded** (never the text itself) | the page or tab losing the screen, with how long (`tab_hidden`, source `visibilitychange` or `window_blur`; a focus loss under 0.7 s is ignored); text pasted in (`copy_paste`, `operation: paste`, only length and line count); copy or cut of the page (`copy`/`cut`, `blocked: true`); printing (`print`); the Print Screen key (`screenshot_key`) |
| **Blocked** | copy and cut outside the answer boxes, right-click and drag outside the answer boxes, selecting the question text, printing (the questions are hidden in print) |
| **Deliberately allowed** | pasting (recorded, not blocked: these are signals for review, not verdicts, and a blocked paste breaks assistive tools); copying one's own answer inside the answer box |
| **Not possible in a browser** | stopping a screenshot (Win+Shift+S, Mac shortcuts, phone), a photo of the screen, a second device, reading the page with developer tools, or a modified browser that sends no signals. The watermark is the answer to leaks: a screenshot or photo then says whose it is |

Severity is decided by the server, never by the browser: pasting, printing and Print Screen are *medium*, a blocked copy is *low*, an absence is *low* until it is long (`signals.LONG_ABSENCE_SECONDS`), then *medium*. The host sees them as chips on each public submission (**Tests → the test → Përgjigje publike**), worded as something to look at, not a finding.

## The host's side

- **Kanë nisur, pa dorëzuar** lists everyone who started and has not submitted: name, email, start time, and whether their time has run out. They may still be answering, or have walked away.
- **Lejo përsëri** deletes that attempt (audit entry `test.attempt_released`), so the person can start again with a full clock. It is the way back for a crashed browser or a lapsed limit, and it is only offered for an unsubmitted attempt; the old attempt then no longer submits. The attempt's id is also the candidate's key for submitting, so the list is only ever sent to the test's owner.

## Limits to know before relying on it

- **Signals come from the candidate's browser.** Their absence does not prove nothing happened. Signals still travel with the submission (there is no session to post them to), so someone who starts and never submits leaves an attempt on record but no signals.
- **The link alone reveals nothing, but starting is open.** `GET /api/public/tests/<link>` carries the title, the number of questions and the time limit; the questions come from `/start`, which needs a name and a well-formed email, nothing more. Someone willing to give a made-up name and email can read the questions (from the network response) without taking the exam, and the watermark then carries that made-up name. Rate limit: 20 starts an hour per IP and test. For a stricter exam, run it inside a call.
- **One attempt per email, and the email is self-declared and not verified.** Someone who knows another candidate's email can pick that attempt up and answer in their name; the attempt's page shows the name given at the first start.
- **Answers are not saved while the candidate types.** A refresh or crash keeps the clock and the order but not what was typed; the candidate starts the same attempt again with empty answers.
- Mobile browsers have no Print Screen key and mostly no print dialog; there the notice, the watermark and the focus signals are what remain.

## Data

- **Signals** are stored in `test_submissions.integrity_events` (JSON, at most 300 per submission, only `tab_hidden` and `copy_paste` accepted). They are part of the submission row. The server drops anything sent for a plain form.
- **Attempts** are `exam_attempts` rows: name, email, IP, start time, submit time, the order shown. One per test and email. Unlike a submission one exists **from the start**, so a person who never submitted is stored too. The retention purge removes attempts older than the host's retention period (`deleted_attempts` in its result), whether or not they submitted; deleting the test removes its attempts with it. Backups hold them until pruned (see [deployment.md](deployment.md)).
- Submissions also keep `started_at` and `over_limit_seconds`, so a submission stands on its own after its attempt has been purged.

`/privacy` and the exam notice describe the processing; as the operator you still decide the legal basis (see [deployment.md](deployment.md#privacy-page)).

## Upgrading

Migration `0009` adds `exam_attempts`, `tests.time_limit_minutes` and `tests.shuffle` (default off), and `test_submissions.started_at` / `over_limit_seconds` (empty for every existing row). Existing tests keep behaving as before until the host sets a limit or turns shuffle on. It is additive and downgradable; downgrading discards the attempts, and with them the record of who started and never submitted.

An exam page opened before this release has no attempt id of the new kind and cannot submit: the candidate gets "Start the test before submitting it" and has to reload. Deploy between exams, not during one. Plain forms are unaffected.

## Possible next steps (not built)

Saving answers as the candidate types (so a crash loses nothing), and verifying the candidate's email before the questions are handed out (the code check the call flow already has, see [candidate-checks.md](candidate-checks.md)), which would close the "made-up name and email" gap above.
