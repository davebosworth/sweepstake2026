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
 *    qualifies the top two per group plus the eight best third-placed teams,
 *    seeds them by rating into a 32-team knockout, and plays to a champion and
 *    runner-up (knockout draws go to a rating-weighted shootout).
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
  // 32 qualifiers: top 2 per group + 8 best third-placed.
  function qualifiers(byGroup, elo, decide) {
    var qs = [], thirds = [];
    Object.keys(byGroup).forEach(function (k) {
      var tbl = groupTable(byGroup[k], elo, decide);
      if (tbl[0]) qs.push(tbl[0]); if (tbl[1]) qs.push(tbl[1]); if (tbl[2]) thirds.push(tbl[2]);
    });
    thirds.sort(function (a, b) { return b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF || (elo[b.team] - elo[a.team]); });
    return qs.concat(thirds.slice(0, 8)).map(function (r) { return r.team; });
  }

  /* ---- bracket seeding ---------------------------------------------------- */
  // Standard seeding order so the strongest teams are spread across the bracket.
  function seedOrder(teams) {
    var n = 1; while (n < teams.length) n *= 2;          // next power of two
    var seeds = [1];
    while (seeds.length < n) {
      var rounds = seeds.length * 2, next = [];
      seeds.forEach(function (s) { next.push(s); next.push(rounds + 1 - s); });
      seeds = next;
    }
    return seeds.map(function (s) { return teams[s - 1]; });   // undefined => bye
  }

  /* ---- one simulation ----------------------------------------------------- */
  function simOnce(byGroup, elo) {
    var sampleDecide = function (h, a) { var l = lambdas(elo[h], elo[a]); return [samplePoisson(l[0]), samplePoisson(l[1])]; };
    var qs = qualifiers(byGroup, elo, sampleDecide);
    var round = seedOrder(qs.slice().sort(function (a, b) { return elo[b] - elo[a]; }));
    while (round.length > 2) {
      var next = [];
      for (var i = 0; i < round.length; i += 2) next.push(koWinner(round[i], round[i + 1], elo));
      round = next;
    }
    var champ = koWinner(round[0], round[1], elo);
    return { champion: champ, runnerUp: champ === round[0] ? round[1] : round[0] };
  }

  /* ---- public: projections ------------------------------------------------ */
  function project(state, oddsRows, n) {
    var elo = ratings(state, oddsRows);
    if (!elo) return null;
    n = n || 4000;
    var byGroup = groupMatches(state);
    if (Object.keys(byGroup).length < 8) return null;   // group data not loaded yet
    var champ = {}, ru = {};
    for (var s = 0; s < n; s++) {
      var r = simOnce(byGroup, elo);
      if (r.champion) champ[r.champion] = (champ[r.champion] || 0) + 1;
      if (r.runnerUp) ru[r.runnerUp] = (ru[r.runnerUp] || 0) + 1;
    }
    var teams = WC.TEAMS.map(function (t) {
      return { team: t, owner: WC.ownerOf(t), elo: elo[t], champ: (champ[t] || 0) / n, ru: (ru[t] || 0) / n };
    }).sort(function (a, b) { return b.champ - a.champ; });
    var players = WC.PLAYERS.map(function (p) {
      var cw = 0, rw = 0;
      p.teams.forEach(function (t) { cw += (champ[t] || 0) / n; rw += (ru[t] || 0) / n; });
      return { player: p.name, pWin: cw, pRunner: rw, exp: cw * 80 + rw * 20 };
    }).sort(function (a, b) { return b.exp - a.exp; });
    return { players: players, teams: teams, elo: elo, n: n };
  }

  /* ---- public: most-likely projected bracket (for the KO predictor) ------- */
  function projectedBracket(state, oddsRows) {
    var elo = ratings(state, oddsRows);
    if (!elo) return null;
    var byGroup = groupMatches(state);
    if (Object.keys(byGroup).length < 8) return null;
    // Decide unplayed group games by their single likeliest outcome.
    var decide = function (h, a) {
      var p = predict(elo[h], elo[a]);
      if (p.home >= p.draw && p.home >= p.away) return p.score[0] === p.score[1] ? [p.score[0] + 1, p.score[1]] : p.score;
      if (p.away >= p.draw && p.away >= p.home) return p.score[0] === p.score[1] ? [p.score[0], p.score[1] + 1] : p.score;
      return [p.score[0], p.score[1]];   // draw
    };
    var qs = qualifiers(byGroup, elo, decide);
    var order = seedOrder(qs.slice().sort(function (a, b) { return elo[b] - elo[a]; }));
    var names = ['Round of 32', 'Round of 16', 'Quarter-finals', 'Semi-finals', 'Final'];
    var rounds = [], cur = order, ri = 0;
    while (cur.length > 1) {
      var ms = [], next = [];
      for (var i = 0; i < cur.length; i += 2) {
        var m = koPredict(cur[i], cur[i + 1], elo);
        ms.push(m); next.push(m.pick);
      }
      rounds.push({ name: names[ri] || ('Round ' + (ri + 1)), matches: ms });
      cur = next; ri++;
    }
    return { rounds: rounds, champion: cur[0], elo: elo };
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

  // Assign the qualifying third-placed groups to the third slots respecting each
  // slot's eligible groups — a bipartite matching (Kuhn's augmenting paths).
  // Returns an array parallel to `slots`: the group letter filling each, or null.
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
    // Third slots in fixed order, then assign the current thirds to them.
    var tslots = [];
    R32_DEF.forEach(function (m) { ['a', 'b'].forEach(function (s) { if (m[s][0] === 'T') tslots.push({ key: m.game + s, groups: m[s][1] }); }); });
    var slotGroup = matchThirds(tslots, qualGroups);
    var assigned = {}; tslots.forEach(function (s, i) { if (slotGroup[i]) assigned[s.key] = slotGroup[i]; });

    function slot(def, key) {
      var type = def[0], g = def[1];
      if (type === 'T') {
        var ag = assigned[key];
        if (ag && thirdTeam[ag]) return { third: true, groups: g, team: thirdTeam[ag], from: '3rd in Group ' + ag };
        return { third: true, groups: g, from: 'Best 3rd: ' + g.join('/') };
      }
      var rows = groups['Group ' + g], r = rows && rows[type === 'W' ? 0 : 1];
      return { team: r ? r.team : null, from: (type === 'W' ? 'Winner of Group ' : 'Runner-up of Group ') + g };
    }
    var r32 = R32_DEF.map(function (m) { return { game: m.game, a: slot(m.a, m.game + 'a'), b: slot(m.b, m.game + 'b') }; });
    function ref(code) { return (code[0] === 'W' ? 'Winner of Match ' : 'Runner-up of Match ') + code.slice(1); }
    var later = LATER_DEF.map(function (rd) {
      return { name: rd.round, ties: rd.ties.map(function (t) { return { game: t.game, aRef: ref(t.a), bRef: ref(t.b) }; }) };
    });
    return { rounds: [{ name: 'Round of 32', ties: r32 }].concat(later) };
  }

  WC.Sim = { project: project, projectedBracket: projectedBracket, currentBracket: currentBracket, ratings: ratings, predict: predict, koPredict: koPredict };

})(window.WC = window.WC || {});
