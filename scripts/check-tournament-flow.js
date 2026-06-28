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

console.log('Phase 8b — KNOCKOUT stage: losers surface as "knocked out" and the bracket advances');
// Two knockout-stage bugs:
//  1) the dashboard / Morning Report "Knocked Out" card read newlyEliminated(),
//     which only reported GROUP-stage exits — a side that lost its knockout tie
//     never showed up; and
//  2) currentBracket() filled the Round of 32 from the group tables but never
//     read played knockout results, so the Round of 16 stayed on "Winner of
//     Match NN" even after the R32 games were decided.
// Build a finished R32 tie between the two teams an actual R32 slot pairs, then
// assert the loser is newly eliminated on the tie's day AND the winner advances.
(function knockoutStageTest() {
  var br0 = WC.Sim.currentBracket(s5);
  var r32def = br0.rounds[0].ties.filter(function (t) { return t.a && t.a.team && t.b && t.b.team; })[0];
  ok(!!r32def, 'P8b: an R32 tie has two concrete teams to play');
  if (!r32def) return;
  var koDate = '2030-07-01';   // group fixtures carry no date, so they always count; this one gates on the cutoff
  var winnerTeam = r32def.a.team, loserTeam = r32def.b.team;
  var sko = { matches: s5.matches.concat([
    { _espnId: 'ko-' + r32def.game, home: winnerTeam, away: loserTeam, group: '', status: 'ft', homeScore: 2, awayScore: 0, date: koDate, _ts: 9000 }
  ]) };

  // (1) The knockout loser is newly eliminated on the day of the tie — and was
  // NOT already out the day before (it was a group winner/runner-up, i.e. through).
  var newly = S.newlyEliminated(sko, koDate);
  ok(newly.indexOf(loserTeam) !== -1, 'P8b: knockout-tie loser (' + loserTeam + ') is in newlyEliminated on the tie day');
  ok(S.newlyEliminated(sko, '2030-06-30').indexOf(loserTeam) === -1, 'P8b: the loser was NOT reported out the day before the tie');
  ok(!!S.knockedOut(sko)[loserTeam], 'P8b: knockout-tie loser is in knockedOut()');

  // (2) currentBracket advances the real winner: the R32 tie is marked decided,
  // and the Round-of-16 tie fed by that game now carries the winner as a concrete
  // team instead of only a "Winner of Match NN" placeholder.
  var br = WC.Sim.currentBracket(sko);
  var r32 = br.rounds[0].ties.filter(function (t) { return t.game === r32def.game; })[0];
  ok(r32 && r32.winner === winnerTeam, 'P8b: the played R32 tie reports winner=' + winnerTeam);
  var r16 = br.rounds.filter(function (r) { return r.name === 'Round of 16'; })[0];
  var feeder = r16.ties.filter(function (t) { return (t.a && t.a.team === winnerTeam) || (t.b && t.b.team === winnerTeam); })[0];
  ok(!!feeder, 'P8b: the R32 winner (' + winnerTeam + ') advances into a concrete Round-of-16 slot');

  // (3) The OTHER side of that R16 tie (its R32 feeder is unplayed here) shows the
  // two candidate teams, not just "Winner of Match NN" — so the bracket reads
  // "Canada v NED/MAR" rather than "Canada v Winner of Match 75".
  if (feeder) {
    var openCands = (feeder.a && feeder.a.team === winnerTeam) ? feeder.bCands : feeder.aCands;
    ok(!!(openCands && openCands[0] && openCands[1]),
      'P8b: the undecided side of the R16 tie shows both candidate teams (' + (openCands ? openCands.join('/') : 'none') + ')');
  }
})();

