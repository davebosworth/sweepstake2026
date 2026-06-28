/* ============================================================================
 * check-allocations.js — Smoke-test that the app still works after the team
 * allocations in js/data.js are updated (e.g. for the next World Cup).
 *
 * Run:  node scripts/check-allocations.js
 *
 * It loads the real reference data (data.js, flags.js) and the pure compute
 * modules, then:
 *   1. reports any allocated team missing a flag (WC.FLAG) or code (WC.ABBR) —
 *      these degrade gracefully (no flag / first-three-letters code) but are
 *      worth filling in;
 *   2. builds a synthetic but complete 12-group stage from the allocated teams
 *      and exercises every group-stage subsystem (tables, status, thirds race,
 *      worst teams, disciplinary, knocked-out, bracket, Monte Carlo, the two PNG
 *      builders) — failing loudly if any throws.
 *
 * Exit code is non-zero if a subsystem errors, so it can gate CI.
 * ========================================================================== */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
global.window = {};
function load(rel) { (new Function('window', fs.readFileSync(path.join(root, rel), 'utf8')))(global.window); }
['js/data.js', 'js/flags.js', 'js/standings.js', 'js/annexc.js', 'js/sim.js', 'js/report.js'].forEach(load);
var WC = global.window.WC;

var problems = [];

// 1. Allocation sanity + reference-data coverage.
if (!WC.PLAYERS || !WC.PLAYERS.length) problems.push('No players defined in data.js');
var teamCount = WC.TEAMS.length;
console.log('Players: ' + (WC.PLAYERS || []).length + '  ·  Teams: ' + teamCount);
if (teamCount % 4 !== 0) console.log('  ! team count is not a multiple of 4 — groups assume four-team groups');
var noFlag = WC.TEAMS.filter(function (t) { return !WC.flagSrc(t); });
var noAbbr = WC.TEAMS.filter(function (t) { return !(WC.ABBR && WC.ABBR[t]); });
if (noFlag.length) console.log('  ! missing flags (no image, degrades gracefully): ' + noFlag.join(', '));
if (noAbbr.length) console.log('  ! missing 3-letter codes (falls back to first letters): ' + noAbbr.join(', '));

// 2. Build a synthetic complete group stage and exercise every subsystem.
var letters = 'ABCDEFGHIJKL'.split('');
var groups = {};
WC.TEAMS.forEach(function (t, i) { var g = letters[Math.floor(i / 4)]; if (g) (groups[g] = groups[g] || []).push(t); });
var matches = [];
Object.keys(groups).forEach(function (g) {
  var T = groups[g];
  if (T.length < 4) return;
  [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]].forEach(function (p) {
    matches.push({ home: T[p[0]], away: T[p[1]], homeScore: 3 - p[0], awayScore: 3 - p[1], status: 'ft', group: 'Group ' + g, cards: [{ team: 'home', type: 'yellow' }] });
  });
});
var state = { matches: matches };
var odds = WC.TEAMS.map(function (t, i) { return { team: t, winnerProb: i < 30 ? (0.2 - i * 0.005) : 0 }; });

function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { console.log('  ✗ ' + name + ' — ' + e.message); problems.push(name + ': ' + e.message); }
}
console.log('Subsystems:');
check('groupTables', function () { WC.Standings.groupTables(state); });
check('groupStatus', function () { WC.Standings.groupStatus(state); });
check('thirdPlaceRace', function () { WC.Standings.thirdPlaceRace(state); });
check('worstTeams', function () { WC.Standings.worstTeams(state); });
check('disciplinary', function () { WC.Standings.disciplinary(state); });
check('knockedOut', function () { WC.Standings.knockedOut(state); });
check('currentBracket', function () { if (!WC.Sim.currentBracket(state)) throw new Error('returned null'); });
check('project (Monte Carlo)', function () { if (!WC.Sim.project(state, odds, 300)) throw new Error('returned null'); });
check('Report.build', function () { WC.Report.build(state, { flags: {}, reportDate: '2030-06-15' }); });
check('Report.buildAllocations', function () { WC.Report.buildAllocations(state, { flags: {}, reportDate: '2030-06-15' }); });

// every allocated team should get a group-stage status
var status = WC.Standings.groupStatus(state);
var noStatus = WC.TEAMS.filter(function (t) { return !status[t]; });
if (noStatus.length) problems.push('teams with no status: ' + noStatus.join(', '));
else console.log('  ✓ every team has a group-stage status');

console.log('');
if (problems.length) { console.log('FAILED (' + problems.length + ' issue' + (problems.length === 1 ? '' : 's') + ')'); process.exit(1); }
console.log('OK — the app works with the current allocations.');
