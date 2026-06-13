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
    var minute = '';
    var mm = s.match(/(\d+(?:\+\d+)?)'\s*$/);                    // trailing minute
    if (mm) minute = mm[1] + "'";
    var player = s.replace(/\s*\d+(?:\+\d+)?'\s*$/, '').trim();
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

  WC.Stats = {
    parseScorer: parseScorer,
    goldenBoot: goldenBoot,
    records: records
  };

})(window.WC = window.WC || {});