console.log('Phase 8c — MORNING REPORT: knocked-out teams struck in disciplinary; wooden spoon shows the result');
(function reportTest() {
  function mk(h, a, hs, as, date, cards) {
    return { _espnId: h + '|' + a, home: h, away: a, homeScore: hs, awayScore: as, status: 'ft', group: 'Group B', date: date, _ts: Date.parse(date + 'T18:00:00Z'), cards: cards || [] };
  }
  // Finished Group B: Qatar bottom (eliminated) and carrying a red card, so it's
  // in both the Disciplinary table and knockedOut(). One complete group → the
  // group stage (and the wooden spoon) is settled.
  var done = { matches: [
    mk('Switzerland', 'Qatar', 1, 1, '2026-06-13', [{ team: 'away', player: 'A', type: 'red' }]),
    mk('Canada', 'Bosnia', 1, 0, '2026-06-13'),
    mk('Canada', 'Qatar', 2, 1, '2026-06-18'),
    mk('Switzerland', 'Bosnia', 1, 1, '2026-06-18'),
    mk('Bosnia', 'Qatar', 2, 1, '2026-06-24'),
    mk('Switzerland', 'Canada', 1, 0, '2026-06-24')
  ] };
  var ko = S.knockedOut(done), disc5 = S.disciplinary(done).slice(0, 5);
  ok(!!ko['Qatar'] && disc5.some(function (r) { return r.team === 'Qatar'; }), 'P8c: Qatar is knocked out AND in the Disciplinary top 5');

  var rep = null;
  if (noThrow('P8c:Report.build (settled)', function () { rep = WC.Report.build(done, { flags: {}, reportDate: '2026-06-25' }); })) {
    // T.red = '#e8503a' — one red strike <line> per knocked-out disciplinary row.
    var strikes = (rep.svg.match(/<line [^>]*stroke="#e8503a"/g) || []).length;
    var outInDisc = disc5.filter(function (r) { return ko[r.team]; }).length;
    ok(strikes === outInDisc && strikes > 0, 'P8c: every knocked-out disciplinary row is struck through (' + strikes + ' = ' + outInDisc + ')');
    ok(rep.svg.indexOf('WOODEN SPOON · SETTLED') !== -1, 'P8c: the Wooden Spoon result card is shown once the group stage is settled');
    ok(rep.svg.indexOf('WORST TEAMS') === -1, 'P8c: the Worst Teams race table is replaced by the result');
  }

  // While the group stage is still running, the race table stays (no result card).
  var racing = { matches: done.matches.filter(function (m) { return m.date !== '2026-06-24'; }) };  // drop matchday 3
  var rep2 = null;
  if (noThrow('P8c:Report.build (in progress)', function () { rep2 = WC.Report.build(racing, { flags: {}, reportDate: '2026-06-19' }); })) {
    ok(rep2.svg.indexOf('WORST TEAMS') !== -1, 'P8c: mid-group-stage, the Worst Teams race table is shown');
    ok(rep2.svg.indexOf('WOODEN SPOON · SETTLED') === -1, 'P8c: mid-group-stage, no settled wooden-spoon result card');
  }
})();

