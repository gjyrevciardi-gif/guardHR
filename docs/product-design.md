# Product design: "Review Ledger"

This is the reference for how NemoGuardHR looks and why. The product rule it serves has not changed: **signals for review, never verdicts**. Every design decision below either makes a signal easier to understand honestly or keeps the product from implying more than the data can support.

## The five changes that mattered most

| # | Change | Impact | Complexity | Status |
|---|--------|--------|------------|--------|
| 1 | One design system with real light and dark themes (tokens, not per-page colours) | High: every screen looks like one product; dark mode for people who review at night | Medium | Done |
| 2 | The live room rebuilt around the review: call strip, signal cards that say what they do and do not show, private notes, focus mode, end-of-call summary | Highest: this is the screen hosts live in | High | Done |
| 3 | A dashboard made only of real data: what needs attention now, review progress, 14-day activity, saved views | High | Medium | Done |
| 4 | A candidate journey that explains itself: invitation email, consent with a step list, device check inside the lobby, completion page that says what was kept | High: trust and fewer "is this safe?" questions | Medium | Done |
| 5 | A public page without invented numbers: sample call drawn with the real components, and a section on what the product does **not** do | Medium | Low | Done |

## Direction

- **Flat canvas, solid bordered cards.** No glass, no large gradients, no decorative motion. Surfaces are `canvas` (page) and `white` (card; in dark mode a dark surface). One short rise-in animation exists and is disabled under `prefers-reduced-motion`.
- **Mono for facts, Sora for people.** IBM Plex Mono with tabular numerals for times, counts and kickers; Sora for headings and body. Section titles carry a small gold tick, the only recurring ornament.
- **Colour carries meaning once, and never alone.** Severity is shape + word + colour. It uses the amber family and slate, never red: red is reserved for product errors and the leave button, because it must not be used to describe a person.
- **The room is always dark** (a fixed `stage` palette). Everything else follows the theme.
- **Albanian first**, written with diacritics (`ë`, `ç`) and without developer terms in the UI. The hand-written date formatter in `lib/format.ts` exists because headless and minimal browsers ship no `sq-AL` locale data and silently fall back to English.

## Tokens

All colours are defined once in `frontend/tailwind.config.ts` as `R G B` triples in a `light` and a `dark` palette. A small plugin writes them as CSS variables (`:root` and `html[data-theme="dark"]`) and Tailwind reads them as `rgb(var(--c-…) / <alpha-value>)`, so opacity utilities such as `bg-teal/10` still work and a class like `bg-white` means "card surface" in both themes. The theme is applied before first paint by an inline script in `app/layout.tsx` (stored under `ng-theme` in local storage; if storage is blocked the choice simply lasts for the visit).

To change the look, edit the two palettes. Do not add per-page hex values. Text colours were checked for contrast against both `white` and `canvas` in both themes; changing `gold.text`, `muted` or the `slate` scale means re-running the contrast check below.

## Components that carry the identity

| Component | What it is for |
|-----------|----------------|
| `CallStrip` | One call as a line of time. A calm band is normal activity while the monitor reported; a marker is an observed signal (taller means more significant); diagonal hatching means the monitor was **not** reporting, so nothing can be said about that stretch. It is the one place where "no data" can never look like "all fine". |
| `SignalCard` | One signal with two sentences: what it means, and what it does not show. Never shows pasted text (it is not stored). |
| `SeverityMark` / `SignalSeal` | Severity as shape + word, and the line "Sinjal për shqyrtim, jo verdikt" wherever signals appear. |
| `HostRail`, `HostNotes` | The review panel inside the room: signals, checklist (derived from real room state, not self-ticked), candidate details, and private notes that autosave. |
| `Lobby`, `SystemCheck`, `EmailVerification` | The candidate's step list: consent, optional email code, device check, entry. |
| `CallSummary` | What was recorded when the host leaves, and the next step (the review). |
| `SampleCall` | The landing and login sample, built from the real components with invented data and labelled as such. |

## What is real and what is not

- The dashboard derives every number from the API: attention queue (silent monitor, live now, requires review, weak monitoring, link expiring within 24 h), review progress, activity per day. If there is nothing, it says so. There is no placeholder data anywhere.
- The only invented data in the product is the labelled sample call (`SampleCall`). Its severities follow `backend/app/signals.py`.
- The landing page contains no testimonials, customer names, certifications, security guarantees or statistics, and says plainly what the product does not do (no recording of video or audio, no automatic decisions, no emotion recognition, signals are not proof).

## Private host notes

`interview_sessions.host_notes` (migration `0006`) is returned only by the call detail endpoint, only to the call's owner, and is written through `PUT /api/sessions/{id}/notes`. It is not part of any candidate or public response. It is kept until the host deletes the call, like reviews; the retention purge does not remove it (see `docs/deployment.md`).

## Considered and deliberately not built

Each of these is a real product decision, not an oversight; the first rule was not to implement every idea.

- **Call templates and scoring rubrics.** Useful, but they need a data model and a review flow of their own; adding a half-version would create a second source of truth next to the existing test and review model.
- **Multi-step "wizard" for creating a call.** The form has six fields; splitting it would add clicks without removing a decision. The default expiry, the email-code option and the test picker already carry the choices.
- **Shareable summaries and collaboration (several reviewers).** They change who can see candidate data, which is a privacy decision for the operator, not a styling task.
- **Calendar and ATS integrations, interactive demo mode.** Need external credentials and an operator decision; the labelled sample call covers "see it before you sign up".
- **A walkthrough/tour overlay.** The room and dashboard now state their own state in words, which ages better than an overlay.

## Known limits

- The API stores the **number** of monitoring gaps, not their positions, so the hatched part of the coverage bar is a share of the call, not a positional marker.
- Signals come from the candidate's browser, which the candidate controls: they can be missing or wrong. The UI says so on every signal and when monitoring was silent; it cannot remove that limit.
- The sample call's clock labels use the server's time zone at build time; they are illustrative.
- Screenshots and checks below were produced against a seeded development database, not production data.

## How it was checked

All of this was run against the real frontend and API (not stand-ins). The browser scripts used Puppeteer with axe-core and are not committed; the commands CI runs are.

- **CI commands:** `npm run lint`, `npm run typecheck`, `npm run build`; backend `ruff check .` and `pytest -q` on SQLite and on PostgreSQL (schema built by Alembic, including migration `0006`).
- **Accessibility:** axe-core (WCAG 2.0/2.1/2.2 A and AA, target size, best practice) on 15 screens, each in light and dark at 390, 820 and 1440 px, plus horizontal-overflow checks, with no findings; and at every stop of a real two-browser call (candidate consent, lobby, device check, host room on every tab, focus mode, phone width, summary, completion).
- **End to end:** a two-browser call (consent, device check, join, video both ways, signals arriving at the host with severity and explanation, notes autosaving and stored on the server, tab navigation by arrow keys, focus mode, summary on leave, completion page): 23 of 23 checks pass.
