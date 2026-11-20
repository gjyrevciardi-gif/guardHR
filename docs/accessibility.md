# Accessibility

Target: WCAG 2.2 level AA on every page. This file records what the code does, how it is checked, and what is still not covered.

## Rules the code follows

| Rule | Where it lives |
|---|---|
| Every form control has a programmatic name: `<label htmlFor>` + `id`, or an `aria-label` when the design shows no label (search boxes, option inputs). | enforced by `jsx-a11y/label-has-associated-control` in `frontend/eslint.config.mjs` |
| No clickable `div`s, no `autoFocus` | the same ESLint block |
| Secondary text on light surfaces uses `text-muted` (`#567060`): 4.6:1 on the darkest page gradient, 5.4:1 on white. `slate-400/500` are only for the dark call room. | `tailwind.config.ts` |
| `slate-600` is `#4f6a59` (5:1) because it is used for nav and body text on the page gradient. | `tailwind.config.ts` |
| Focus ring: solid 3px `#164a41` on light pages; `.dark-ui` switches it to `#cde6bf` in the call room. | `app/globals.css`, `components/MeetingRoom.tsx` |
| Skip link first in the tab order, every page has `<main id="main">`. | `app/layout.tsx`, `.skip-link` |
| Each route has its own `<title>` (`Page · NemoGuardHR`). A parent layout that sets a title must restate the template, otherwise its children lose the suffix. | `app/**/layout.tsx` |
| Buttons and standalone links are at least 44 px tall; radios are 24 px with a 44 px hit area. Links inside a sentence are exempt (WCAG 2.5.8). | AppShell, test editor, session page |
| Saved/success messages use `role="status"`, errors `role="alert"`. | dashboard, session, test pages |
| `autocomplete` on login/register and on the candidate's own name and email; `off` where the host types someone else's details. | forms |

## How it was checked

axe-core 4.10 (WCAG 2.0/2.1/2.2 A and AA plus best-practice rules) on 12 pages at 1440, 768 and 375 px, in Chrome. A separate script lists controls under 44 px, checks reflow at 320 px, and walks the keyboard path (skip link, `#main`, focus ring colour). The candidate pre-join and call pages and the host room were scanned too.

| | Before | After |
|---|---|---|
| `color-contrast` nodes | 34 | 3 (the "HR" in the logotype on `/join`, exempt as a logo under 1.4.3) |
| `label` / `select-name` nodes | 24 / 9 | 0 / 0 |
| Controls under 44 px at 375 px | 45 | 8 (4 links inside sentences, which WCAG 2.5.8 exempts, and 4 radios that sit inside a larger label hit area); none under 24 px |
| Inputs without `autocomplete` | 6 | 0 |
| Pages whose title was only the product name | 11 of 12 | 1 (the landing page, where that is the right title) |
| Horizontal overflow at 320 px | none | none |

## Known limits

- Not tested with a real screen reader (NVDA, VoiceOver) or with voice control. axe only catches the problems a machine can detect; treat these numbers as a floor.
- The interface mixes Albanian and English vocabulary (status labels such as "Review completed", headings on the landing page). Screen readers pronounce the English words with Albanian rules. There is no per-term `lang` markup; the real fix is i18n.
- The "HR" in the wordmark is `#c08a22` (3:1 on white, 2.6:1 on the mist background). Logotypes are exempt, so it is left alone. Use `text-gold-deep` if that policy changes.
- Alerts on the host's call page (`/sessions/[id]`) are announced politely through a live region that is always mounted. The signal timeline inside the host video room is not a live region, and a video call is not a good screen-reader experience to begin with.
- The candidate's camera, screen share and face monitoring have no non-visual alternative. A candidate who cannot use them has to ask the host for another way.
