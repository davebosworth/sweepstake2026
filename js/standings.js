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
  // `groupOnly` restricts the tally to group-stage games — used for the group
  // tables, group status and the wooden spoon, which freeze when the group stage
  // ends (knockout results must not skew them). The disciplinary prize counts the
  // whole tournament, so it leaves this off.
  function computeTeams(state, groupOnly) {
    var map = {};
    function ensure(team) {
      if (!map[team]) map[team] = blankTeam(team);
      return map[team];
    }

    // Pass 1 — register every team and assign each its group from any labelled
    // match it played.
    state.matches.forEach(function (m) {
      if (!m.home || !m.away) return;
      var h = ensure(m.home), a = ensure(m.away);
      if (m.group) { h.group = h.group || m.group; a.group = a.group || m.group; }
    });

    // Fallback grouping: a team whose own games were all unlabelled in the feed
    // inherits its group from the opponents it played — group-stage games are
    // within a group. Iterated so a fully-unlabelled pair still resolves via a
    // labelled third team. (Only ungrouped teams change, and ungrouped teams only
    // exist during the group stage, so knockout ties never mis-propagate.)
    var changed = true;
    while (changed) {
      changed = false;
      state.matches.forEach(function (m) {
        var h = m.home && map[m.home], a = m.away && map[m.away];
        if (!h || !a) return;
        if (!h.group && a.group) { h.group = a.group; changed = true; }
        else if (!a.group && h.group) { a.group = h.group; changed = true; }
      });
    }

    // Pass 2 — tally cards (always) and league stats. With `groupOnly`, a game is
    // a group-stage game when BOTH teams are in the same group — robust to a
    // missing label on the match itself — so knockout (cross-group) ties are
    // skipped. Each team plays exactly three group games, so we also cap at three
    // (processing chronologically) in case two group-mates meet again in a late
    // knockout round — that extra tie must not skew the frozen group table.
    var gcount = {};
    var ordered = groupOnly ? state.matches.slice().sort(function (x, y) { return (x._ts || 0) - (y._ts || 0); }) : state.matches;
    ordered.forEach(function (m) {
      if (!m.home || !m.away) return;
      var h = map[m.home], a = map[m.away];

      // Cards (count whenever present, even mid-match entries).
      (m.cards || []).forEach(function (c) {
        var t = c.team === 'home' ? h : a;
        if (c.type === 'red') t.red += 1; else t.yellow += 1;
      });

      if (!isCounting(m)) return;
      if (groupOnly) {
        if (!(h.group && h.group === a.group)) return;                              // cross-group knockout tie
        if ((gcount[m.home] || 0) >= 3 || (gcount[m.away] || 0) >= 3) return;        // beyond the three group games
        gcount[m.home] = (gcount[m.home] || 0) + 1; gcount[m.away] = (gcount[m.away] || 0) + 1;
      }

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
    var teams = computeTeams(state, true);   // group-stage only — the wooden spoon freezes after the groups
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
    var teams = computeTeams(state, true), byLabel = {};
    Object.keys(teams).forEach(function (k) { var t = teams[k], g = t.group || 'Unassigned'; (byLabel[g] = byLabel[g] || []).push(t); });
    var matchesByLabel = matchesByGroupLabel(state, teams);
    Object.keys(byLabel).forEach(function (g) { byLabel[g] = rankGroup(byLabel[g], matchesByLabel[g]); });
    return byLabel;
  }

  // Group every match by its teams' group, using the team->group assignment from
  // computeTeams. ESPN often omits the group label on individual matches, so
  // grouping by team membership (not each match's own label) captures all of a
  // group's games — keeping league tables, status and the thirds race consistent.
  function matchesByGroupLabel(state, teams) {
    teams = teams || computeTeams(state);
    var by = {};
    state.matches.forEach(function (m) {
      if (!m.home || !m.away) return;
      var g = (teams[m.home] && teams[m.home].group) || (teams[m.away] && teams[m.away].group);
      if (g) (by[g] = by[g] || []).push(m);
    });
    return by;
  }

  // Map group letter -> array of that group's matches (by team membership).
  function matchesByGroup(state) {
    var byLabel = matchesByGroupLabel(state), by = {};
    Object.keys(byLabel).forEach(function (label) {
      var g = /group\s+([a-l])\b/i.exec(label);
      if (g) by[g[1].toUpperCase()] = byLabel[label];
    });
    return by;
  }

  // Is the group finished? Each team in a four-team group plays three games, so
  // the group is done once every team has three results on the board. Counting by
  // results (any match with a score) instead of a full-time flag is robust to a
  // just-finished game still showing as 'live', or other feed quirks.
  function groupComplete(matches) {
    var teamSet = {}, played = {};
    matches.forEach(function (m) {
      if (m.home) teamSet[m.home] = 1;
      if (m.away) teamSet[m.away] = 1;
      if (m.homeScore == null || m.awayScore == null) return;
      if (m.home) played[m.home] = (played[m.home] || 0) + 1;
      if (m.away) played[m.away] = (played[m.away] || 0) + 1;
    });
    var teams = Object.keys(teamSet);
    return teams.length > 0 && teams.every(function (t) { return (played[t] || 0) >= 3; });
  }

  function matchId(m) { return m._espnId != null ? String(m._espnId) : (m.home + '|' + m.away + '|' + (m.group || '')); }

  // Head-to-head points among a set of team names, given each group match's
  // outcome ('H' home win, 'A' away win, 'D' draw). Only games between the set.
  function h2hPointsOf(teamNames, matches, outcome) {
    var set = {}, p = {};
    teamNames.forEach(function (t) { set[t] = 1; p[t] = 0; });
    matches.forEach(function (m) {
      if (!set[m.home] || !set[m.away]) return;
      var o = outcome[matchId(m)];
      if (o === 'H') p[m.home] += 3; else if (o === 'A') p[m.away] += 3; else if (o === 'D') { p[m.home]++; p[m.away]++; }
    });
    return p;
  }

  // Split a points-level set into ordered "bands" by head-to-head points,
  // re-applied to any still-level subset. Teams that stay level after H2H points
  // share a band — their order then depends on goal difference (not decided by
  // win/draw/loss alone), so we leave them undetermined.
  function h2hBands(teamNames, matches, outcome) {
    if (teamNames.length <= 1) return [teamNames.slice()];
    var p = h2hPointsOf(teamNames, matches, outcome);
    var sorted = teamNames.slice().sort(function (a, b) { return p[b] - p[a]; });
    var out = [], i = 0;
    while (i < sorted.length) {
      var j = i + 1; while (j < sorted.length && p[sorted[j]] === p[sorted[i]]) j++;
      var sub = sorted.slice(i, j);
      if (sub.length === 1) out.push(sub);
      else if (sub.length === teamNames.length) out.push(sub);             // no split → undetermined band
      else h2hBands(sub, matches, outcome).forEach(function (b) { out.push(b); });
      i = j;
    }
    return out;
  }

  // Order all teams for one scenario into bands: overall points, then H2H points.
  function scenarioBands(teamNames, pts, matches, outcome) {
    var byPts = teamNames.slice().sort(function (a, b) { return pts[b] - pts[a]; });
    var bands = [], i = 0;
    while (i < byPts.length) {
      var j = i + 1; while (j < byPts.length && pts[byPts[j]] === pts[byPts[i]]) j++;
      var cluster = byPts.slice(i, j);
      if (cluster.length === 1) bands.push(cluster);
      else h2hBands(cluster, matches, outcome).forEach(function (b) { bands.push(b); });
      i = j;
    }
    return bands;
  }

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
    var status = {};
    var meta = {};       // team -> { group, maxPts, everTop2 }
    var minThird = {};   // group -> guaranteed-minimum points of its eventual 3rd team
    var maxThird = {};   // group -> best-possible points of its eventual 3rd team
    var completeThirds = [];  // 3rd-placed teams of finished groups: { team, group, pts }

    // Use the SAME canonical records and grouping as the displayed tables, so
    // status can never disagree with the table. `teams` counts group-stage games
    // only (knockout results mustn't skew the frozen group tables); matches are
    // grouped by team membership for the head-to-head and brute-force scenarios.
    var teams = computeTeams(state, true);
    var byMatches = matchesByGroupLabel(state, teams);
    var byGroup = {}, byTeams = {};
    Object.keys(byMatches).forEach(function (label) { var gm = /group\s+([a-l])\b/i.exec(label); if (gm) byGroup[gm[1].toUpperCase()] = byMatches[label]; });
    Object.keys(teams).forEach(function (name) { var gm = /group\s+([a-l])\b/i.exec(teams[name].group || ''); if (gm) (byTeams[gm[1].toUpperCase()] = byTeams[gm[1].toUpperCase()] || []).push(teams[name]); });

    Object.keys(byTeams).forEach(function (key) {
      var recs = byTeams[key];
      var tlist = recs.map(function (r) { return r.team; });
      var matches = byGroup[key] || [];

      // Finished group: every team has played its three games. Rank the canonical
      // records (identical to the displayed table) so status and table agree.
      if (recs.length && recs.every(function (r) { return r.P >= 3; })) {
        var sorted = rankGroup(recs.slice(), matches);
        sorted.forEach(function (r, i) {
          status[r.team] = i < 2 ? 'through' : (i === 2 ? 'alive' : 'eliminated');
          meta[r.team] = { group: key, maxPts: r.Pts, everTop2: i < 2 };
        });
        minThird[key] = maxThird[key] = sorted[2] ? sorted[2].Pts : 0;
        if (sorted[2]) completeThirds.push({ team: sorted[2].team, group: key, pts: sorted[2].Pts, rec: sorted[2] });
        return;
      }

      // Brute-force the remaining W/D/L outcomes. Within a scenario we resolve
      // positions by points then head-to-head POINTS (both fixed by W/D/L);
      // teams still level after that ("undetermined" — separated only by goal
      // difference) are treated as possibly-above for clinching and
      // possibly-below for elimination, so the calls stay sound.
      var remaining = matches.filter(function (m) { return !isFinished(m); });
      var k = remaining.length, combos = Math.pow(3, k);
      var fixed = {};
      matches.forEach(function (m) { if (isFinished(m)) fixed[matchId(m)] = m.homeScore > m.awayScore ? 'H' : (m.homeScore < m.awayScore ? 'A' : 'D'); });
      var alwaysTop2 = {}, everTop2 = {}, everTop3 = {}, maxPts = {}, minThirdPts = Infinity, maxThirdPts = -Infinity;
      tlist.forEach(function (t) { alwaysTop2[t] = true; everTop2[t] = false; everTop3[t] = false; maxPts[t] = 0; });
      for (var c = 0; c < combos; c++) {
        var outcome = {}; for (var fk in fixed) if (fixed.hasOwnProperty(fk)) outcome[fk] = fixed[fk];
        var cc = c;
        for (var i = 0; i < k; i++) { var o = cc % 3; cc = Math.floor(cc / 3); outcome[matchId(remaining[i])] = o === 0 ? 'H' : (o === 1 ? 'A' : 'D'); }
        var pts = {}; tlist.forEach(function (t) { pts[t] = 0; });
        matches.forEach(function (m) { var oo = outcome[matchId(m)]; if (oo === 'H') pts[m.home] += 3; else if (oo === 'A') pts[m.away] += 3; else { pts[m.home]++; pts[m.away]++; } });
        var ordered = tlist.map(function (t) { return pts[t]; }).sort(function (a, b) { return b - a; });
        if (ordered[2] != null && ordered[2] < minThirdPts) minThirdPts = ordered[2];
        if (ordered[2] != null && ordered[2] > maxThirdPts) maxThirdPts = ordered[2];
        var bands = scenarioBands(tlist, pts, matches, outcome), above = {}, cum = 0;
        bands.forEach(function (band) { band.forEach(function (t) { above[t] = { a: cum, band: band.length }; }); cum += band.length; });
        tlist.forEach(function (t) {
          if (pts[t] > maxPts[t]) maxPts[t] = pts[t];
          var sa = above[t].a, und = above[t].band - 1;   // teams strictly above, and undetermined ties
          if (sa <= 1) everTop2[t] = true;                 // best case (ties favourable)
          if (sa <= 2) everTop3[t] = true;
          if (sa + und > 1) alwaysTop2[t] = false;          // worst case (ties against)
        });
      }
      minThird[key] = isFinite(minThirdPts) ? minThirdPts : 0;
      maxThird[key] = isFinite(maxThirdPts) ? maxThirdPts : 0;
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

    // Best-8-thirds qualification (the mirror image): a finished group's 3rd-placed
    // team is THROUGH once at most seven other groups' thirds could still match or
    // beat its points — it's then guaranteed to be one of the eight that advance.
    // Conservative (>= counts as a possible threat) so it never ticks too early.
    completeThirds.forEach(function (ct) {
      if (status[ct.team] === 'eliminated') return;
      var threats = 0;
      groupKeys.forEach(function (g) { if (g !== ct.group && (maxThird[g] || 0) >= ct.pts) threats++; });
      if (threats <= 7) status[ct.team] = 'through';
    });

    // Once EVERY group is finished the third-place table is final: rank all twelve
    // thirds by the full 2026 tiebreakers (the same order the Third-Place Race
    // table uses) and settle them definitively — the best eight go through, the
    // other four are knocked out (decided on goal difference where points tie).
    if (completeThirds.length === Object.keys(byTeams).length) {
      completeThirds.slice().sort(function (a, b) {
        var x = a.rec, y = b.rec;
        return (y.Pts - x.Pts) || (y.GD - x.GD) || (y.GF - x.GF) || ((x.cardPoints || 0) - (y.cardPoints || 0)) || x.team.localeCompare(y.team);
      }).forEach(function (ct, i) { status[ct.team] = i < 8 ? 'through' : 'eliminated'; });
    }

    return status;
  }

  /* The race for the best-8 third-placed places. Takes each group's current
     3rd-placed team, ranks them (Pts, GD, GF), and flags the top 8 as in the
     provisional qualifying zone. `settled` marks teams whose group is finished. */
  function thirdPlaceRace(state) {
    var groups = groupTables(state), thirds = [];
    Object.keys(groups).forEach(function (g) {
      if (g === 'Unassigned') return;
      var rows = groups[g], row = rows.filter(function (r) { return r.pos === 3; })[0];
      // A group is settled once every team has played its three games — the same
      // canonical games-played count the tables and status use.
      if (row) { row.settled = rows.length > 0 && rows.every(function (r) { return r.P >= 3; }); thirds.push(row); }
    });
    // Cross-group ranking of the thirds: head-to-head can't apply, so it's
    // points, GD, goals, then fair play (fewer card points better).
    thirds.sort(function (a, b) {
      return (b.Pts - a.Pts) || (b.GD - a.GD) || (b.GF - a.GF) || ((a.cardPoints || 0) - (b.cardPoints || 0)) || a.team.localeCompare(b.team);
    });
    thirds.forEach(function (r, i) { r.thirdRank = i + 1; r.qualifying = i < 8; });
    return thirds;
  }

  // Teams eliminated using only results up to and including `cutoff` (YYYY-MM-DD);
  // matches dated after the cutoff are treated as not-yet-played.
  function eliminatedAsOf(state, cutoff) {
    var matches = state.matches.map(function (m) {
      if (cutoff && m.date && m.date > cutoff) {
        return { _espnId: m._espnId, group: m.group, home: m.home, away: m.away, date: m.date, status: 'scheduled', homeScore: null, awayScore: null };
      }
      return m;
    });
    var st = groupStatus({ matches: matches });
    return Object.keys(st).filter(function (t) { return st[t] === 'eliminated'; });
  }

  // Every knocked-out team -> 1. Three sources:
  //  1. mid-group-stage mathematical eliminations (groupStatus);
  //  2. for any FINISHED group, read the frozen table directly — anyone outside
  //     the top two who isn't a qualifying best-8 third is out. This is robust:
  //     it doesn't depend on the brute-force status path, so a team that's plainly
  //     bottom of a completed group (e.g. 4th place) is always flagged;
  //  3. the losers of any finished knockout tie (equal-score/penalty ties skipped,
  //     since the score may not name the winner).
  function knockedOut(state) {
    var status = groupStatus(state), out = {};
    Object.keys(status).forEach(function (t) { if (status[t] === 'eliminated') out[t] = 1; });

    var tables = groupTables(state), race = thirdPlaceRace(state);
    function finished(rows) { return rows.length > 0 && rows.every(function (r) { return r.P >= 3; }); }
    var groupKeys = Object.keys(tables).filter(function (g) { return g !== 'Unassigned'; });
    var doneGroups = groupKeys.filter(function (g) { return finished(tables[g]); });
    var allDone = groupKeys.length > 0 && doneGroups.length === groupKeys.length;
    // The 4th-placed team of any finished group is out — it can never qualify.
    doneGroups.forEach(function (g) { var r = tables[g][3]; if (r) out[r.team] = 1; });
    // Only once the WHOLE group stage is finished is the best-8-thirds cut final;
    // then a 3rd-placed team outside the qualifying eight is out too. (Before that
    // a 3rd could still climb into the eight as other groups finish.)
    if (allDone) {
      var qualifying = {};
      doneGroups.forEach(function (g) { tables[g].forEach(function (r, i) { if (i < 2) qualifying[r.team] = 1; }); });
      race.forEach(function (r) { if (r.qualifying) qualifying[r.team] = 1; });
      doneGroups.forEach(function (g) { var r = tables[g][2]; if (r && !qualifying[r.team]) out[r.team] = 1; });
    }

    // Knockout-tie losers. A knockout tie is identified by its teams being in
    // DIFFERENT groups (not by the match label — an unlabelled GROUP game would
    // otherwise be mistaken for a knockout and its loser wrongly knocked out).
    var teamGroup = {};
    groupKeys.forEach(function (g) { tables[g].forEach(function (r) { teamGroup[r.team] = g; }); });
    (state.matches || []).forEach(function (m) {
      if (!isFinished(m) || m.homeScore == null || m.awayScore == null || m.homeScore === m.awayScore) return;
      var gh = teamGroup[m.home], ga = teamGroup[m.away];
      if (!gh || !ga || gh === ga) return;   // same group (or ungrouped) → not a knockout tie
      out[m.homeScore > m.awayScore ? m.away : m.home] = 1;
    });
    return out;
  }

  // Teams whose elimination became certain ON `day` (out as of `day`, but not as
  // of the day before) — i.e. knocked out by that day's results.
  function newlyEliminated(state, day) {
    if (!day) return [];
    var d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
    var before = {}; eliminatedAsOf(state, d.toISOString().slice(0, 10)).forEach(function (t) { before[t] = 1; });
    return eliminatedAsOf(state, day).filter(function (t) { return !before[t]; });
  }

  WC.Standings = {
    computeTeams: computeTeams,
    disciplinary: disciplinary,
    worstTeams: worstTeams,
    groupTables: groupTables,
    groupStatus: groupStatus,
    thirdPlaceRace: thirdPlaceRace,
    eliminatedAsOf: eliminatedAsOf,
    knockedOut: knockedOut,
    newlyEliminated: newlyEliminated,
    isFinished: isFinished,
    isCounting: isCounting
  };

})(window.WC = window.WC || {});
