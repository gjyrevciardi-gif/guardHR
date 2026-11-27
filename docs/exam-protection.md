# Exams: protecting the questions and recording page signals

A **test** shared as a public link (`/forms/<link>`, `form_mode` off) is an exam. A plain **form** (`form_mode` on) is never monitored. Tests taken inside a call are covered by the call's own monitoring ([README](../README.md)); this page is about the public link, which has no call around it. The time limit and the shuffle below apply to the public link only.

## What the candidate goes through

1. A notice says what is recorded and blocked, and the time limit if there is one, with a link to `/privacy`. The questions are **not** in the page, and not in the response that loaded it.
2. They give their name and email (both required) and tick that they have read it. **Fillo testin** sends them to `POST /api/public/tests/<link>/start`. An email that already submitted is refused here (409), before the exam rather than after it. If the host turned on the [email code](#email-code-the-hosts-option) there is no **Fillo testin**: the questions come after a code instead, and `/start` answers 403.
3. The server writes an **attempt** (name, email, IP, start time, the order shown) and answers with the questions and the attempt's id. The questions appear, with the name, email and start time tiled faintly over them as a watermark, and a countdown when there is a limit.
4. Starting again with the same email, for example after a refresh or a crash, **picks the same attempt up**: same start time, same order, the clock still running, and the answers saved so far come back (see [Saved answers](#saved-answers)). It never gives a fresh start.
5. On submit the answers, the attempt and the collected signals go to the server in one request. An exam submission without a valid, unsubmitted attempt for that test is refused (400, or 409 if it was already submitted), and it is recorded for the name and email in the attempt, whatever the request body says.

## Time limit

`tests.time_limit_minutes` (1 to 480, empty = none), set under **Për linkun publik**, on the page that creates a test and in its editor. The clock starts at the attempt's start and is the server's: the page counts down from the seconds left the server reports, so a wrong clock on the candidate's device neither shortens nor stretches it.

- At zero the page sends what has been answered so far, complete or not.
- After the limit the server **does not hand out the questions again** (400 "Time is up"); the host sees the person under **Kanë nisur, pa dorëzuar** with "koha ka mbaruar".
- A submission that arrives late is **accepted and flagged**, not thrown away: the answers are kept and the host sees "N min mbi kufirin e kohës". Within 30 seconds of the limit nothing is flagged (`exams.OVER_LIMIT_GRACE_SECONDS`), because the page sends at 0:00 and the request takes time. A modified browser can ignore the countdown; the flag is what remains, and it is a signal for review like the others.
- Every submission also shows how long it took (`started_at` to `submitted_at`).

## Shuffle

`tests.shuffle` (default off, so existing tests behave as before). When on, each attempt gets its own order of questions and of the options inside each question, fixed at the start and stored on the attempt (`exam_attempts.layout`), so a refresh shows the same order. The page numbers questions by where they are shown. Answers come back as "the option at this position"; the server maps them through the attempt's order to the test's own option numbers before grading, and stores them that way, so scoring uses the host's key and the host's review reads like any other. Editing a test while someone is sitting it is tolerated: a removed question is skipped, an added one is shown last, and a question whose options changed is shown in its original order.

## Saved answers

While the candidate works, what they have answered is kept in two places, so a refresh, a crash or a change of device does not lose it.

- **In the tab** (`sessionStorage`, key `ng-exam-draft-<attempt id>`): written on every change, never sent anywhere by itself, dropped on submit. Session storage, not local storage, so closing the tab clears it and nothing stays behind on a shared computer.
- **On the server** (`exam_attempts.draft_answers`): the page sends the answers at most every 4 seconds while they change (`PUT /api/public/tests/<link>/attempts/<attempt id>/draft`, keyed by the attempt id like submitting). The server keeps only what could be an answer to a question shown (a choice must be one of the positions shown, a text is cut at 5000 characters, whitespace is no answer) and drops the rest instead of refusing it; real validation is at submit. Emptied on submit, and removed with the attempt (retention, release, deleting the test). The page says "Përgjigjet u ruajtën te serveri", or that they stayed in the tab only when a save fails; a refused save (released or already submitted) is not retried, a network error is.
- **Who gets the server's copy back:** only someone who has just proved the mailbox with the [email code](#email-code-the-hosts-option). Without the code, knowing an email is enough to start its attempt again, and it must not be enough to read what they wrote (or to copy another candidate's answers), so a restart restores only from the same tab, and the server's copy is there for the host's count and nothing else. On restart a tab with saved answers uses them; a tab with none (another device) takes the server's.
- **The host sees how many, not what:** the unfinished list shows "Ka përgjigjur 3 nga 8 pyetje" and when it was last saved. The answers themselves are not shown until they are submitted.

Saving does not count against the shared per-IP budget of the public test routes (a room of candidates behind one address would use it up and lock the others out of submitting); it has its own limits, 40 a minute per attempt and 1200 a minute per IP.

## Email code (the host's option)

`tests.verify_candidate_email` (default off, so existing tests behave as before), set under **Për linkun publik**, on the page that creates a test and in its editor. When it is on, the questions are handed out only to someone who has read the mailbox they gave. A plain form never checks email (the option is saved off for it).

1. They give a name and email, tick the notice, and press **Dërgo kodin**: `POST /api/public/tests/<link>/verification` emails a 6-digit code to that address. An address that already submitted gets nothing (409).
2. They type it: `POST .../verification/confirm` with the name, email and code. **The right code is the start.** The answer is the same as `/start`'s (attempt, questions, clock), in the one request, so there is no token or session in between that could be passed on. The attempt is stamped `email_verified_at`; the host sees "email-i i verifikuar" in the unfinished list and "Email-i u verifikua me kod" on the submission (copied to it, so it outlives the attempt).
3. Coming back after a refresh or a crash needs a new code, because a code is used once. The same attempt is picked up: same clock, same order, the answers the tab saved.

It is the call flow's mechanism (`app/verification.py`, [candidate-checks.md](candidate-checks.md#email-code-hosts-option-on-by-default-for-new-calls)) with the limits below.

| | |
|---|---|
| Code | 6 digits, valid 10 minutes, single use |
| Wrong guesses | 5 per code, then a new code is needed |
| Resend | 30 s between codes; at most 10 codes per address **per hour**. A call caps codes for the call's whole life, because the host can issue a new link; here nobody can, so the cap clears itself within the hour |
| Requests | 10 code requests an hour and 30 confirmations per 10 minutes, per IP and test |
| Stored | `exam_email_codes`: the address and only an HMAC of the code (keyed with `JWT_SECRET`, bound to that row) |
| Audited | `public_test.code_sent`, `code_failed`, `code_locked`, `code_verified`, `code_refused` (an address off the invited list), with the IP; never the address or the code |

**Invited list (optional).** Under the email code option the host can paste the addresses that may take the exam (`tests.invited_emails`, one per line or separated by commas; up to 500; stored lower case, repeats dropped). Empty means anyone with the link, as before. With a list, asking for a code (and confirming one) is refused with 403 for any other address: nothing is mailed to it and no code row is written, and `public_test.code_refused` is audited without the address. This closes the throwaway-mailbox gap: only mailboxes the host named can start the exam. Rules worth knowing:

- The list needs the email code. Saving a list on a test that does not check email, or on a plain form, is refused (422) rather than quietly ignored, and so is switching the code off while a list stands, because that would open the exam without the host noticing.
- It is the host's: only the test's owner gets it back (`GET /api/tests/{id}`); the public link, the test list and every candidate response leave it out, so nobody learns who else was invited.
- A candidate who types an address that is not on it is told so ("not on the invited list"). That lets someone with the link test whether an address is invited (at most 10 requests an hour per test); the list is not otherwise revealed. Known limit: a uniform answer would hide this but leave a mistyping candidate waiting for a mail that never comes.
- Changing the list takes effect at once, including for a code that was asked for earlier: confirming it is refused if the address is no longer on the list.
- The addresses are personal data the host entered. They are kept with the test and removed when the test is deleted; the retention purge, which works on attempts, codes and submissions, does not touch them.

What it does and does not do:

- It proves the person can read that mailbox. It does **not** prove who they are: a friend who reads a code out loud passes, and without an invited list a throwaway mailbox works. It closes two gaps without it: a made-up name with a made-up email no longer gets the questions, and knowing someone else's address no longer lets you pick up their attempt.
- Anyone with the link can ask for codes to be sent to any address, up to the caps, and can use up an address's ten codes for an hour. It annoys; it cannot start the exam as them.
- It needs a working SMTP relay (see [deployment.md](deployment.md)). With a broken one nobody can start the test, and the candidate is told the code could not be sent (502).
- The name is still self-declared. The attempt keeps the name given at the first start.

## What is recorded, blocked, and not possible

| | |
|---|---|
| **Recorded** (never the text itself) | the page or tab losing the screen, with how long (`tab_hidden`, source `visibilitychange` or `window_blur`; a focus loss under 0.7 s is ignored); text pasted in (`copy_paste`, `operation: paste`, only length and line count); copy or cut of the page (`copy`/`cut`, `blocked: true`); printing (`print`); the Print Screen key (`screenshot_key`) |
| **Blocked** | copy and cut outside the answer boxes, right-click and drag outside the answer boxes, selecting the question text, printing (the questions are hidden in print) |
| **Deliberately allowed** | pasting (recorded, not blocked: these are signals for review, not verdicts, and a blocked paste breaks assistive tools); copying one's own answer inside the answer box |
| **Not possible in a browser** | stopping a screenshot (Win+Shift+S, Mac shortcuts, phone), a photo of the screen, a second device, reading the page with developer tools, or a modified browser that sends no signals. The watermark is the answer to leaks: a screenshot or photo then says whose it is |

Severity is decided by the server, never by the browser: pasting, printing and Print Screen are *medium*, a blocked copy is *low*, an absence is *low* until it is long (`signals.LONG_ABSENCE_SECONDS`), then *medium*. The host sees them as chips on each public submission (**Tests → the test → Përgjigje publike**), worded as something to look at, not a finding.

## The host's side

- **Kanë nisur, pa dorëzuar** lists everyone who started and has not submitted: name, email, start time, whether their time has run out, and how many questions they have answered so far (never the answers). They may still be answering, or have walked away.
- **Lejo përsëri** deletes that attempt (audit entry `test.attempt_released`), so the person can start again with a full clock. It is the way back for a crashed browser or a lapsed limit, and it is only offered for an unsubmitted attempt; the old attempt then no longer submits. The attempt's id is also the candidate's key for submitting, so the list is only ever sent to the test's owner.

## Limits to know before relying on it

- **Signals come from the candidate's browser.** Their absence does not prove nothing happened. Signals still travel with the submission (there is no session to post them to), so someone who starts and never submits leaves an attempt on record but no signals.
- **The link alone reveals nothing, but starting is open** unless the host turned on the email code. `GET /api/public/tests/<link>` carries the title, the number of questions and the time limit; the questions come from `/start`, which needs a name and a well-formed email, nothing more. Someone willing to give a made-up name and email can read the questions (from the network response) without taking the exam, and the watermark then carries that made-up name. Rate limit: 20 starts an hour per IP and test. With the email code on, the same person needs a mailbox they can read (a throwaway one will do). For a stricter exam, run it inside a call.
- **One attempt per email, and without the email code the email is self-declared and not verified.** Someone who knows another candidate's email can pick that attempt up and answer in their name; the attempt's page shows the name given at the first start. With the code on, picking an attempt up needs a code sent to that mailbox.
- **Saved answers are best effort.** They survive a refresh, a crash and a restored tab, and with the email code on a change of device too. Without the email code a change of device or a new tab starts with empty answers (the clock and the order carry on), and so does a candidate whose saves kept failing and who closed the tab. A candidate who never submits leaves a partial draft on the server until retention removes it, and the host cannot read it. Signals recorded before a refresh are lost: they travel with the submission only.
- Mobile browsers have no Print Screen key and mostly no print dialog; there the notice, the watermark and the focus signals are what remain.

## Data

- **Draft answers** are in the candidate's tab (`sessionStorage`) and in `exam_attempts.draft_answers` / `draft_saved_at` (see [Saved answers](#saved-answers)). On picking an attempt up again, only answers that still fit the questions are restored.
- **Signals** are stored in `test_submissions.integrity_events` (JSON, at most 300 per submission, only `tab_hidden` and `copy_paste` accepted). They are part of the submission row. The server drops anything sent for a plain form.
- **Email codes** are `exam_email_codes` rows (only with the email code on): the address and a keyed hash of the last code, one per test and address, written when a code is asked for, so an address that never started is stored too. The retention purge removes them once their last code is older than the host's retention period; deleting the test removes them with it.
- **Attempts** are `exam_attempts` rows: name, email, IP, start time, submit time, the order shown. One per test and email. Unlike a submission one exists **from the start**, so a person who never submitted is stored too. The retention purge removes attempts older than the host's retention period (`deleted_attempts` in its result), whether or not they submitted; deleting the test removes its attempts with it. Backups hold them until pruned (see [deployment.md](deployment.md)).
- Submissions also keep `started_at`, `over_limit_seconds` and `email_verified_at`, so a submission stands on its own after its attempt has been purged.

`/privacy` and the exam notice describe the processing; as the operator you still decide the legal basis (see [deployment.md](deployment.md#privacy-page)).

## Upgrading

Migration `0009` adds `exam_attempts`, `tests.time_limit_minutes` and `tests.shuffle` (default off), and `test_submissions.started_at` / `over_limit_seconds` (empty for every existing row). Existing tests keep behaving as before until the host sets a limit or turns shuffle on. It is additive and downgradable; downgrading discards the attempts, and with them the record of who started and never submitted.

An exam page opened before this release has no attempt id of the new kind and cannot submit: the candidate gets "Start the test before submitting it" and has to reload. Deploy between exams, not during one. Plain forms are unaffected.

## Upgrading to the email code

Migration `0010` adds `tests.verify_candidate_email` (default off), the `exam_email_codes` table, and `email_verified_at` on `exam_attempts` and `test_submissions` (empty for every existing row). Existing tests behave as before until the host ticks the option. It is additive and downgradable; downgrading discards pending codes and the verified-at times. An exam page opened before the upgrade keeps working for a test without the option.

## Upgrading to saved answers

Migration `0011` adds `exam_attempts.draft_answers` (JSON, empty by default) and `draft_saved_at`. Every existing attempt starts with nothing saved. It is additive and downgradable; downgrading discards the saved drafts and nothing else. An exam page opened before the upgrade keeps working and simply does not save to the server.

## Upgrading to the invited list

Migration `0013` adds `tests.invited_emails` (JSON, an empty list for every existing test, which keeps behaving as before: anyone with the link). It is additive and downgradable; downgrading discards the lists and nothing else. It builds on `0012` (the encrypted second-step secret), so that migration comes first.

## Possible next steps (not built)

Letting the host open a draft, or accept it as the submission, for someone whose time ran out with the page closed (today the count is all they see; reading someone's unsubmitted answers is a privacy decision for the operator, and `/privacy` currently promises the host sees only how many questions were answered, so it would also need new privacy text before it is built).
