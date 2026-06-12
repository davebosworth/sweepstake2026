/* ============================================================================
 * standings.js — Derives all tables from the match list.
 *
 * Three things are computed here, all from FINISHED matches:
 *   1. Per-team league stats (P/W/D/L/GF/GA/GD/Pts) + group membership.
 *   2. The Disciplinary leaderboard (worst-behaved single team).
 *   3. The Worst Teams / fewest-points table (the wooden-spoon race) with the
 *      early-tournament filter from the handover.
 * ========================================================================== */
(function (WC) {
  'use strict';

  function isFinished(m) { return m.status === 'ft' && m.homeScore != null && m.awayScore != null; }
  // A match whose score counts toward the live tables: finished OR in progress.
  function isCounting(m) { return (m.status === 'ft' || m.status === 'live') && m.homeScore != null && m.awayScore != null; }

  // Build a fresh stat record for a team.
  function blankTeam(team) {
    return {
      team: team,
      owner: WC.ownerOf(team),
      group: null,
      P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0,
      yellow: 0, red: 0, cardPoints: 0,
      played: false,
      live: false,        // currently involved in an in-play match (provisional row)
      liveWinning: false  // ...and currently ahead in that match
    };
  }

  /* Returns a map team -> stat record, aggregated across all matches.
     Group membership is taken from every match a team appears in (finished or
     not) so league tables can list all four teams before kick-off. League
     points/goals come from finished AND in-play matches (the latter provisional,
     marked with `live`); cards are counted from any match that records them. */
  function computeTeams(state) {
    var map = {};
    function ensure(team) {
      if (!map[team]) map[team] = blankTeam(team);
      return map[team];
    }

    state.matches.forEach(function (m) {
      if (!m.home || !m.away) return;
      var h = ensure(m.home), a = ensure(m.away);
      if (m.group) { h.group = h.group || m.group; a.group = a.group || m.group; }

      // Cards (count whenever present, even mid-match entries).
      (m.cards || []).forEach(function (c) {
        var t = c.team === 'home' ? h : a;
        if (c.type === 'red') t.red += 1; else t.yellow += 1;
      });

      if (!isCounting(m)) return;
      if (m.status === 'live') {
        h.live = a.live = true;
        if (m.homeScore > m.awayScore) h.liveWinning = true;
        else if (m.awayScore > m.homeScore) a.liveWinning = true;
      }

      h.played = a.played = true;
      h.P += 1; a.P += 1;
      h.GF += m.homeScore; h.GA += m.awayScore;
      a.GF += m.awayScore; a.GA += m.homeScore;

      if (m.homeScore > m.awayScore) { h.W += 1; h.Pts += 3; a.L += 1; }
      else if (m.homeScore < m.awayScore) { a.W += 1; a.Pts += 3; h.L += 1; }
      else { h.D += 1; a.D += 1; h.Pts += 1; a.Pts += 1; }
    });

    Object.keys(map).forEach(function (k) {
      var t = map[k];
      t.GD = t.GF - t.GA;
      t.cardPoints = t.red * WC.CARD_POINTS.red + t.yellow * WC.CARD_POINTS.yellow;
    });
    return map;
  }

  // Disciplinary leaderboard: every team with at least one card point, sorted
  // by most card points (tiebreak: more reds, then alphabetical). Leader = the
  // single worst-behaved team and wins the prize.
  function disciplinary(state) {
    var teams = computeTeams(state);
    var rows = Object.keys(teams).map(function (k) { return teams[k]; })
      .filter(function (t) { return t.cardPoints > 0; });
    rows.sort(function (a, b) {
      return (b.cardPoints - a.cardPoints) || (b.red - a.red) || a.team.localeCompare(b.team);
    });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    return rows;
  }

  /* Worst Teams / fewest-points table.
     Ranked by fewest points, GD as tiebreaker (lower GD = lower place = worse).
     Early filter (handover current rule): only teams on 0 pts AND negative GD.
     Show the five worst, expanding to include any team tied with 5th on
     (points, GD). With the filter off, the full played field is ranked. */
  function worstTeams(state) {
    var teams = computeTeams(state);
    var rows = Object.keys(teams).map(function (k) { return teams[k]; })
      .filter(function (t) { return t.played; });

    if (state.earlyFilter) {
      // Keep the early-tournament filter (winless, negative GD), but also
      // include teams in a live match that aren't currently winning, so the
      // wooden-spoon race updates as games play out without listing a team
      // that's live and ahead.
      rows = rows.filter(function (t) { return (t.live && !t.liveWinning) || (t.Pts === 0 && t.GD < 0); });
    }

    // Worst first: fewest points, then lowest GD, then most goals conceded,
    // then alphabetical for stability.
    rows.sort(function (a, b) {
      return (a.Pts - b.Pts) || (a.GD - b.GD) || (b.GA - a.GA) || a.team.localeCompare(b.team);
    });

    // Take five worst, then keep anyone tied with the 5th on (Pts, GD).
    var cut = rows;
    if (rows.length > 5) {
      var fifth = rows[4];
      cut = rows.filter(function (t, i) {
        return i < 5 || (t.Pts === fifth.Pts && t.GD === fifth.GD);
      });
    }
    cut.forEach(function (r, i) { r.rank = i + 1; });
    return cut;
  }

  // Full group league tables, keyed by group label and ranked normally
  // (most points, GD, GF). Used by the Standings tab.
  function groupTables(state) {
    var teams = computeTeams(state);
    var groups = {};
    Object.keys(teams).forEach(function (k) {
      var t = teams[k];
      var g = t.group || 'Unassigned';
      (groups[g] = groups[g] || []).push(t);
    });
    Object.keys(groups).forEach(function (g) {
      groups[g].sort(function (a, b) {
        return (b.Pts - a.Pts) || (b.GD - a.GD) || (b.GF - a.GF) || a.team.localeCompare(b.team);
      });
      groups[g].forEach(function (r, i) { r.pos = i + 1; });
    });
    return groups;
  }

  WC.Standings = {
    computeTeams: computeTeams,
    disciplinary: disciplinary,
    worstTeams: worstTeams,
    groupTables: groupTables,
    isFinished: isFinished,
    isCounting: isCounting
  };

})(window.WC = window.WC || {});
