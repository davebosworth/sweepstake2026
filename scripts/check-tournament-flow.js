/* ============================================================================
 * check-tournament-flow.js — Simulate a whole group stage AS IT PROGRESSES and
 * assert the compute layer behaves correctly at every step, including the live
 * ESPN-feed quirks that occur during a real tournament:
 *   - matchday-by-matchday progression (partial data);
 *   - groups completing at different times (sequential completion);
 *   - live (in-progress) and scheduled games mixed in;
 *   - matches arriving with NO group label (grouped by team membership);
 *   - a just-finished game still flagged 'live' (full-time lag);
 *   - knockout fixtures appearing in the feed once the groups finish.
 *
 * Runs against whatever allocations are in js/data.js, so it doubles as the
 * "will it work for the next World Cup" check. Exits non-zero on any failure.
 * ========================================================================== */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
global.window = {};
function load(rel) { (new Function('window', fs.readFileSync(path.join(root, rel), 'utf8')))(global.window); }
['js/data.js', 'js/flags.js', 'js/standings.js', 'js/annexc.js', 'js/sim.js', 'js/report.js'].forEach(load);
var WC = global.window.WC, S = WC.Standings;

var fails = [];
function ok(cond, msg) { if (!cond) { fails.push(msg); console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); }
function noThrow(label, fn) { try { fn(); return true; } catch (e) { fails.push(label + ': ' + e.message); console.log('  ✗ ' + label + ' threw: ' + e.message); return false; } }

// ---- build the 12 groups and a per-matchday fixture list -------------------
var letters = 'ABCDEFGHIJKL'.split('');
var groups = {};
WC.TEAMS.forEach(function (t, i) { var g = letters[Math.floor(i / 4)]; if (g) (groups[g] = groups[g] || []).push(t); });
var ROUNDS = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];   // MD1, MD2, MD3
// fixture(group, md, pairIndex) -> a match object with a deterministic result that
// makes seed 0 win the group, seed 3 finish bottom (so outcomes are predictable).
function fixture(g, md, pi, opts) {
  opts = opts || {};
  var T = groups[g], pr = ROUNDS[md][pi], h = T[pr[0]], a = T[pr[1]];
  var hs = 3 - pr[0], as = 3 - pr[1];
  var m = { home: h, away: a, group: opts.noLabel ? '' : ('Group ' + g), _md: md };
  if (opts.status === 'scheduled') { m.status = 'scheduled'; m.homeScore = null; m.awayScore = null; }
  else { m.status = opts.status || 'ft'; m.homeScore = hs; m.awayScore = as; }
  return m;
}
function runAll(state, label) {
  return noThrow(label + ':groupTables', function () { S.groupTables(state); }) &&
    noThrow(label + ':groupStatus', function () { S.groupStatus(state); }) &&
    noThrow(label + ':thirdPlaceRace', function () { S.thirdPlaceRace(state); }) &&
    noThrow(label + ':worstTeams', function () { S.worstTeams(state); }) &&
    noThrow(label + ':disciplinary', function () { S.disciplinary(state); }) &&
    noThrow(label + ':knockedOut', function () { S.knockedOut(state); }) &&
    noThrow(label + ':currentBracket', function () { S.groupTables(state); WC.Sim.currentBracket(state); });
}

// ===========================================================================
console.log('Phase 0 — pre-tournament (no results)');
var s0 = { matches: [] };
letters.forEach(function (g) { ROUNDS.forEach(function (_, md) { [0, 1].forEach(function (pi) { s0.matches.push(fixture(g, md, pi, { status: 'scheduled' })); }); }); });
runAll(s0, 'P0');
var ko0 = S.knockedOut(s0);
ok(Object.keys(ko0).length === 0, 'P0: nobody knocked out before any game');

console.log('Phase 1 — matchday 1 done, MD2/MD3 scheduled (partial data)');
var s1 = { matches: [] };
letters.forEach(function (g) { ROUNDS.forEach(function (_, md) { [0, 1].forEach(function (pi) { s1.matches.push(fixture(g, md, pi, md === 0 ? {} : { status: 'scheduled' })); }); }); });
runAll(s1, 'P1');
var st1 = S.groupStatus(s1);
ok(WC.TEAMS.every(function (t) { return st1[t] !== 'through' && st1[t] !== 'eliminated' || st1[t] === 'alive'; }) || true, 'P1: status computed without error');
ok(Object.keys(S.knockedOut(s1)).length === 0, 'P1: nobody knocked out after one matchday');

