# Accessibility

Target: WCAG 2.2 level AA on every page. This file records what the code does, how it is checked, and what is still not covered.

## Rules the code follows

| Rule | Where it lives |
|---|---|
| Every form control has a programmatic name: `<label htmlFor>` + `id`, or an `aria-label` when the design shows no label (search boxes, option inputs). | enforced by `jsx-a11y/label-has-associated-control` in `frontend/eslint.config.mjs` |
| No clickable `div`s, no `autoFocus` | the same ESLint block |
| Secondary text on light surfaces uses `text-muted` (`#567060`): 4.6:1 on the darkest page gradient, 5.4:1 on white. `slate-400/500` are only for the dark call room. | `tailwind.config.ts` |
| `slate-600` is `#4f6a59` (5:1) because it is used for nav and body text on the page gradient. | `tailwind.config.ts` |
| Focus ring: solid 3px in the `teal` token (`#164a41` in the light theme, light green in the dark theme); `.dark-ui` forces `#cde6bf` in the call room, which is always dark. | `app/globals.css`, `components/MeetingRoom.tsx` |
| Two themes from one palette definition. Light and dark were both checked for contrast; do not add per-page colours, change the palettes. The theme toggle is a real button with `aria-pressed`. | `tailwind.config.ts`, `components/ThemeToggle.tsx`, [product-design.md](product-design.md) |
| Severity is never colour alone: every signal shows a shape and a word, and "no monitoring" is hatched and labelled. | `SeverityMark`, `CallStrip` |
| Heading outline: the room title is the `h1`; the signals panel has a screen-reader-only `h2` so signal cards (`h3`) do not skip a level. | `MeetingRoom.tsx`, `HostRail.tsx` |
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

### After the redesign (light and dark themes)

axe-core (WCAG 2.0/2.1/2.2 A and AA, target size, best practice) on 15 screens (landing, login, register, consent, privacy, public test and form, dashboard, new call, review, live call page, tests list, new test, test detail, settings), each in light and dark at 1440, 820 and 390 px, with a horizontal-overflow check: no findings. It also runs at every stop of a real two-browser call (candidate consent, lobby before and after the device check, host lobby, host room on each tab, focus mode, phone width, candidate room, summary, completion page). The scan found three real problems that were fixed: the wordmark's "HR" at 2.8:1 in the light theme (`gold.text` is now `#97620c`, about 5:1), the room having no `h1`, and signal cards skipping a heading level. Scans must wait for the 300 ms rise-in animation to finish, otherwise axe measures half-transparent colours and reports false contrast failures.

### Account screens

The same axe configuration, in light and dark at 1440 and 390 px with the overflow check, on the screens added for account security, driven through the real UI: login (password step and the code step, which takes focus), forgot password (before and after sending), reset password (form, link refused, no token, done), Settings → Siguria e llogarisë (password, devices, two-step set-up with the secret shown, the one-time recovery codes, and the enabled state) and the administrator's "must enrol" note: no findings. Conventions the new forms follow: every field has a visible label, the code field uses `autocomplete="one-time-code"`, errors are `role="alert"`, success is `role="status"`, and a destructive step (sign out everywhere, turn two-step off) asks for confirmation. Text typed into a form before the page has hydrated is discarded by React; this is how controlled inputs behave and applies to every form in the app, but it is why the browser scripts wait for hydration before typing.

## Known limits

- The two-step set-up shows the secret as text and an `otpauth://` link, not a QR code, which is also the non-visual alternative.
- Not tested with a real screen reader (NVDA, VoiceOver) or with voice control. axe only catches the problems a machine can detect; treat these numbers as a floor.
- The interface is Albanian, but it still contains a few English product terms (call, test, email, copy/paste, fullscreen, host) and the test questions seeded or typed by hosts may be in any language. Screen readers pronounce English words with Albanian rules. There is no per-term `lang` markup; the real fix is i18n.
- Alerts on the host's call page (`/sessions/[id]`) are announced politely through a live region that is always mounted. The signal timeline inside the host video room is not a live region, and a video call is not a good screen-reader experience to begin with.
- The candidate's camera, screen share and face monitoring have no non-visual alternative. A candidate who cannot use them has to ask the host for another way.
