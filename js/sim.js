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

  /* ---- public: indicative bracket from the CURRENT group tables ----------- */
  // Takes the live qualifiers (group winners, runners-up, best-8 thirds), seeds
  // them by tier + record into the Round of 32, and lays out the later rounds as
  // slot references ("Winner of R32 game 1"). No predictions — structure only;
  // updates as the tables change. Not the official draw (set when groups finish).
  function currentBracket(state) {
    var groups = WC.Standings.groupTables(state);
    function lab(g) { return (g || '').replace('Group ', ''); }
    function rec(r, from) { return { team: r.team, Pts: r.Pts, GD: r.GD, GF: r.GF, from: from }; }
    var winners = [], runners = [];
    Object.keys(groups).forEach(function (g) {
      if (g === 'Unassigned') return;
      var rows = groups[g];
      if (rows[0]) winners.push(rec(rows[0], 'Winner of Group ' + lab(g)));
      if (rows[1]) runners.push(rec(rows[1], 'Runner-up of Group ' + lab(g)));
    });
    var thirds = WC.Standings.thirdPlaceRace(state).filter(function (r) { return r.qualifying; })
      .map(function (r) { return rec(r, '3rd in Group ' + lab(r.group)); });
    if (winners.length + runners.length + thirds.length < 4) return null;
    function byRec(a, b) { return (b.Pts - a.Pts) || (b.GD - a.GD) || (b.GF - a.GF) || a.team.localeCompare(b.team); }
    winners.sort(byRec); runners.sort(byRec);   // thirds already ranked
    var seeded = seedOrder(winners.concat(runners).concat(thirds));   // tier-seeded
    var r32 = [];
    for (var i = 0; i < seeded.length; i += 2) r32.push({ game: (i / 2) + 1, a: seeded[i], b: seeded[i + 1] });
    var rounds = [{ name: 'Round of 32', short: 'R32', ties: r32 }];
    var future = [['Round of 16', 'R16'], ['Quarter-finals', 'QF'], ['Semi-finals', 'SF'], ['Final', 'Final']];
    var prevShort = 'R32', prevCount = r32.length;
    future.forEach(function (nm) {
      var cnt = Math.floor(prevCount / 2), ties = [];
      for (var g = 1; g <= cnt; g++) ties.push({ game: g, aRef: 'Winner of ' + prevShort + ' game ' + (2 * g - 1), bRef: 'Winner of ' + prevShort + ' game ' + (2 * g) });
      rounds.push({ name: nm[0], short: nm[1], ties: ties });
      prevShort = nm[1]; prevCount = cnt;
    });
    return { rounds: rounds };
  }

  WC.Sim = { project: project, projectedBracket: projectedBracket, currentBracket: currentBracket, ratings: ratings, predict: predict, koPredict: koPredict };

})(window.WC = window.WC || {});
