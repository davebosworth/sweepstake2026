/* ============================================================================
 * sim.js — Monte Carlo projections for the sweepstake.
 *
 * Model (all client-side, recomputed from live data):
 *  - Each team gets an Elo rating: a base from the bookmaker outright win %
 *    (log-odds scaled), then nudged by actual results so far (a blend that
 *    leans more on results as games are played).
 *  - A match is modelled with Poisson goals whose supremacy comes from the Elo
 *    gap; this gives win/draw/loss probabilities and a likely scoreline.
 *  - Each simulation plays out the remaining group games to final standings,
 *    qualifies the top two per group plus the eight best third-placed teams, and
 *    drops them into the official 2026 Round-of-32 map (winner/runner-up slots are
 *    fixed by group; the eight thirds are assigned to their eligible slots), then
 *    plays the real bracket tree to a champion and runner-up (knockout draws go to
 *    a rating-weighted shootout).
 *  - Run many times -> each team's champion % and runner-up %, and each
 *    player's expected return from the £80 winner and £20 runner-up prizes.
 *  - A single most-likely pass builds the projected bracket the predictor shows.
 *
 * It's a model/projection (the real knockout draw isn't a pure seeding), so it's
 * labelled as such in the UI.
 * ========================================================================== */
(function (WC) {
  'use strict';

  var TOTAL_GOALS = 2.6;   // league-average goals per game, split by supremacy
  var ELO_SCALE = 120;     // log-odds -> Elo spread
  var RESULT_K = 18;       // how hard finished results nudge the odds-based Elo

  /* ---- ratings: Elo from odds, nudged by results -------------------------- */
  function ratings(state, oddsRows) {
    var prob = {};
    (oddsRows || []).forEach(function (r) { if (r.winnerProb != null && r.winnerProb > 0) prob[r.team] = r.winnerProb; });
    var ls = WC.TEAMS.map(function (t) { return prob[t] ? Math.log(prob[t]) : null; }).filter(function (x) { return x != null; });
    if (ls.length < 24) return null;   // not enough odds to model
    var mean = ls.reduce(function (a, b) { return a + b; }, 0) / ls.length;
    var min = Math.min.apply(null, ls);
    var elo = {};
    WC.TEAMS.forEach(function (t) {
      var lp = prob[t] ? Math.log(prob[t]) : (min - 0.5);   // unpriced team = weakest
      elo[t] = 1500 + ELO_SCALE * (lp - mean);
    });
    // Replay finished games chronologically, nudging both teams' Elo.
    (state.matches || []).filter(function (m) {
      return m.status === 'ft' && m.homeScore != null && m.awayScore != null && elo[m.home] != null && elo[m.away] != null;
    }).sort(function (a, b) { return (a._ts || 0) - (b._ts || 0); }).forEach(function (m) {
      var ea = 1 / (1 + Math.pow(10, (elo[m.away] - elo[m.home]) / 400));
      var sa = m.homeScore > m.awayScore ? 1 : (m.homeScore < m.awayScore ? 0 : 0.5);
      var d = RESULT_K * (sa - ea);
      elo[m.home] += d; elo[m.away] -= d;
    });
    return elo;
  }

  /* ---- match model -------------------------------------------------------- */
  function lambdas(eloA, eloB) {
    var sup = Math.max(-3, Math.min(3, (eloA - eloB) / 200));
    return [Math.max(0.2, (TOTAL_GOALS + sup) / 2), Math.max(0.2, (TOTAL_GOALS - sup) / 2)];
  }
  function samplePoisson(lam) {
    var L = Math.exp(-lam), k = 0, p = 1;
    do { k++; p *= Math.random(); } while (p > L);
    return k - 1;
  }
  function pmf(lam, max) {
    var out = [Math.exp(-lam)], term = out[0];
    for (var k = 1; k <= max; k++) { term = term * lam / k; out[k] = term; }
    return out;
  }
  // Analytic win/draw/loss + likeliest exact score, for display.
  function predict(eloA, eloB) {
    var lam = lambdas(eloA, eloB), a = pmf(lam[0], 10), b = pmf(lam[1], 10);
    var ph = 0, pd = 0, pa = 0, best = 0, sh = 0, sa = 0;
    for (var i = 0; i <= 10; i++) for (var j = 0; j <= 10; j++) {
      var pr = a[i] * b[j];
      if (i > j) ph += pr; else if (i < j) pa += pr; else pd += pr;
      if (pr > best) { best = pr; sh = i; sa = j; }
    }
    return { home: ph, draw: pd, away: pa, score: [sh, sa] };
  }
  // Knockout winner of a single match (sampled).
  function koWinner(a, b, elo) {
    if (a == null) return b; if (b == null) return a;
    var lam = lambdas(elo[a], elo[b]), ga = samplePoisson(lam[0]), gb = samplePoisson(lam[1]);
    if (ga > gb) return a; if (gb > ga) return b;
    return Math.random() < 1 / (1 + Math.pow(10, (elo[b] - elo[a]) / 400)) ? a : b;
  }
  // Knockout pick + win % + likely score (deterministic, for the predictor).
  function koPredict(a, b, elo) {
    var p = predict(elo[a], elo[b]);
    var eA = 1 / (1 + Math.pow(10, (elo[b] - elo[a]) / 400));
    var winA = p.home + p.draw * eA;                 // incl. shootout
    var pick = winA >= 0.5 ? a : b;
    return { a: a, b: b, pick: pick, winPct: Math.max(winA, 1 - winA), score: p.score, pens: p.score[0] === p.score[1] };
  }

  /* ---- group tables & qualifiers ------------------------------------------ */
  function groupMatches(state) {
    var by = {};
    (state.matches || []).forEach(function (m) {
      var g = /group\s+([a-l])\b/i.exec(m.group || '');
      if (g && m.home && m.away) (by[g[1].toUpperCase()] = by[g[1].toUpperCase()] || []).push(m);
    });
    return by;
  }
  // Build a group's table; unfinished games are decided by `decide(home,away)`
  // which returns [homeGoals, awayGoals].
  function groupTable(matches, elo, decide) {
    var rec = {};
    function R(t) { return rec[t] || (rec[t] = { team: t, Pts: 0, GD: 0, GF: 0 }); }
    matches.forEach(function (m) {
      var hs, as;
      if (m.status === 'ft' && m.homeScore != null) { hs = m.homeScore; as = m.awayScore; }
      else { var d = decide(m.home, m.away); hs = d[0]; as = d[1]; }
      var H = R(m.home), A = R(m.away);
      H.GF += hs; A.GF += as; H.GD += hs - as; A.GD += as - hs;
      if (hs > as) H.Pts += 3; else if (hs < as) A.Pts += 3; else { H.Pts++; A.Pts++; }
    });
    return Object.keys(rec).map(function (k) { return rec[k]; }).sort(function (a, b) {
      return b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF || (elo[b.team] - elo[a.team]);
    });
  }
  /* ---- official bracket: build the Round-of-32 ties ----------------------- */
  // Top 2 per group fill the winner/runner-up slots; the eight best third-placed
  // teams are assigned to the third slots by FIFA's eligible-group rule (a
  // bipartite matching). Returns the 16 ties as team-name pairs following the
  // official 2026 match map (R32_DEF). `decide(home,away)` settles unplayed games.
  function buildR32(byGroup, elo, decide) {
    var order = {}, thirds = [];
    Object.keys(byGroup).forEach(function (k) {
      var tbl = groupTable(byGroup[k], elo, decide);
      order[k] = tbl.map(function (r) { return r.team; });
      if (tbl[2]) thirds.push({ group: k, row: tbl[2] });
    });
    thirds.sort(function (a, b) { return b.row.Pts - a.row.Pts || b.row.GD - a.row.GD || b.row.GF - a.row.GF || (elo[b.row.team] - elo[a.row.team]); });
    var qThirds = thirds.slice(0, 8), thirdGroups = qThirds.map(function (x) { return x.group; });
    var thirdTeam = {}; qThirds.forEach(function (x) { thirdTeam[x.group] = x.row.team; });
    var thirdByMatch = assignThirds(thirdGroups);
    function team(def, game) {
      if (def[0] === 'T') { var ag = thirdByMatch[game]; return ag ? thirdTeam[ag] : null; }
      return (order[def[1]] || [])[def[0] === 'W' ? 0 : 1] || null;
    }
    return R32_DEF.map(function (m) { return { game: m.game, a: team(m.a, m.game), b: team(m.b, m.game) }; });
  }

  // Play the official knockout tree from the 16 R32 ties. `decide(a,b)` returns
  // { winner, loser, m } (m = an optional koPredict detail for display). The
  // W##/L## references in LATER_DEF are resolved in dependency order, so every
  // match's winner, loser and detail are produced — the champion is the winner of
  // the final (match 104), the runner-up its loser.
  function playTree(r32, decide) {
    var winner = {}, loser = {}, detail = {};
    function run(game, a, b) { var d = decide(a, b); winner[game] = d.winner; loser[game] = d.loser; detail[game] = d.m; }
    r32.forEach(function (t) { run(t.game, t.a, t.b); });
    function ref(code) { var g = code.slice(1); return code[0] === 'W' ? winner[g] : loser[g]; }
    LATER_DEF.forEach(function (rd) { rd.ties.forEach(function (t) { run(t.game, ref(t.a), ref(t.b)); }); });
    return { winner: winner, loser: loser, detail: detail };
  }

  /* ---- one simulation ----------------------------------------------------- */
  function simOnce(byGroup, elo) {
    var sampleDecide = function (h, a) { var l = lambdas(elo[h], elo[a]); return [samplePoisson(l[0]), samplePoisson(l[1])]; };
    var r32 = buildR32(byGroup, elo, sampleDecide);
    var res = playTree(r32, function (a, b) { var w = koWinner(a, b, elo); return { winner: w, loser: w === a ? b : a, m: null }; });
    return { champion: res.winner[104], runnerUp: res.loser[104], winner: res.winner, loser: res.loser };
  }

  // Build the predictor's bracket from the Monte Carlo tallies, so it reflects
  // (and re-runs with) the same simulation as the title odds. `won[g]`/`seen[g]`
  // count, per official match g, how often each team won / appeared in it.
  // Round of 32 shows the two most-frequent teams to reach each tie; later rounds
  // propagate the winners up the real tree; each shown win % is the pick's win
  // rate in the sims where it reached that tie (so it moves on re-run).
  function consensusBracket(won, seen, elo) {
    var tieOf = {};
    function topTwo(g) {
      var s = seen[g] || {};
      return Object.keys(s).sort(function (a, b) { return s[b] - s[a]; }).slice(0, 2);
    }
    function tie(g, a, b) {
      if (a == null || b == null) { var w = a == null ? b : a; return { game: +g, a: a, b: b, pick: w, winPct: 1, score: [0, 0], pens: false }; }
      var pick = ((won[g] || {})[a] || 0) >= ((won[g] || {})[b] || 0) ? a : b;
      var ap = (seen[g] || {})[pick] || 0, wn = (won[g] || {})[pick] || 0;
      var kp = koPredict(a, b, elo);   // representative scoreline / penalties only
      var wp = ap ? wn / ap : (kp.pick === pick ? kp.winPct : 1 - kp.winPct);
      var t = { game: +g, a: a, b: b, pick: pick, winPct: wp, score: kp.score, pens: kp.pens };
      tieOf[g] = t; return t;
    }
    function ref(code) { var g = code.slice(1), t = tieOf[g]; if (!t) return null; return code[0] === 'W' ? t.pick : (t.pick === t.a ? t.b : t.a); }
    var rounds = [{ name: 'Round of 32', matches: R32_DEF.map(function (d) { var ab = topTwo(d.game); return tie(d.game, ab[0], ab[1]); }) }];
    LATER_DEF.forEach(function (rd) {
      rounds.push({ name: rd.round, matches: rd.ties.map(function (d) { return tie(d.game, ref(d.a), ref(d.b)); }) });
    });
    return { rounds: rounds, champion: (tieOf[104] || {}).pick, elo: elo };
  }

  /* ---- public: projections (title odds, returns & the predictor bracket) -- */
  function project(state, oddsRows, n) {
    var elo = ratings(state, oddsRows);
    if (!elo) return null;
    n = n || 4000;
    var byGroup = groupMatches(state);
    if (Object.keys(byGroup).length < 8) return null;   // group data not loaded yet
    var champ = {}, ru = {}, won = {}, seen = {};
    function bump(o, g, t) { if (t == null) return; (o[g] = o[g] || {})[t] = (o[g][t] || 0) + 1; }
    for (var s = 0; s < n; s++) {
      var r = simOnce(byGroup, elo);
      if (r.champion) champ[r.champion] = (champ[r.champion] || 0) + 1;
      if (r.runnerUp) ru[r.runnerUp] = (ru[r.runnerUp] || 0) + 1;
      for (var g in r.winner) { bump(won, g, r.winner[g]); bump(seen, g, r.winner[g]); bump(seen, g, r.loser[g]); }
    }
    var teams = WC.TEAMS.map(function (t) {
      return { team: t, owner: WC.ownerOf(t), elo: elo[t], champ: (champ[t] || 0) / n, ru: (ru[t] || 0) / n };
    }).sort(function (a, b) { return b.champ - a.champ; });
    var players = WC.PLAYERS.map(function (p) {
      var cw = 0, rw = 0;
      p.teams.forEach(function (t) { cw += (champ[t] || 0) / n; rw += (ru[t] || 0) / n; });
      return { player: p.name, pWin: cw, pRunner: rw, exp: cw * 80 + rw * 20 };
    }).sort(function (a, b) { return b.exp - a.exp; });
    return { players: players, teams: teams, elo: elo, n: n, bracket: consensusBracket(won, seen, elo) };
  }

  /* ---- public: official Round of 32 from the CURRENT group tables --------- */
  // The 2026 Round of 32 is fixed by group letter (winner/runner-up pairings),
  // with eight slots for the best third-placed teams — FIFA confirms exactly
  // which third goes where only once the group stage finishes. We fill the
  // winner/runner-up slots from the live tables; third slots show their eligible
  // groups. Structure only, no predictions. Match numbers 73-88.
  //   ['W', g] = winner of group g · ['R', g] = runner-up · ['T', [groups]] = best-third slot
  var R32_DEF = [
    { game: 73, a: ['R', 'A'], b: ['R', 'B'] },
    { game: 74, a: ['W', 'E'], b: ['T', ['A', 'B', 'C', 'D', 'F']] },
    { game: 75, a: ['W', 'F'], b: ['R', 'C'] },
    { game: 76, a: ['W', 'C'], b: ['R', 'F'] },
    { game: 77, a: ['W', 'I'], b: ['T', ['C', 'D', 'F', 'G', 'H']] },
    { game: 78, a: ['R', 'E'], b: ['R', 'I'] },
    { game: 79, a: ['W', 'A'], b: ['T', ['C', 'E', 'F', 'H', 'I']] },
    { game: 80, a: ['W', 'L'], b: ['T', ['E', 'H', 'I', 'J', 'K']] },
    { game: 81, a: ['W', 'D'], b: ['T', ['B', 'E', 'F', 'I', 'J']] },
    { game: 82, a: ['W', 'G'], b: ['T', ['A', 'E', 'H', 'I', 'J']] },
    { game: 83, a: ['R', 'K'], b: ['R', 'L'] },
    { game: 84, a: ['W', 'H'], b: ['R', 'J'] },
    { game: 85, a: ['W', 'B'], b: ['T', ['E', 'F', 'G', 'I', 'J']] },
    { game: 86, a: ['W', 'J'], b: ['R', 'H'] },
    { game: 87, a: ['W', 'K'], b: ['T', ['D', 'E', 'I', 'J', 'L']] },
    { game: 88, a: ['R', 'D'], b: ['R', 'G'] }
  ];

  // Later rounds (official match tree). 'W74' = winner of match 74, 'L101' =
  // loser/runner-up of match 101 (third-place play-off).
  var LATER_DEF = [
    { round: 'Round of 16', ties: [
      { game: 89, a: 'W74', b: 'W77' }, { game: 90, a: 'W73', b: 'W75' },
      { game: 91, a: 'W76', b: 'W78' }, { game: 92, a: 'W79', b: 'W80' },
      { game: 93, a: 'W83', b: 'W84' }, { game: 94, a: 'W81', b: 'W82' },
      { game: 95, a: 'W86', b: 'W88' }, { game: 96, a: 'W85', b: 'W87' }
    ] },
    { round: 'Quarter-finals', ties: [
      { game: 97, a: 'W89', b: 'W90' }, { game: 98, a: 'W93', b: 'W94' },
      { game: 99, a: 'W91', b: 'W92' }, { game: 100, a: 'W95', b: 'W96' }
    ] },
    { round: 'Semi-finals', ties: [ { game: 101, a: 'W97', b: 'W98' }, { game: 102, a: 'W99', b: 'W100' } ] },
    { round: 'Third-place play-off', ties: [ { game: 103, a: 'L101', b: 'L102' } ] },
    { round: 'Final', ties: [ { game: 104, a: 'W101', b: 'W102' } ] }
  ];

  // Winner slot -> Round-of-32 match, in Annex C column order (1A,1B,1D,1E,1G,1I,1K,1L).
  var THIRD_SLOT_MATCH = [79, 85, 81, 74, 82, 77, 87, 80];

  // Decide which group's third-placed team fills each third slot, given the
  // groups whose thirds qualified. Returns a map { matchNumber: groupLetter }.
  // With exactly eight qualifying groups we read FIFA's official Annex C table
  // (WC.ANNEX_C); otherwise (a partial "as it stands" view) we fall back to a
  // bipartite matching over each slot's eligible groups.
  function assignThirds(qualGroups) {
    var out = {};
    var key = qualGroups.slice().sort().join('');
    var row = (WC.ANNEX_C || {})[key];
    if (row && row.length === 8) {
      for (var i = 0; i < 8; i++) out[THIRD_SLOT_MATCH[i]] = row.charAt(i);
      return out;
    }
    var tslots = [], games = [];
    R32_DEF.forEach(function (m) { if (m.b[0] === 'T') { tslots.push({ groups: m.b[1] }); games.push(m.game); } });
    var sg = matchThirds(tslots, qualGroups);
    games.forEach(function (g, i) { if (sg[i]) out[g] = sg[i]; });
    return out;
  }

  // Assign the qualifying third-placed groups to the third slots respecting each
  // slot's eligible groups — a bipartite matching (Kuhn's augmenting paths).
  // Returns an array parallel to `slots`: the group letter filling each, or null.
  // (Fallback for partial group stages; the full table is Annex C above.)
  function matchThirds(slots, qualGroups) {
    var qset = {}; qualGroups.forEach(function (g) { qset[g] = 1; });
    var matchG = {};
    function aug(si, visited) {
      for (var k = 0; k < slots[si].groups.length; k++) {
        var g = slots[si].groups[k];
        if (!qset[g] || visited[g]) continue;
        visited[g] = 1;
        if (matchG[g] === undefined || aug(matchG[g], visited)) { matchG[g] = si; return true; }
      }
      return false;
    }
    for (var si = 0; si < slots.length; si++) aug(si, {});
    var out = slots.map(function () { return null; });
    Object.keys(matchG).forEach(function (g) { out[matchG[g]] = g; });
    return out;
  }

  function currentBracket(state) {
    var groups = WC.Standings.groupTables(state);
    function lab(g) { return (g || '').replace('Group ', ''); }
    // Current top-8 thirds and which group each comes from.
    var qThirds = WC.Standings.thirdPlaceRace(state).filter(function (r) { return r.qualifying; });
    var thirdTeam = {}; qThirds.forEach(function (r) { thirdTeam[lab(r.group)] = r.team; });
    var qualGroups = qThirds.map(function (r) { return lab(r.group); });
    // Assign the current best thirds to their winner slots (Annex C, or a
    // bipartite fallback while fewer than eight thirds have qualified).
    var thirdByMatch = assignThirds(qualGroups);

    function slot(def, game) {
      var type = def[0], g = def[1];
      if (type === 'T') {
        var ag = thirdByMatch[game];
        if (ag && thirdTeam[ag]) return { third: true, groups: g, team: thirdTeam[ag], from: '3rd in Group ' + ag };
        return { third: true, groups: g, from: 'Best 3rd: ' + g.join('/') };
      }
      var rows = groups['Group ' + g], r = rows && rows[type === 'W' ? 0 : 1];
      return { team: r ? r.team : null, from: (type === 'W' ? 'Winner of Group ' : 'Runner-up of Group ') + g };
    }

    // Actual knockout results, so the live bracket advances real winners (R32 →
    // R16 → …) instead of only ever showing "Winner of Match NN". A finished
    // knockout tie is identified the same way as knockedOut(): its two teams are
    // in DIFFERENT groups (an unlabelled group game would otherwise look like a
    // knockout). Keyed by the unordered team pair; the winner is the scoreline,
    // or ESPN's winner flag when a level tie went to penalties.
    var teamGroup = {};
    Object.keys(groups).forEach(function (g) { if (g !== 'Unassigned') groups[g].forEach(function (r) { teamGroup[r.team] = lab(g); }); });
    var pairRes = {};
    (state.matches || []).forEach(function (m) {
      if (!WC.Standings.isFinished(m) || m.homeScore == null || m.awayScore == null) return;
      var gh = teamGroup[m.home], ga = teamGroup[m.away];
      if (!gh || !ga || gh === ga) return;   // same group (or ungrouped) → not a knockout tie
      var w = m.homeScore > m.awayScore ? m.home : (m.awayScore > m.homeScore ? m.away
            : (m.winner === 'home' ? m.home : (m.winner === 'away' ? m.away : null)));
      if (w) pairRes[[m.home, m.away].sort().join(' ')] = { winner: w, loser: w === m.home ? m.away : m.home };
    });
    function played(a, b) { return (a && b) ? (pairRes[[a, b].sort().join(' ')] || null) : null; }

    var r32 = R32_DEF.map(function (m) {
      var t = { game: m.game, a: slot(m.a, m.game), b: slot(m.b, m.game) };
      var res = played(t.a.team, t.b.team);
      t.winner = res ? res.winner : null;
      return t;
    });
    function ref(code) { return (code[0] === 'W' ? 'Winner of Match ' : 'Runner-up of Match ') + code.slice(1); }
    // The two teams contesting each Round-of-32 match, so the next round can show
    // the candidate sides (e.g. "GER/PAR") instead of "Winner of Match 74".
    var r32Teams = {}; r32.forEach(function (m) { r32Teams[m.game] = [m.a.team || null, m.b.team || null]; });
    function cands(code) { return r32Teams[code.slice(1)] || null; }   // only R32 feeders are concrete

    // Propagate decided winners/losers up the official tree (R32 first, then each
    // later round in dependency order — same order playTree resolves them).
    var gWin = {}, gLose = {};
    r32.forEach(function (m) { if (m.winner) { gWin[m.game] = m.winner; gLose[m.game] = m.winner === m.a.team ? m.b.team : m.a.team; } });
    function refTeam(code) { var g = code.slice(1); return code[0] === 'W' ? gWin[g] : gLose[g]; }
    LATER_DEF.forEach(function (rd) { rd.ties.forEach(function (t) {
      var at = refTeam(t.a), bt = refTeam(t.b), res = played(at, bt);
      if (res) { gWin[t.game] = res.winner; gLose[t.game] = res.loser; }
    }); });

    var later = LATER_DEF.map(function (rd) {
      return { name: rd.round, ties: rd.ties.map(function (t) {
        var at = refTeam(t.a), bt = refTeam(t.b);
        return {
          game: t.game,
          a: at ? { team: at } : null, b: bt ? { team: bt } : null,   // concrete once the feeding tie is played
          aRef: ref(t.a), bRef: ref(t.b), aCands: cands(t.a), bCands: cands(t.b),
          winner: gWin[t.game] || null
        };
      }) };
    });
    return { rounds: [{ name: 'Round of 32', ties: r32 }].concat(later) };
  }

  WC.Sim = { project: project, currentBracket: currentBracket, ratings: ratings, predict: predict, koPredict: koPredict };

})(window.WC = window.WC || {});
