/* ============================================================================
 * stats.js — Pure statistics derived from the live match list (and odds).
 *
 * No DOM here — every function takes plain data (the Live state and/or the
 * odds rows) and returns plain data, mirroring standings.js / odds.js. The UI
 * layer (app.js) renders the results. Everything is recomputed on the fly.
 * ========================================================================== */
(function (WC) {
  'use strict';

  var S = WC.Standings;

  /* Split an ESPN scorer label ("A. Striker 23' (pen)") into parts. parseSummary
     gives one entry per goal, so counting entries = counting goals. */
  function parseScorer(nameStr) {
    var raw = String(nameStr == null ? '' : nameStr).trim();
    var pen = /\(pen\)/i.test(raw);
    var og = /\(og\)/i.test(raw);
    var s = raw.replace(/\s*\((?:pen|og)\)\s*/ig, ' ').trim();   // drop flags
    // Trailing goal minute: a normal "67'" or ESPN stoppage time "45'+2'" /
    // "90'+5'" (the apostrophe sits before the +). Match it then strip it, so a
    // player scoring at different minutes isn't split into separate rows.
    var MIN = /\s*\d+'(?:\s*\+\s*\d+'?)?\s*$/;
    var minute = '';
    var mm = s.match(/(\d+'(?:\s*\+\s*\d+'?)?)\s*$/);
    if (mm) minute = mm[1];
    var player = s.replace(MIN, '').trim();
    if (!player) player = raw;                                   // defensive fallback
    return { player: player, minute: minute, pen: pen, og: og };
  }

  function teamOf(side, m) { return side === 'home' ? m.home : m.away; }

  /* Golden Boot leaderboard: aggregate goalscorers across all matches.
     Own goals are excluded (per real Golden Boot rules) but still counted in
     records().  Returns [{ player, team, owner, goals, pens }] best-first. */
  function goldenBoot(state) {
    var map = {};
    (state.matches || []).forEach(function (m) {
      (m.scorers || []).forEach(function (sc) {
        var p = parseScorer(sc.name);
        if (p.og) return;                       // own goals don't count for the boot
        var team = teamOf(sc.team, m);
        if (!team) return;
        var key = p.player + '|' + team;
        var rec = map[key] || (map[key] = { player: p.player, team: team, owner: WC.ownerOf(team), goals: 0, pens: 0 });
        rec.goals += 1;
        if (p.pen) rec.pens += 1;
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) {
        return (b.goals - a.goals) || (a.pens - b.pens) || a.player.localeCompare(b.player);
      });
  }

  /* Tournament records / aggregates, all from finished matches (plus card
     totals which include in-play cards via computeTeams). */
  function records(state) {
    var fin = (state.matches || []).filter(S.isFinished);
    var out = {
      matchesCounted: fin.length,
      totalGoals: 0, goalsPerGame: null,
      biggestWin: null, highestScoring: null, mostCards: null,
      cleanSheets: 0, totalYellows: 0, totalReds: 0, ownGoals: 0
    };

    fin.forEach(function (m) {
      var hs = m.homeScore, as = m.awayScore, total = hs + as, margin = Math.abs(hs - as);
      out.totalGoals += total;
      if (as === 0) out.cleanSheets += 1;          // home kept a clean sheet
      if (hs === 0) out.cleanSheets += 1;          // away kept a clean sheet
      if (!out.biggestWin || margin > out.biggestWin.margin) out.biggestWin = { m: m, margin: margin };
      if (!out.highestScoring || total > out.highestScoring.total) out.highestScoring = { m: m, total: total };
      var cards = (m.cards || []).length;
      if (!out.mostCards || cards > out.mostCards.cards) out.mostCards = { m: m, cards: cards };
    });

    // Own goals counted across all matches (any that record scorers).
    (state.matches || []).forEach(function (m) {
      (m.scorers || []).forEach(function (sc) { if (/\(og\)/i.test(sc.name || '')) out.ownGoals += 1; });
    });

    // Card totals from the standings aggregation (includes in-play cards).
    var teams = S.computeTeams(state);
    Object.keys(teams).forEach(function (k) { out.totalYellows += teams[k].yellow; out.totalReds += teams[k].red; });

    if (out.matchesCounted > 0) out.goalsPerGame = out.totalGoals / out.matchesCounted;
    return out;
  }

  /* Power rankings: blend results-so-far with pre-tournament odds strength.
     Weight shifts from pure odds (no games) toward results as games are played,
     so a single fluke result can't top the table. Returns all 48, best-first. */
  function powerRankings(state, oddsRows) {
    var prob = {}, maxP = 0;
    (oddsRows || []).forEach(function (r) {
      if (r.winnerProb != null) { prob[r.team] = r.winnerProb; if (r.winnerProb > maxP) maxP = r.winnerProb; }
    });
    var teams = S.computeTeams(state);
    return WC.TEAMS.map(function (name) {
      var t = teams[name] || { owner: WC.ownerOf(name), P: 0, Pts: 0, GD: 0, played: false };
      var strengthNorm = (maxP > 0 && prob[name] != null) ? prob[name] / maxP : 0;
      var ppg = t.P > 0 ? t.Pts / t.P : 0;
      var gdpg = t.P > 0 ? t.GD / t.P : 0;
      var resultNorm = Math.max(0, Math.min(1, ppg / 3 + gdpg / 12));
      var w = Math.min(t.P, 3) / 3 * 0.6;                 // 0 (no games) → 0.6 (3+ games)
      var power = w * resultNorm + (1 - w) * strengthNorm;
      return {
        team: name, owner: t.owner, power: power, strengthNorm: strengthNorm, resultNorm: resultNorm,
        divergence: t.played ? (resultNorm - strengthNorm) : null,
        P: t.P, Pts: t.Pts, GD: t.GD, played: t.played
      };
    }).sort(function (a, b) { return b.power - a.power; });
  }

  /* Per-player luck: actual league points vs points "expected" from each team's
     pre-tournament strength percentile (strong teams expected ~2 ppg, weak
     ~0.7). Positive = teams outperforming their billing. */
  function luckIndex(state, oddsRows) {
    var prob = {};
    (oddsRows || []).forEach(function (r) { prob[r.team] = (r.winnerProb != null) ? r.winnerProb : 0; });
    var arr = WC.TEAMS.map(function (n) { return { team: n, p: prob[n] || 0 }; })
      .sort(function (a, b) { return a.p - b.p; });
    var N = arr.length, pct = {};
    arr.forEach(function (x, i) { pct[x.team] = N > 1 ? i / (N - 1) : 0; });
    function expPPG(team) { return 0.7 + 1.3 * (pct[team] || 0); }
    var teams = S.computeTeams(state);
    return WC.PLAYERS.map(function (pl) {
      var actual = 0, expected = 0, played = 0;
      pl.teams.forEach(function (tn) {
        var t = teams[tn];
        if (t && t.P > 0) { actual += t.Pts; expected += expPPG(tn) * t.P; played += 1; }
      });
      return { player: pl.name, actualPts: actual, expectedPts: expected, luck: actual - expected, played: played };
    }).sort(function (a, b) { return b.luck - a.luck; });
  }

  WC.Stats = {
    parseScorer: parseScorer,
    goldenBoot: goldenBoot,
    records: records,
    powerRankings: powerRankings,
    luckIndex: luckIndex
  };

})(window.WC = window.WC || {});
