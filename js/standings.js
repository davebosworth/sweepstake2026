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

  // 2026 group tiebreakers, in order, once teams are level on points:
  //   1-3. head-to-head among the tied teams (points, then GD, then goals)
  //        — re-applied to any still-level subset, exclusively on their games;
  //   4-5. overall goal difference, then overall goals;
  //   6.   fair-play / conduct (approximated by our card points, fewer = better);
  //   then alphabetical (we can't do FIFA ranking / drawing of lots).
  function compareOverall(a, b) {
    return (b.GD - a.GD) || (b.GF - a.GF) || ((a.cardPoints || 0) - (b.cardPoints || 0)) || a.team.localeCompare(b.team);
  }
  // Mini head-to-head table among a set of tied teams (only games between them).
  function h2hTable(teams, matches) {
    var set = {}, mini = {};
    teams.forEach(function (t) { set[t.team] = 1; mini[t.team] = { p: 0, gd: 0, gf: 0 }; });
    matches.forEach(function (m) {
      if (!isFinished(m) || !set[m.home] || !set[m.away]) return;
      var H = mini[m.home], A = mini[m.away];
      H.gf += m.homeScore; A.gf += m.awayScore; H.gd += m.homeScore - m.awayScore; A.gd += m.awayScore - m.homeScore;
      if (m.homeScore > m.awayScore) H.p += 3; else if (m.homeScore < m.awayScore) A.p += 3; else { H.p++; A.p++; }
    });
    return mini;
  }
  // Order a set of teams already level on points, applying head-to-head first.
  function rankCluster(teams, matches) {
    if (teams.length <= 1) return teams.slice();
    var h = h2hTable(teams, matches);
    var sorted = teams.slice().sort(function (a, b) {
      var x = h[a.team], y = h[b.team];
      return (y.p - x.p) || (y.gd - x.gd) || (y.gf - x.gf);
    });
    var out = [], i = 0;
    while (i < sorted.length) {
      var j = i + 1, hi = h[sorted[i].team];
      while (j < sorted.length) { var hj = h[sorted[j].team]; if (hj.p !== hi.p || hj.gd !== hi.gd || hj.gf !== hi.gf) break; j++; }
      var sub = sorted.slice(i, j);
      if (sub.length === 1) out.push(sub[0]);
      else if (sub.length === teams.length) out = out.concat(sub.slice().sort(compareOverall)); // no split → overall
      else out = out.concat(rankCluster(sub, matches)); // re-apply head-to-head to the still-level subset
      i = j;
    }
    return out;
  }
  // Rank a group: points first, ties broken by the 2026 criteria above.
  function rankGroup(records, matches) {
    var byPts = records.slice().sort(function (a, b) { return b.Pts - a.Pts; });
    var out = [], i = 0;
    while (i < byPts.length) {
      var j = i + 1;
      while (j < byPts.length && byPts[j].Pts === byPts[i].Pts) j++;
      var cluster = byPts.slice(i, j);
      out = out.concat(cluster.length > 1 ? rankCluster(cluster, matches || []) : cluster);
      i = j;
    }
    out.forEach(function (r, idx) { r.pos = idx + 1; });
    return out;
  }

  // Full group league tables, keyed by group label and ranked by the 2026
  // tiebreakers (head-to-head before goal difference). Used by the Standings tab.
  function groupTables(state) {
    var teams = computeTeams(state), byLabel = {}, matchesByLabel = {};
    Object.keys(teams).forEach(function (k) { var t = teams[k], g = t.group || 'Unassigned'; (byLabel[g] = byLabel[g] || []).push(t); });
    state.matches.forEach(function (m) { if (m.group) (matchesByLabel[m.group] = matchesByLabel[m.group] || []).push(m); });
    Object.keys(byLabel).forEach(function (g) { byLabel[g] = rankGroup(byLabel[g], matchesByLabel[g]); });
    return byLabel;
  }

  // Map group letter -> array of that group's matches.
  function matchesByGroup(state) {
    var by = {};
    state.matches.forEach(function (m) {
      var g = /group\s+([a-l])\b/i.exec(m.group || '');
      if (g && m.home && m.away) (by[g[1].toUpperCase()] = by[g[1].toUpperCase()] || []).push(m);
    });
    return by;
  }

  // Is every match in this group finished?
  function groupComplete(matches) { return matches.length > 0 && matches.every(isFinished); }

  /* Mathematical group-stage status per team: 'through' (guaranteed top 2),
     'eliminated' (can't reach the knockouts), or 'alive'. Two parts:

     1. Within-group: brute-force every remaining W/D/L combination (only a
        handful of games left). A team is 'through' if at most one other team can
        match/beat it in EVERY scenario; provisionally eliminated if it can't even
        finish 3rd in any scenario. Completed groups read final positions with GD.

     2. Best-8-thirds (cross-group): a team that can't finish top 2 is also out if
        at least 8 OTHER groups' third-placed teams are GUARANTEED more points than
        this team's best-possible total — it then can't be one of the 8 qualifying
        thirds. Strict points comparison only, so it never wrongly eliminates. */
  function groupStatus(state) {
    var byGroup = matchesByGroup(state), status = {};
    var meta = {};       // team -> { group, maxPts, everTop2 }
    var minThird = {};   // group -> guaranteed-minimum points of its eventual 3rd team

    Object.keys(byGroup).forEach(function (key) {
      var matches = byGroup[key];
      var teamSet = {}; matches.forEach(function (m) { teamSet[m.home] = teamSet[m.away] = 1; });
      var tlist = Object.keys(teamSet);

      // Finished group: positions are settled (with GD), so read them directly.
      if (groupComplete(matches)) {
        var rec = {}; tlist.forEach(function (t) { rec[t] = { team: t, Pts: 0, GD: 0, GF: 0 }; });
        matches.forEach(function (m) {
          var H = rec[m.home], A = rec[m.away];
          H.GF += m.homeScore; A.GF += m.awayScore; H.GD += m.homeScore - m.awayScore; A.GD += m.awayScore - m.homeScore;
          if (m.homeScore > m.awayScore) H.Pts += 3; else if (m.homeScore < m.awayScore) A.Pts += 3; else { H.Pts++; A.Pts++; }
        });
        var sorted = rankGroup(tlist.map(function (t) { return rec[t]; }), matches);
        sorted.forEach(function (r, i) {
          status[r.team] = i < 2 ? 'through' : (i === 2 ? 'alive' : 'eliminated');
          meta[r.team] = { group: key, maxPts: r.Pts, everTop2: i < 2 };
        });
        minThird[key] = sorted[2] ? sorted[2].Pts : 0;
        return;
      }

      var base = {}; tlist.forEach(function (t) { base[t] = 0; });
      var remaining = [];
      matches.forEach(function (m) {
        if (isFinished(m)) {
          if (m.homeScore > m.awayScore) base[m.home] += 3;
          else if (m.homeScore < m.awayScore) base[m.away] += 3;
          else { base[m.home] += 1; base[m.away] += 1; }
        } else { remaining.push(m); }   // scheduled or live = undecided
      });
      var k = remaining.length, combos = Math.pow(3, k);
      var alwaysTop2 = {}, everTop2 = {}, everTop3 = {}, maxPts = {}, minThirdPts = Infinity;
      tlist.forEach(function (t) { alwaysTop2[t] = true; everTop2[t] = false; everTop3[t] = false; maxPts[t] = 0; });
      for (var c = 0; c < combos; c++) {
        var pts = {}; tlist.forEach(function (t) { pts[t] = base[t]; });
        var cc = c;
        for (var i = 0; i < k; i++) {
          var o = cc % 3; cc = Math.floor(cc / 3); var m = remaining[i];
          if (o === 0) pts[m.home] += 3; else if (o === 1) pts[m.away] += 3; else { pts[m.home] += 1; pts[m.away] += 1; }
        }
        var ordered = tlist.map(function (t) { return pts[t]; }).sort(function (a, b) { return b - a; });
        if (ordered[2] != null && ordered[2] < minThirdPts) minThirdPts = ordered[2];
        tlist.forEach(function (t) {
          if (pts[t] > maxPts[t]) maxPts[t] = pts[t];
          var strictlyAbove = 0, othersGE = 0;
          tlist.forEach(function (u) {
            if (u === t) return;
            if (pts[u] > pts[t]) strictlyAbove++;
            if (pts[u] >= pts[t]) othersGE++;
          });
          if (othersGE > 1) alwaysTop2[t] = false;
          if (othersGE <= 1) everTop2[t] = true;
          if (strictlyAbove < 3) everTop3[t] = true;
        });
      }
      minThird[key] = isFinite(minThirdPts) ? minThirdPts : 0;
      tlist.forEach(function (t) {
        status[t] = alwaysTop2[t] ? 'through' : (!everTop3[t] ? 'eliminated' : 'alive');
        meta[t] = { group: key, maxPts: maxPts[t], everTop2: everTop2[t] };
      });
    });

    // Best-8-thirds elimination: an 'alive' team that can't make top 2 is out if
    // 8+ other groups' thirds are guaranteed to out-point its best-possible total.
    var groupKeys = Object.keys(minThird);
    Object.keys(meta).forEach(function (t) {
      var m = meta[t];
      if (status[t] !== 'alive' || m.everTop2) return;
      var betterThirds = 0;
      groupKeys.forEach(function (g) { if (g !== m.group && minThird[g] > m.maxPts) betterThirds++; });
      if (betterThirds >= 8) status[t] = 'eliminated';
    });

    return status;
  }

  /* The race for the best-8 third-placed places. Takes each group's current
     3rd-placed team, ranks them (Pts, GD, GF), and flags the top 8 as in the
     provisional qualifying zone. `settled` marks teams whose group is finished. */
  function thirdPlaceRace(state) {
    var groups = groupTables(state), byGroup = matchesByGroup(state), thirds = [];
    Object.keys(groups).forEach(function (g) {
      if (g === 'Unassigned') return;
      var row = groups[g].filter(function (r) { return r.pos === 3; })[0];
      var letter = (/group\s+([a-l])/i.exec(g) || [])[1];
      if (row) { row.settled = letter ? groupComplete(byGroup[letter.toUpperCase()] || []) : false; thirds.push(row); }
    });
    // Cross-group ranking of the thirds: head-to-head can't apply, so it's
    // points, GD, goals, then fair play (fewer card points better).
    thirds.sort(function (a, b) {
      return (b.Pts - a.Pts) || (b.GD - a.GD) || (b.GF - a.GF) || ((a.cardPoints || 0) - (b.cardPoints || 0)) || a.team.localeCompare(b.team);
    });
    thirds.forEach(function (r, i) { r.thirdRank = i + 1; r.qualifying = i < 8; });
    return thirds;
  }

  WC.Standings = {
    computeTeams: computeTeams,
    disciplinary: disciplinary,
    worstTeams: worstTeams,
    groupTables: groupTables,
    groupStatus: groupStatus,
    thirdPlaceRace: thirdPlaceRace,
    isFinished: isFinished,
    isCounting: isCounting
  };

})(window.WC = window.WC || {});