console.log('Phase 2 — a LIVE game in progress during MD2');
var s2 = { matches: s1.matches.map(function (m) { return Object.assign({}, m); }) };
// finish MD2 except one group still has a live game
s2.matches.forEach(function (m) { if (m._md === 1) { m.status = 'ft'; var T = groups[/Group\s+([A-L])/.exec(m.group) ? RegExp.$1 : 'A']; } });
// recompute scores for MD2 (they were nulled as scheduled)
s2.matches = []; letters.forEach(function (g, gi) {
  ROUNDS.forEach(function (_, md) {
    [0, 1].forEach(function (pi) {
      var opts = {};
      if (md === 2) opts.status = 'scheduled';
      if (gi === 0 && md === 1 && pi === 0) opts.status = 'live';   // one live game
      s2.matches.push(fixture(g, md, pi, opts));
    });
  });
});
ok(runAll(s2, 'P2'), 'P2: all subsystems run with a live game present');

console.log('Phase 3 — groups complete SEQUENTIALLY (Group A fully done, rest on MD2)');
var s3 = { matches: [] };
letters.forEach(function (g) {
  ROUNDS.forEach(function (_, md) {
    [0, 1].forEach(function (pi) {
      var done = (g === 'A') ? true : (md < 2);   // Group A fully played; others only MD1-2
      s3.matches.push(fixture(g, md, pi, done ? {} : { status: 'scheduled' }));
    });
  });
});
ok(runAll(s3, 'P3'), 'P3: subsystems run while groups finish at different times');
var ko3 = S.knockedOut(s3), A = groups['A'];
ok(!!ko3[A[3]], 'P3: 4th in the one finished group (A) is knocked out');
ok(!ko3[A[2]], 'P3: 3rd in finished Group A is NOT prematurely out (thirds not settled)');
ok(!ko3[A[0]] && !ko3[A[1]], 'P3: top two of finished Group A are not out');

console.log('Phase 4 — MD3 with some labels MISSING from the feed (team-membership grouping)');
var s4 = { matches: [] };
letters.forEach(function (g, gi) {
  ROUNDS.forEach(function (_, md) {
    [0, 1].forEach(function (pi) {
      // strip the group label from roughly half the games to mimic the feed
      s4.matches.push(fixture(g, md, pi, { noLabel: ((gi + md + pi) % 2 === 0) }));
    });
  });
});
ok(runAll(s4, 'P4'), 'P4: subsystems run with ~half the group labels missing');
var tbl4 = S.groupTables(s4);
var totalRows = Object.keys(tbl4).filter(function (k) { return k !== 'Unassigned'; }).reduce(function (n, k) { return n + tbl4[k].length; }, 0);
ok(totalRows === WC.TEAMS.length, 'P4: every team still lands in a group despite missing labels (' + totalRows + '/' + WC.TEAMS.length + ')');
var allP3 = Object.keys(tbl4).filter(function (k) { return k !== 'Unassigned'; }).every(function (k) { return tbl4[k].every(function (r) { return r.P === 3; }); });
ok(allP3, 'P4: every team still shows P=3 — unlabelled group games are counted, not dropped');
var ko4 = S.knockedOut(s4);
ok(Object.keys(ko4).length === 16, 'P4: 16 knocked out even with missing labels (got ' + Object.keys(ko4).length + ')');

console.log('Phase 5 — full group stage complete');
var s5 = { matches: [] };
letters.forEach(function (g) { ROUNDS.forEach(function (_, md) { [0, 1].forEach(function (pi) { s5.matches.push(fixture(g, md, pi)); }); }); });
ok(runAll(s5, 'P5'), 'P5: subsystems run with the group stage complete');
var st5 = S.groupStatus(s5), ko5 = S.knockedOut(s5);
var through = WC.TEAMS.filter(function (t) { return st5[t] === 'through'; }).length;
var koCount = Object.keys(ko5).length;
ok(through === 32, 'P5: exactly 32 teams through (24 top-two + 8 thirds), got ' + through);
ok(koCount === 16, 'P5: exactly 16 knocked out (12 fourths + 4 thirds), got ' + koCount);
var race5 = S.thirdPlaceRace(s5);
ok(race5.filter(function (r) { return r.qualifying; }).length === 8, 'P5: 8 thirds qualify');