console.log('Phase 8 — RENDER layer: knocked-out teams are greyed in the dashboard');
// Regression test for the real-data bug: a freshly-eliminated team (e.g. Qatar,
// 4th in a finished group) showed a red ✗ in the Standings table but was NOT
// greyed in the dashboard Disciplinary table. Root cause was render-only: when
// the "Knocked Out" card was shown (newlyEliminated > 0), its panel reused the
// `ko` variable, shadowing the knockedOut() map the greying reads from — so the
// greying silently fell back to "no one is out". The compute layer (knockedOut)
// was always correct, which is why a clean compute-only repro never caught it.
// This drives the actual render functions through a minimal DOM stub.
(function renderLayerTest() {
  // --- minimal DOM stub (enough for el()/innerHTML tables/matchRow) ---------
  function TextNode(t) { this.nodeType = 3; this.textContent = t == null ? '' : String(t); }
  function Element(tag) {
    this.nodeType = 1; this.tagName = tag; this.childNodes = []; this.attributes = {};
    this._class = ''; this._html = null; this.style = {}; this.dataset = {}; this.parentNode = null;
    var self = this;
    this.classList = {
      add: function (c) { var a = self._class ? self._class.split(/\s+/) : []; if (a.indexOf(c) < 0) a.push(c); self._class = a.join(' '); },
      remove: function (c) { self._class = (self._class ? self._class.split(/\s+/) : []).filter(function (x) { return x !== c; }).join(' '); },
      contains: function (c) { return (self._class ? self._class.split(/\s+/) : []).indexOf(c) >= 0; },
      toggle: function (c, on) { if (on === undefined) on = !this.contains(c); if (on) this.add(c); else this.remove(c); return on; }
    };
  }
  Object.defineProperty(Element.prototype, 'className', { get: function () { return this._class; }, set: function (v) { this._class = v == null ? '' : String(v); } });
  // Setting innerHTML replaces children; a later appendChild adds AFTER it — so
  // serialize() concatenates the parsed string and any appended child nodes,
  // matching how a real browser merges `el.innerHTML = ...; el.appendChild(...)`.
  Object.defineProperty(Element.prototype, 'innerHTML', { get: function () { return this._html; }, set: function (v) { this._html = v; this.childNodes = []; } });
  Element.prototype.setAttribute = function (k, v) { this.attributes[k] = String(v); if (k === 'class') this._class = String(v); };
  Element.prototype.getAttribute = function (k) { return this.attributes[k]; };
  Element.prototype.addEventListener = function () {};
  Element.prototype.appendChild = function (c) { if (c) { c.parentNode = this; this.childNodes.push(c); } return c; };
  Element.prototype.insertBefore = function (n, ref) { var i = this.childNodes.indexOf(ref); if (i < 0) i = this.childNodes.length; this.childNodes.splice(i, 0, n); if (n) n.parentNode = this; return n; };
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function serialize(n) {
    if (!n) return '';
    if (n.nodeType === 3) return esc(n.textContent);
    var cls = n._class ? (' class="' + n._class + '"') : '';
    var attrs = ''; Object.keys(n.attributes).forEach(function (k) { if (k !== 'class') attrs += ' ' + k + '="' + n.attributes[k] + '"'; });
    var inner = (n._html != null ? n._html : '') + n.childNodes.map(serialize).join('');
    return '<' + n.tagName + cls + attrs + '>' + inner + '</' + n.tagName + '>';
  }
  global.document = {
    createElement: function (t) { return new Element(t); },
    createTextNode: function (t) { return new TextNode(t); },
    addEventListener: function () {}, querySelector: function () { return null; }, querySelectorAll: function () { return []; }
  };

  // app.js needs ESPN (localDay) + a Live snapshot it can read on render.
  load('js/espn.js');
  var snapshot = { matches: [], earlyFilter: true, loading: false, detailLoading: false };
  global.window.WC.Live = { get: function () { return snapshot; }, onChange: function () {}, load: function () {}, setEarlyFilter: function () {}, setFooter: function () {} };
  if (!noThrow('P8:load app.js', function () { load('js/app.js'); })) return;

  // Captured-from-real-data slice: a finished Group B with Qatar bottom (4th) and
  // carrying card points (so it appears in the Disciplinary table), eliminated by
  // the latest match day — exactly the live shape that triggered the bug.
  function mk(h, a, hs, as, date, cards) {
    return { _espnId: h + '|' + a, home: h, away: a, homeScore: hs, awayScore: as, status: 'ft', group: 'Group B', date: date, _ts: Date.parse(date + 'T18:00:00Z'), cards: cards || [] };
  }
  snapshot.matches = [
    mk('Switzerland', 'Qatar', 1, 1, '2026-06-13', [{ team: 'away', player: 'A', type: 'yellow' }, { team: 'away', player: 'B', type: 'red' }]),
    mk('Canada', 'Bosnia', 1, 0, '2026-06-13'),
    mk('Canada', 'Qatar', 2, 1, '2026-06-18'),
    mk('Switzerland', 'Bosnia', 1, 1, '2026-06-18'),
    mk('Bosnia', 'Qatar', 2, 1, '2026-06-24'),
    mk('Switzerland', 'Canada', 1, 0, '2026-06-24')
  ];

  // Preconditions: the scenario actually exercises the buggy code path.
  ok(S.groupStatus(snapshot)['Qatar'] === 'eliminated', 'P8: Qatar is eliminated in groupStatus (drives the Standings ✗)');
  ok(!!S.knockedOut(snapshot)['Qatar'], 'P8: Qatar is in knockedOut() (compute layer correct)');
  ok(S.disciplinary(snapshot).some(function (r) { return r.team === 'Qatar'; }), 'P8: Qatar appears in the Disciplinary table (has card points)');
  var lastDay = snapshot.matches.reduce(function (mx, m) { return m.date > mx ? m.date : mx; }, '');
  ok(S.newlyEliminated(snapshot, lastDay).length > 0, 'P8: a team is newly eliminated on the latest day (shows the "Knocked Out" card)');

  // Any disciplinary team that knockedOut() marks must end up greyed in the
  // rendered dashboard. Greying renders as a <td class="team-out">…Team…</td>.
  function greyedTeams(html) {
    var cells = html.match(/<td class="team-out">[\s\S]*?<\/td>/g) || [];
    var set = {}; cells.forEach(function (td) { WC.TEAMS.forEach(function (t) { if (td.indexOf(t) !== -1) set[t] = 1; }); }); return set;
  }
  var dashHTML = null;
  if (noThrow('P8:render dashboard', function () { dashHTML = serialize(WC._tabRenderers.dashboard()); })) {
    var grey = greyedTeams(dashHTML);
    ok(!!grey['Qatar'], 'P8: Qatar IS greyed (team-out) in the dashboard Disciplinary table');
    var ko = S.knockedOut(snapshot);
    var missed = S.disciplinary(snapshot).filter(function (r) { return ko[r.team] && !grey[r.team]; }).map(function (r) { return r.team; });
    ok(missed.length === 0, 'P8: every knocked-out disciplinary team is greyed (missed: ' + (missed.join(', ') || 'none') + ')');
  }

  // The Allocations tab greys off the same map; confirm it stays consistent too.
  var allocHTML = null;
  if (noThrow('P8:render allocations', function () { allocHTML = serialize(WC._tabRenderers.allocations()); })) {
    ok(!!greyedTeams(allocHTML)['Qatar'], 'P8: Qatar IS greyed (team-out) in the Allocations table');
  }
})();

console.log('');
if (fails.length) { console.log('FAILED — ' + fails.length + ' issue(s)'); process.exit(1); }
console.log('OK — group-stage tournament flow works end to end with the current allocations.');
