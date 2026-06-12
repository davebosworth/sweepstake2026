# World Cup 2026 · Sweepstake Tracker

A small, zero-dependency web app for running our WC26 sweepstake and producing
the daily **"Morning Report"** graphic for the group chat.

Built straight from the handover spec: eight players, six teams each, two side
competitions (the **Disciplinary Prize** and the wooden-spoon **Worst Teams**
table), and a shareable portrait PNG sized for WhatsApp.

## Running it

It's a static site — no build step, no server needed.

- **Quickest:** open `index.html` in any modern browser.
- **Shared link:** push this branch and enable **GitHub Pages** (Settings →
  Pages → deploy from branch). The app then lives at
  `https://<user>.github.io/sweepstake2026/`.

Click **Load sample** in the top bar to see it populated, then **Reset** to
start clean.

## How it works

Everything is derived from one list of **matches**. Enter a fixture (group,
date, UK kick-off, the two teams), then fill in the score, goalscorers and
cards once it's played. From that single source of truth the app computes:

- **Group standings** (P/W/D/L/GF/GA/GD/Pts)
- **Disciplinary Prize** — card points per *single team* (Red = 3, Yellow = 1),
  most points leading. Tracks one team, not a player's combined total.
- **Worst Teams** — ranked by fewest points, GD as tiebreaker. The
  early-tournament filter (only teams on 0 pts with a negative GD) can be
  toggled off from the Report tab as the group stage progresses.

### Tabs

| Tab | What it's for |
|---|---|
| **Dashboard** | At-a-glance leaders for both competitions |
| **Fixtures & Results** | Add/edit matches, **or Sync from ESPN** |
| **Standings** | Full group league tables |
| **Morning Report** | Live preview + **Export PNG** (1080px portrait) |
| **Allocations** | The fixed player → team reference |

## Auto-fill from ESPN

The **⟳ Sync from ESPN** button (Fixtures tab) pulls fixtures, results,
goalscorers and yellow/red cards straight from ESPN's free, no-key World Cup
feed (`site.api.espn.com/.../fifa.world`) — enough to power the scores, the
goalscorers in the report *and* the disciplinary prize.

- Pick a date range, hit **Fetch**, and review what came back. Each row is
  flagged **NEW / UPDATED / UNCHANGED / UNMAPPED**; nothing is saved until you
  click **Import selected**.
- Team names are mapped to the sweepstake's localised spellings (Netherlands →
  Holland, Korea Republic → South Korea, Côte d'Ivoire → Ivory Coast, and so
  on). Anything it can't recognise is flagged rather than guessed.
- Importing **merges** onto existing matches by date + teams, so it won't
  create duplicates, and a failed/partial detail fetch never wipes manual
  entries.

Notes & caveats:
- ESPN's endpoint is **unofficial** — it can change or rate-limit without
  notice. The review step and manual entry are always there as a fallback.
- It's called directly from your browser (no key, no backend). If a corporate
  network or extension blocks it you'll see a clear error; manual entry still
  works.
- Group labels aren't always present on the feed; existing group labels are
  preserved on update.

## The Morning Report

The graphic is hand-built as an SVG (matching the spec's design system —
dark-green gradient, gold accents, DejaVu Sans) and rendered to PNG in the
browser, the web equivalent of the original `cairosvg` pipeline.

- Pick the **report date**. "Yesterday's Results" pulls completed matches from
  the day before; "Today's Fixtures" lists that day's games.
- The **day number** is computed from the tournament start date.
- Choose an export resolution (2× recommended for a crisp WhatsApp image) and
  hit **Export PNG**.

## Saving & sharing data

State autosaves to your browser (localStorage). Use **Export** / **Import** in
the top bar to back up the JSON or hand the dataset to whoever's on graphic
duty. The realistic workflow matches the handover: one maintainer keeps the
data current and posts the morning PNG.

## Project layout

```
index.html        markup + script order
styles.css        dark-green theme
js/data.js        fixed allocations, owner lookup, design tokens
js/sample.js      optional demo dataset
js/store.js       state, localStorage, JSON import/export
js/standings.js   all table computations (pure, derived from matches)
js/report.js      Morning Report SVG builder + PNG export
js/app.js         UI: tabs, match editor, report controls
```