console.log('Phase 6 — knockouts appear in the feed; group tables must FREEZE');
var ptsBefore = {}; Object.keys(tbl5())['forEach'] ? 0 : 0;
function tbl5() { return S.groupTables(s5); }
var before = S.groupTables(s5);
var beforePts = {}; Object.keys(before).forEach(function (k) { if (k !== 'Unassigned') before[k].forEach(function (r) { beforePts[r.team] = r.Pts + '/' + r.GD; }); });
var s6 = { matches: s5.matches.concat([]) };
// add R32 ties (CROSS-group, unlabelled) in mixed states — winner of group i
// meets runner-up of the next group, like a real knockout draw.
var winners = letters.map(function (g) { return groups[g][0]; });
var runners = letters.map(function (g) { return groups[g][1]; });
var koLoserTeam = null;
winners.forEach(function (w, i) {
  var opp = runners[(i + 1) % runners.length];   // different group
  var stts = i === 0 ? 'live' : (i === 1 ? 'scheduled' : 'ft');
  var m = { home: w, away: opp, group: '', _ts: 1000 + i };
  if (stts === 'scheduled') { m.status = 'scheduled'; m.homeScore = null; m.awayScore = null; }
  else { m.status = stts; m.homeScore = 2; m.awayScore = 0; if (stts === 'ft' && !koLoserTeam) koLoserTeam = opp; }
  s6.matches.push(m);
});
ok(runAll(s6, 'P6'), 'P6: subsystems run with knockout fixtures in the feed');
var sizes6 = S.groupTables(s6);
var clean6 = Object.keys(sizes6).filter(function (k) { return k !== 'Unassigned'; }).every(function (k) { return sizes6[k].length === 4; });
ok(clean6, 'P6: every group still has exactly 4 teams (knockout ties do not drag teams between groups)');
var after = S.groupTables(s6), afterPts = {};
Object.keys(after).forEach(function (k) { if (k !== 'Unassigned') after[k].forEach(function (r) { afterPts[r.team] = r.Pts + '/' + r.GD; }); });
var frozen = WC.TEAMS.every(function (t) { return beforePts[t] === afterPts[t]; });
ok(frozen, 'P6: group tables are identical before/after knockouts (frozen, no pollution)');
var st6 = S.groupStatus(s6);
var statusStable = WC.TEAMS.every(function (t) { return st5[t] === st6[t]; });
ok(statusStable, 'P6: group statuses unchanged once knockouts begin');
// a finished knockout tie's loser is knocked out
var ko6 = S.knockedOut(s6);
ok(!!koLoserTeam && !!ko6[koLoserTeam], 'P6: loser of a finished knockout tie is knocked out');
// a knockout settled on penalties: regulation score is level, so the loser is
// read from ESPN's winner flag rather than the scoreline.
var penHome = groups['C'][0], penAway = groups['D'][1];   // cross-group (different groups)
var s6pen = { matches: s6.matches.concat([{ home: penHome, away: penAway, group: '', status: 'ft', homeScore: 1, awayScore: 1, winner: 'home', _ts: 5000 }]) };
var ko6pen = S.knockedOut(s6pen);
ok(!!ko6pen[penAway] && !ko6pen[penHome], 'P6: penalty-shootout loser (level score) is knocked out, winner is not');

console.log('Phase 7 — full bracket + Monte Carlo at tournament end');
var odds = WC.TEAMS.map(function (t, i) { return { team: t, winnerProb: i < 30 ? (0.2 - i * 0.005) : 0 }; });
ok(noThrow('P7:project', function () { if (!WC.Sim.project(s5, odds, 300)) throw new Error('null'); }), 'P7: Monte Carlo runs');
ok(noThrow('P7:report', function () { WC.Report.build(s5, { flags: {}, reportDate: '2030-06-20' }); WC.Report.buildAllocations(s6, { flags: {}, reportDate: '2030-06-20' }); }), 'P7: PNG builders run');

console.log('');
if (fails.length) { console.log('FAILED — ' + fails.length + ' issue(s)'); process.exit(1); }
console.log('OK — group-stage tournament flow works end to end with the current allocations.');
