/* ============================================================================
 * snapshot-odds.js — Daily, central win-% snapshot for the odds Trend column.
 *
 * Run by .github/workflows/odds-snapshot.yml on a schedule. Fetches the
 * tournament-winner outright odds from The Odds API and appends today's
 * normalised win % per team to data/odds-history.json, which the page reads to
 * show win-% movement vs a previous day (no per-browser storage, no historical
 * odds API). It loads the app's own js modules so the parsing/normalisation and
 * team-name mapping match the live site exactly.
 *
 * API key: ODDS_API_KEY env (GitHub secret) if set, else the public key in
 * js/config.js. Date key uses the same host-region day as the app so the
 * snapshot dates line up with the site's "today".
 * ========================================================================== */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = process.cwd();
const FILE = path.join(ROOT, 'data', 'odds-history.json');
const KEEP_DAYS = 90;

// Load the browser IIFE modules into a shared context (same as the page).
const ctx = { console, Date, Math, Object, JSON, Intl, String, Array, RegExp, setTimeout, fetch, window: {} };
vm.createContext(ctx);
['js/config.js', 'js/data.js', 'js/espn.js', 'js/odds.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
});
const WC = ctx.window.WC;
const cfg = WC.Odds.getConfig();
const apiKey = process.env.ODDS_API_KEY || cfg.apiKey;
const region = cfg.region || 'uk';
const winnerKey = cfg.winnerKey || 'soccer_fifa_world_cup_winner';

if (!apiKey) { console.error('No API key (set ODDS_API_KEY or js/config.js apiKey).'); process.exit(1); }

const url = WC.Odds.BASE + '/sports/' + encodeURIComponent(winnerKey) +
  '/odds?regions=' + encodeURIComponent(region) + '&markets=outrights&oddsFormat=decimal&apiKey=' + encodeURIComponent(apiKey);

(async function () {
  const r = await fetch(url);
  if (!r.ok) { console.error('Odds API HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200)); process.exit(1); }
  const data = await r.json();
  const avg = WC.Odds.parseOutright(data);     // { appTeam: avg decimal odds }
  const prob = WC.Odds.impliedProbs(avg);      // { appTeam: win fraction (normalised) }
  const teams = Object.keys(prob);
  if (!teams.length) { console.error('No outright odds parsed — nothing to snapshot.'); process.exit(1); }

  const day = {};
  teams.forEach(function (t) { day[t] = Math.round(prob[t] * 1e5) / 1e5; });

  let hist = {};
  try { hist = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch (e) {}
  const today = WC.ESPN.londonDay(new Date());  // UK day, matching the site's trend basis
  hist[today] = day;
  Object.keys(hist).sort().slice(0, -KEEP_DAYS).forEach(function (d) { delete hist[d]; });

  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(hist) + '\n');
  console.log('Snapshot saved for ' + today + ' (' + teams.length + ' teams).');
})().catch(function (e) { console.error(e && e.stack || e); process.exit(1); });
