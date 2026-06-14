# World Cup 2026 · Sweepstake Tracker

A small, zero-dependency web app for tracking our WC26 sweepstake and producing
the daily **"Morning Report"** graphic for the group chat.

Built straight from the handover spec: eight players, six teams each, two side
competitions (the **Disciplinary Prize** and the wooden-spoon **Worst Teams**
table), and a shareable portrait PNG sized for WhatsApp.

**It's fully live.** Every page load pulls the whole tournament from ESPN's
free World Cup feed, recomputes every table on the fly, and shows it — there is
no database, no localStorage, and no manual data entry. Open it and it's
current.

## Running it

A static site — no build step, no server.

- **Quickest:** open `index.html` in any modern browser.
- **Shared link:** push this branch and enable **GitHub Pages** (Settings →
  Pages → deploy from branch). The app then lives at
  `https://<user>.github.io/sweepstake2026/`.

## How it works

On load the app fetches from ESPN's free, no-key feed
(`site.api.espn.com/.../soccer/fifa.world`):

1. The **scoreboard** for every day of the tournament → fixtures, kick-off
   times (shown in UK time), and final scores. The Dashboard, Standings,
   Fixtures and Worst Teams table render from this immediately.
2. The **per-match summary** for each finished game → goalscorers and yellow/
   red cards. These stream in just after, filling the Disciplinary prize and
   the report's scorers. A status pill in the header shows progress.

A tiny **session cache** keeps repeat loads light by only ever caching data
that can't change again: a day is cached once **all its matches have ended** (or
the date is already past), and a match's scorers/cards are cached only for
finished games. In-play and upcoming days are always re-fetched, so live scores
never go stale. It lives in `sessionStorage` and clears when the tab closes — no
real state is persisted.

Everything below is recomputed from that match list on every render:

- **Group standings** (P/W/D/L/GF/GA/GD/Pts)
- **Disciplinary Prize** — card points per *single team* (Red = 3, Yellow = 1),
  most points leading. Tracks one team, not a player's combined total.
- **Worst Teams** — ranked by fewest points, GD as tiebreaker. The
  early-tournament filter (only teams on 0 pts with a negative GD) is on by
  default and relaxes automatically as the group stage fills out; you can also
  toggle it from the Report tab.

Team names are mapped to the sweepstake's localised spellings (Netherlands →
Holland, Korea Republic → South Korea, Côte d'Ivoire → Ivory Coast, United
States → USA, and so on).

### Tabs

| Tab | What it shows |
|---|---|
| **Dashboard** | At-a-glance leaders for both competitions |
| **Fixtures & Results** | The live match list (read-only) |
| **Standings** | Full group league tables |
| **Morning Report** | Live preview + **Export PNG** (1080px portrait) |
| **Allocations** | The fixed player → team reference |

## Winner Odds

The **Winner Odds** tab shows live tournament-winner odds for all 48 teams (with
their owner), and the dashboard surfaces the **top 5 favourites**. Odds come
from [The Odds API](https://the-odds-api.com), averaged across bookmakers and
converted to a normalised win-probability so the favourites update as teams go
out.

- It needs a free API key — paste it on the Winner Odds tab. The key is kept in
  `localStorage` (this browser only) and is **never committed**, so it's safe on
  a public Pages site.
- The winner market key defaults to `soccer_fifa_world_cup_winner`; the
  runner-up market key is configurable (left blank by default).
- The API is called directly from the browser. If your network blocks it
  (CORS), the tab shows a clear error — a small proxy would be the workaround.

## The Morning Report

The graphic is hand-built as an SVG (matching the spec's design system —
dark-green gradient, gold accents, DejaVu Sans) and rendered to PNG in the
browser, the web equivalent of the original `cairosvg` pipeline.

- Pick the **report date**. "Yesterday's Results" pulls completed matches from
  the day before; "Today's Fixtures" lists that day's games.
- The **day number** is computed from the tournament start date.
- Choose an export resolution (2× recommended for a crisp WhatsApp image) and
  hit **Export PNG**.

## Notes & caveats

- ESPN's endpoint is **unofficial** — it can change or rate-limit without
  notice. If a load fails you'll see a clear status with a **reload** link.
- It's called directly from your browser (no key, no backend). A corporate
  network, ad-blocker or VPN could block it; if so the status pill says so.
- Group labels aren't always present on the feed; they're shown when available.

## Project layout

```
index.html        markup + script order
styles.css        dark-green theme
js/data.js        fixed allocations, owner lookup, design tokens
js/flags.js       team -> emoji flag (Twemoji) lookup
flags/            bundled Twemoji flag SVGs (one per team)
js/espn.js        ESPN fetch + normalise + team-name mapping
js/live.js        live data layer (fetch-on-load, in-memory, no storage)
js/standings.js   all table computations (pure, derived from matches)
js/report.js      Morning Report SVG builder + PNG export
js/app.js         UI: tabs, live status, report controls
```

## Credits

Flag artwork is [Twemoji](https://github.com/twitter/twemoji) by Twitter,
licensed [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/). The SVGs are
bundled under `flags/` so they render identically on every device, independent
of the OS emoji font (notably the England and Scotland subdivision flags, which
Windows doesn't render natively).
