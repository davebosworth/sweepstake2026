/* ============================================================================
 * app.js — UI controller. Fully live: data comes from ESPN on every page load
 * (via WC.Live), nothing is stored, and every table is recomputed on the fly.
 * Read-only — no manual entry. Vanilla JS, no build step.
 * ========================================================================== */
(function (WC) {
  'use strict';

  var Live = WC.Live, S = WC.Standings, R = WC.Report;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  // Inline emoji flag <img> for a team, or null when unknown (safe as an el child).
  function flagEl(team, cls) {
    var src = WC.flagSrc(team);
    return src ? el('img', { class: 'flag' + (cls ? ' ' + cls : ''), src: src, alt: '' }) : null;
  }

  var activeTab = 'dashboard';

  /* ---- shared date helpers ------------------------------------------------ */
  // "Today" in the same host-region basis the matches are grouped by, so date
  // windows (dashboard Upcoming, Morning Report) line up with the day headings.
  function todayISO() { return WC.ESPN.localDay(new Date()); }
  function prettyDate(d) {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }
  // Chronological order by the true kick-off instant, so a post-midnight game
  // (grouped on the previous match day for time-zone reasons) still sorts after
  // that day's earlier kick-offs. Falls back to the UK HH:MM string.
  function byKickoff(a, b) {
    if (a._ts && b._ts) return a._ts - b._ts;
    return (a.kickoff || '').localeCompare(b.kickoff || '');
  }

  /* ---- TAB: Dashboard ----------------------------------------------------- */
  function renderDashboard() {
    var st = Live.get();
    var disc = S.disciplinary(st);
    var worst = S.worstTeams(st);
    var teams = S.computeTeams(st);
    var played = Object.keys(teams).filter(function (k) { return teams[k].played; }).length;
    var finished = st.matches.filter(S.isFinished).length;


    var root = el('div');

    var liveNow = st.matches.filter(function (m) { return m.status === 'live'; }).sort(byKickoff);
    if (liveNow.length) {
      var lp = el('div', { class: 'panel live-panel' });
      lp.appendChild(el('h2', null, [el('span', { class: 'live-dot' }), 'Live Now ',
        el('span', { class: 'sub' }, [liveNow.length + ' in play · auto-updating'])]));
      liveNow.forEach(function (m) { lp.appendChild(matchRow(m)); });
      root.appendChild(lp);
    }

    // Matches: yesterday's and today's completed games plus the not-yet-started
    // games for today and tomorrow, in true play order. (In-play games sit in
    // Live Now.)
    var yesterday = WC.ESPN.localDay(new Date(Date.now() - 86400000));
    var today = todayISO();
    var tomorrow = WC.ESPN.localDay(new Date(Date.now() + 86400000));
    var upcoming = st.matches.filter(function (m) {
      if (m.status === 'ft') return m.date === yesterday || m.date === today;
      return m.status === 'scheduled' && (m.date === today || m.date === tomorrow);
    }).sort(byKickoff);
    if (upcoming.length) {
      var up = el('div', { class: 'panel' });
      up.appendChild(el('h2', null, ['Matches ', el('span', { class: 'sub' }, ['yesterday, today & tomorrow'])]));
      var byDate = {};
      upcoming.forEach(function (m) { (byDate[m.date || 'Undated'] = byDate[m.date || 'Undated'] || []).push(m); });
      Object.keys(byDate).sort().forEach(function (d) {
        up.appendChild(el('h3', { class: 'date-head' }, [d === 'Undated' ? 'Undated' : prettyDate(d)]));
        byDate[d].forEach(function (m) { up.appendChild(matchRow(m)); });
      });
      root.appendChild(up);
    }

    var grid = el('div', { class: 'grid' });
    grid.appendChild(statCard('Matches played', finished));
    grid.appendChild(statCard('Teams in action', played + ' / 48'));
    grid.appendChild(statCard('Disciplinary leader', disc.length ? disc[0].team + ' · ' + disc[0].owner : '—'));
    grid.appendChild(statCard('Wooden spoon', worst.length ? worst[0].team + ' · ' + worst[0].owner : '—'));
    root.appendChild(grid);

    root.appendChild(prizePanel(st));
    root.appendChild(favouritesPanel());

    var col = el('div', { class: 'two-col' });

    var dWrap = el('div', { class: 'panel' });
    dWrap.appendChild(el('h2', null, ['Disciplinary Prize ', el('span', { class: 'sub' }, ['Red = 3 · Yellow = 1 · most wins · top 5'])]));
    if (st.detailLoading && !disc.length) dWrap.appendChild(el('p', { class: 'empty' }, ['Loading cards from ESPN…']));
    else if (!disc.length) dWrap.appendChild(el('p', { class: 'empty' }, ['No cards recorded yet.']));
    else {
      var dt = el('table', { class: 'tbl' });
      dt.innerHTML = '<thead><tr><th>#</th><th>Team</th><th>Owner</th><th class="r">🟥</th><th class="r">🟨</th><th class="r">Pts</th></tr></thead>';
      var tb = el('tbody');
      disc.slice(0, 5).forEach(function (r) {
        var tr = el('tr', r.rank === 1 ? { class: 'leader' } : null);
        var team = WC.flagHTML(r.team) + (r.live ? '<span class="live-dot"></span>' : '') + r.team;
        tr.innerHTML = '<td>' + r.rank + (r.rank === 1 ? ' ★' : '') + '</td><td>' + team + '</td><td class="muted">' + r.owner +
          '</td><td class="r">' + r.red + '</td><td class="r">' + r.yellow + '</td><td class="r b gold">' + r.cardPoints + '</td>';
        tb.appendChild(tr);
      });
      dt.appendChild(tb); dWrap.appendChild(dt);
    }
    col.appendChild(dWrap);

    var wWrap = el('div', { class: 'panel' });
    wWrap.appendChild(el('h2', null, ['Worst Teams']));
    if (!worst.length) wWrap.appendChild(el('p', { class: 'empty' }, ['No qualifying teams yet.']));
    else {
      var wt = el('table', { class: 'tbl' });
      wt.innerHTML = '<thead><tr><th>#</th><th>Team</th><th>Owner</th><th class="r">Pts</th><th class="r">GD</th></tr></thead>';
      var wb = el('tbody');
      worst.forEach(function (r) {
        var tr = el('tr', r.live ? { class: 'liverow' } : null);
        var gd = (r.GD > 0 ? '+' : '') + r.GD;
        var team = WC.flagHTML(r.team) + (r.live ? '<span class="live-dot"></span>' : '') + r.team;
        tr.innerHTML = '<td>' + r.rank + '</td><td>' + team + '</td><td class="muted">' + r.owner +
          '</td><td class="r b">' + r.Pts + '</td><td class="r ' + (r.GD < 0 ? 'red' : '') + '">' + gd + '</td>';
        wb.appendChild(tr);
      });
      wt.appendChild(wb); wWrap.appendChild(wt);
    }
    col.appendChild(wWrap);
    root.appendChild(col);
    return root;
  }

  function statCard(label, value) {
    return el('div', { class: 'stat' }, [
      el('div', { class: 'stat-v' }, [String(value)]),
      el('div', { class: 'stat-l' }, [label])
    ]);
  }

  function fmtOdds(d) { return d == null ? '—' : d.toFixed(2); }
  function fmtPct(p) { return p == null ? '—' : (p * 100).toFixed(1) + '%'; }

  // Dashboard: the five shortest-priced teams to win, with owner + odds.
  function favouritesPanel() {
    var panel = el('div', { class: 'panel' });
    panel.appendChild(el('h2', null, ['Sweepstake Favourites ', el('span', { class: 'sub' }, ['top 5 to win the World Cup'])]));

    if (oddsState.status === 'nokey') {
      panel.appendChild(el('p', { class: 'empty' }, ['Add a betting-odds API key on the ', el('b', null, ['Winner Odds']), ' tab to see live favourites.']));
      return panel;
    }
    if (oddsState.status === 'loading') { panel.appendChild(el('p', { class: 'empty' }, ['Loading odds…'])); return panel; }
    if (oddsState.status === 'error') { panel.appendChild(el('p', { class: 'empty red' }, ['Odds unavailable — ' + oddsState.error])); return panel; }

    var top = oddsState.rows.filter(function (r) { return r.winnerOdds != null; })
      .sort(function (a, b) { return a.winnerOdds - b.winnerOdds; }).slice(0, 5);
    if (!top.length) { panel.appendChild(el('p', { class: 'empty' }, ['No odds returned.'])); return panel; }

    var t = el('table', { class: 'tbl' });
    t.innerHTML = '<thead><tr><th>#</th><th>Team</th><th>Owner</th><th class="r">Win %</th><th class="r">Odds</th></tr></thead>';
    var tb = el('tbody');
    top.forEach(function (r, i) {
      var tr = el('tr', i === 0 ? { class: 'leader' } : null);
      tr.innerHTML = '<td>' + (i + 1) + (i === 0 ? ' ★' : '') + '</td><td>' + WC.flagHTML(r.team) + r.team + '</td><td class="muted">' + r.owner +
        '</td><td class="r b gold">' + fmtPct(r.winnerProb) + '</td><td class="r">' + fmtOdds(r.winnerOdds) + '</td>';
      tb.appendChild(tr);
    });
    t.appendChild(tb); panel.appendChild(t);
    return panel;
  }

  /* Predict who currently wins each cash prize. Winner/runner-up come from the
     live odds (shortest price); worst team and dirtiest team from the live ESPN
     standings. Best Goal isn't tracked, so it's shown but not predicted. */
  function prizePredictions(st) {
    var oddsNote = oddsState.status === 'nokey' ? 'awaiting odds key'
      : oddsState.status === 'loading' ? 'loading odds…'
      : oddsState.status === 'error' ? 'odds unavailable' : 'awaiting odds';
    var winRows = oddsState.status === 'ok'
      ? oddsState.rows.filter(function (r) { return r.winnerOdds != null; }).sort(function (a, b) { return a.winnerOdds - b.winnerOdds; })
      : [];
    var ruRows = oddsState.status === 'ok'
      ? oddsState.rows.filter(function (r) { return r.runnerUpOdds != null; }).sort(function (a, b) { return a.runnerUpOdds - b.runnerUpOdds; })
      : [];

    var winner = winRows[0] || null;
    var runner = null, ruBasis;
    if (ruRows.length) { runner = ruRows[0]; ruBasis = 'shortest runner-up odds'; }
    else if (winRows.length > 1) { runner = winRows[1]; ruBasis = '2nd-favourite (no runner-up market)'; }

    var worst = S.worstTeams(st)[0] || null;
    var disc = S.disciplinary(st)[0] || null;

    return [
      { prize: 'Overall Winner', amount: 80, team: winner && winner.team, owner: winner && winner.owner, basis: winner ? 'shortest winner odds' : oddsNote },
      { prize: 'Runner Up', amount: 20, team: runner && runner.team, owner: runner && runner.owner, basis: runner ? ruBasis : (winRows.length ? '—' : oddsNote) },
      { prize: 'Worst Team', amount: 20, team: worst && worst.team, owner: worst && worst.owner, live: !!(worst && worst.live), basis: worst ? 'bottom of wooden-spoon table' : 'no matches yet' },
      { prize: 'Dirtiest Team', amount: 20, team: disc && disc.team, owner: disc && disc.owner, live: !!(disc && disc.live), basis: disc ? 'most disciplinary points' : 'no cards yet' },
      { prize: 'Best Goal', amount: 20, team: null, owner: null, basis: 'not tracked', excluded: true }
    ];
  }

  // Dashboard: current predicted payout of the £160 pot.
  function prizePanel(st) {
    var panel = el('div', { class: 'panel' });
    panel.appendChild(el('h2', null, ['Current Prize Prediction ',
      el('span', { class: 'sub' }, ['£160 pot · 8 × £20 · based on live odds & tables'])]));

    var preds = prizePredictions(st);
    var t = el('table', { class: 'tbl' });
    t.innerHTML = '<thead><tr><th>Prize</th><th>Predicted team</th><th>Player</th><th class="r">£</th></tr></thead>';
    var tb = el('tbody');
    preds.forEach(function (p) {
      var tr = el('tr', { class: (p.excluded ? 'muted' : (p.amount === 80 ? 'leader' : '')) });
      tr.innerHTML = '<td><b>' + p.prize + '</b></td>' +
        '<td>' + (p.live ? '<span class="live-dot"></span>' : '') + (p.team ? WC.flagHTML(p.team) + p.team : '<span class="muted">—</span>') + '</td>' +
        '<td class="' + (p.owner ? 'b' : 'muted') + '">' + (p.owner || '—') + '</td>' +
        '<td class="r b ' + (p.excluded ? 'muted' : 'gold') + '">£' + p.amount + '</td>';
      tb.appendChild(tr);
    });
    t.appendChild(tb); panel.appendChild(t);

    // Per-player predicted return (winnings − £20 stake).
    var byOwner = {};
    preds.forEach(function (p) { if (p.owner) byOwner[p.owner] = (byOwner[p.owner] || 0) + p.amount; });
    var winners = Object.keys(byOwner).map(function (o) { return { owner: o, win: byOwner[o] }; })
      .sort(function (a, b) { return b.win - a.win; });
    if (winners.length) {
      var sum = el('p', { class: 'muted small', style: 'margin:10px 2px 0' });
      sum.appendChild(document.createTextNode('Predicted returns: '));
      winners.forEach(function (w, i) {
        var net = w.win - 20;
        sum.appendChild(el('b', { class: 'gold' }, [w.owner]));
        sum.appendChild(document.createTextNode(' £' + w.win + ' (net ' + (net >= 0 ? '+' : '−') + '£' + Math.abs(net) + ')' + (i < winners.length - 1 ? ' · ' : '')));
      });
      sum.appendChild(document.createTextNode('. Everyone else −£20.'));
      panel.appendChild(sum);
    }
    return panel;
  }

  /* ---- TAB: Player Tracker ------------------------------------------------ */
  // For each player, average the winner odds across their six teams (shorter
  // average = stronger allocation) and sum the win probabilities (combined
  // chance one of their teams lifts the cup). Ranked best allocation first.
  function playerStats() {
    var byTeam = {};
    if (oddsState.status === 'ok') oddsState.rows.forEach(function (r) { byTeam[r.team] = r; });
    return WC.PLAYERS.map(function (p) {
      var odds = [], probSum = 0, best = null;
      var teams = p.teams.map(function (t) {
        var r = byTeam[t] || {};
        var o = (r.winnerOdds != null) ? r.winnerOdds : null;
        if (o != null) {
          odds.push(o);
          if (r.winnerProb != null) probSum += r.winnerProb;
          if (!best || o < best.odds) best = { team: t, odds: o };
        }
        return { team: t, odds: o, prob: (r.winnerProb != null ? r.winnerProb : null) };
      }).sort(function (a, b) {
        if (a.odds == null && b.odds == null) return a.team.localeCompare(b.team);
        if (a.odds == null) return 1;
        if (b.odds == null) return -1;
        return a.odds - b.odds;
      });
      var avg = odds.length ? odds.reduce(function (s, x) { return s + x; }, 0) / odds.length : null;
      return { name: p.name, teams: teams, avgOdds: avg, winPct: probSum, priced: odds.length, best: best };
    }).sort(function (a, b) {
      return b.winPct - a.winPct; // highest combined win % = strongest allocation
    });
  }

  function renderPlayers() {
    var root = el('div');
    var panel = el('div', { class: 'panel' });
    panel.appendChild(el('h2', null, ['Allocation Quality ',
      el('span', { class: 'sub' }, ['ranked by combined chance one of each player’s six teams wins'])]));

    if (oddsState.status === 'nokey') {
      panel.appendChild(el('p', { class: 'empty' }, ['Add a betting-odds API key on the ', el('b', null, ['Winner Odds']), ' tab to rank allocations.']));
      root.appendChild(panel); return root;
    }
    if (oddsState.status === 'loading') { panel.appendChild(el('p', { class: 'empty' }, ['Loading odds…'])); root.appendChild(panel); return root; }
    if (oddsState.status === 'error') { panel.appendChild(el('p', { class: 'empty red' }, ['Odds unavailable — ' + oddsState.error])); root.appendChild(panel); return root; }

    var stats = playerStats();
    var t = el('table', { class: 'tbl' });
    t.innerHTML = '<thead><tr><th>#</th><th>Player</th><th class="r">Combined win %</th><th>Strongest team</th></tr></thead>';
    var tb = el('tbody');
    stats.forEach(function (s, i) {
      var tr = el('tr', i === 0 ? { class: 'leader' } : null);
      var strong = s.best ? s.best.team + ' (' + fmtOdds(s.best.odds) + ')' : '—';
      tr.innerHTML = '<td>' + (i + 1) + (i === 0 ? ' ★' : '') + '</td><td class="b">' + s.name +
        '</td><td class="r b gold">' + fmtPct(s.winPct) + '</td><td>' + strong + '</td>';
      tb.appendChild(tr);
    });
    t.appendChild(tb); panel.appendChild(t);
    panel.appendChild(el('p', { class: 'muted small', style: 'margin:10px 2px 0' }, ['Combined win % is the chance that one of a player’s six teams wins the tournament — higher is a stronger allocation.']));
    root.appendChild(panel);

    // Per-player breakdown of the six teams, shortest price first.
    var breakdown = el('div', { class: 'panel' });
    breakdown.appendChild(el('h2', null, ['Squad Breakdown ', el('span', { class: 'sub' }, ['each player’s six teams']) ]));
    stats.forEach(function (s, i) {
      var det = el('details', i === 0 ? { open: 'open' } : null);
      det.appendChild(el('summary', null, [
        el('span', { class: 'pl-rank' }, ['#' + (i + 1)]),
        el('b', null, [s.name]),
        el('span', { class: 'muted small' }, ['  ' + fmtPct(s.winPct) + ' combined win'])
      ]));
      var tt = el('table', { class: 'tbl' });
      tt.innerHTML = '<thead><tr><th>Team</th><th class="r">Winner odds</th><th class="r">Win %</th></tr></thead>';
      var tbb = el('tbody');
      s.teams.forEach(function (tm) {
        var tr = el('tr');
        tr.innerHTML = '<td>' + WC.flagHTML(tm.team) + tm.team + '</td><td class="r">' + fmtOdds(tm.odds) + '</td><td class="r muted">' + fmtPct(tm.prob) + '</td>';
        tbb.appendChild(tr);
      });
      tt.appendChild(tbb); det.appendChild(tt);
      breakdown.appendChild(det);
    });
    root.appendChild(breakdown);
    return root;
  }

  /* ---- TAB: Stats (Golden Boot + tournament records) ---------------------- */
  function renderStats() {
    var st = Live.get();
    var root = el('div');
    if (st.loading) { root.appendChild(loadingBlock('Loading stats…')); return root; }

    var rec = WC.Stats.records(st);
    var has = rec.matchesCounted > 0;
    function matchLabel(x) { return x ? (x.m.home + ' ' + x.m.homeScore + '–' + x.m.awayScore + ' ' + x.m.away) : '—'; }

    // Headline numbers
    var grid = el('div', { class: 'grid' });
    grid.appendChild(statCard('Goals', has ? rec.totalGoals : '—'));
    grid.appendChild(statCard('Goals / game', rec.goalsPerGame != null ? rec.goalsPerGame.toFixed(2) : '—'));
    grid.appendChild(statCard('Clean sheets', has ? rec.cleanSheets : '—'));
    grid.appendChild(statCard('Yellow / Red', rec.totalYellows + ' / ' + rec.totalReds));
    root.appendChild(grid);

    // Records
    var recPanel = el('div', { class: 'panel' });
    recPanel.appendChild(el('h2', null, ['Tournament Records']));
    if (!has) recPanel.appendChild(el('p', { class: 'empty' }, ['No completed matches yet.']));
    else {
      var rt = el('table', { class: 'tbl' });
      rt.innerHTML = '<thead><tr><th>Record</th><th>Match</th></tr></thead>';
      var rb = el('tbody');
      [['Biggest win', matchLabel(rec.biggestWin)],
       ['Highest-scoring', rec.highestScoring ? matchLabel(rec.highestScoring) + ' (' + rec.highestScoring.total + ')' : '—'],
       ['Most cards', rec.mostCards ? matchLabel(rec.mostCards) + ' (' + rec.mostCards.cards + ')' : '—'],
       ['Own goals', String(rec.ownGoals)]
      ].forEach(function (row) {
        var tr = el('tr');
        tr.innerHTML = '<td class="b">' + row[0] + '</td><td class="muted">' + row[1] + '</td>';
        rb.appendChild(tr);
      });
      rt.appendChild(rb); recPanel.appendChild(rt);
    }
    root.appendChild(recPanel);

    // Golden Boot
    var gb = WC.Stats.goldenBoot(st);
    var gbPanel = el('div', { class: 'panel' });
    gbPanel.appendChild(el('h2', null, ['Golden Boot ', el('span', { class: 'sub' }, ['top scorers'])]));
    if (!gb.length) {
      gbPanel.appendChild(el('p', { class: 'empty' }, [st.detailLoading ? 'Loading scorers from ESPN…' : 'No goals recorded yet.']));
    } else {
      var t = el('table', { class: 'tbl scorers' });
      t.innerHTML = '<thead><tr><th>#</th><th>Player</th><th>Team</th><th>Owner</th><th class="r">Goals</th><th class="r">Pens</th></tr></thead>';
      var tb = el('tbody');
      gb.forEach(function (r, i) {
        var tr = el('tr', i === 0 ? { class: 'leader' } : null);
        tr.innerHTML = '<td>' + (i + 1) + (i === 0 ? ' ★' : '') + '</td><td class="b">' + r.player + '</td><td>' + WC.flagHTML(r.team) + r.team +
          '</td><td class="muted">' + r.owner + '</td><td class="r b gold">' + r.goals + '</td><td class="r muted">' + (r.pens || '') + '</td>';
        tb.appendChild(tr);
      });
      t.appendChild(tb); gbPanel.appendChild(t);
    }
    root.appendChild(gbPanel);

    // Power Rankings & Luck (need odds for pre-tournament strength).
    if (oddsState.status !== 'ok') {
      var note = el('div', { class: 'panel' });
      note.appendChild(el('h2', null, ['Power Rankings & Luck']));
      note.appendChild(el('p', { class: 'empty' }, ['Add a betting-odds API key on the ', el('b', null, ['Winner Odds']), ' tab to blend form with pre-tournament odds.']));
      root.appendChild(note);
      return root;
    }

    var power = WC.Stats.powerRankings(st, oddsState.rows);
    var pPanel = el('div', { class: 'panel' });
    pPanel.appendChild(el('h2', null, ['Power Rankings ', el('span', { class: 'sub' }, ['odds + form (weights toward form as games are played)'])]));
    var pt = el('table', { class: 'tbl power' });
    pt.innerHTML = '<thead><tr><th>#</th><th>Team</th><th>Owner</th><th class="r">Power</th><th class="r">P</th><th class="r">Pts</th><th class="r">GD</th><th class="r">Δ vs odds</th></tr></thead>';
    var ptb = el('tbody');
    power.slice(0, 20).forEach(function (r, i) {
      var tr = el('tr', i === 0 ? { class: 'leader' } : null);
      var gd = (r.GD > 0 ? '+' : '') + r.GD;
      var dv = r.divergence == null ? '<span class="muted">—</span>'
        : '<span class="' + (r.divergence >= 0 ? 'green' : 'red') + '">' + (r.divergence >= 0 ? '+' : '−') + Math.round(Math.abs(r.divergence) * 100) + '</span>';
      tr.innerHTML = '<td>' + (i + 1) + '</td><td class="b">' + WC.flagHTML(r.team) + r.team + '</td><td class="muted">' + r.owner +
        '</td><td class="r b gold">' + Math.round(r.power * 100) + '</td><td class="r">' + r.P + '</td><td class="r">' + r.Pts +
        '</td><td class="r">' + gd + '</td><td class="r">' + dv + '</td>';
      ptb.appendChild(tr);
    });
    pt.appendChild(ptb); pPanel.appendChild(pt);
    pPanel.appendChild(el('p', { class: 'muted small', style: 'margin:10px 2px 0;line-height:1.6' }, [
      'How it works: each team gets a 0–100 Power score that blends two things — its ' +
      'pre-tournament strength (from the bookmakers’ tournament-winner odds, scaled so the ' +
      'favourite sits near 100) and its form so far (points per game plus goal difference per game). ' +
      'Before a team has played, the score is pure odds; with each game the weighting shifts toward ' +
      'form, reaching a 60% form / 40% odds split once a team has three games in — so one freak result ' +
      'can’t top the table early on. A higher Power means a stronger team right now. The “Δ vs odds” ' +
      'column is form minus odds billing: green if a team is out-performing what the odds expected, ' +
      'red if it’s falling short.'
    ]));
    root.appendChild(pPanel);

    // Surprises: biggest over/under-performers (played teams only).
    var played = power.filter(function (r) { return r.divergence != null; });
    if (played.length) {
      var over = played.slice().sort(function (a, b) { return b.divergence - a.divergence; }).slice(0, 3);
      var under = played.slice().sort(function (a, b) { return a.divergence - b.divergence; }).slice(0, 3);
      function surprise(title, rows, cls) {
        var box = el('div', { class: 'panel' });
        box.appendChild(el('h2', null, [title]));
        rows.forEach(function (r) {
          box.appendChild(el('div', { class: 'surprise-row' }, [
            el('span', { class: 'b' }, [flagEl(r.team), r.team]), el('span', { class: 'muted' }, [' · ' + r.owner]),
            el('span', { class: cls }, [(r.divergence >= 0 ? '+' : '−') + Math.round(Math.abs(r.divergence) * 100)])
          ]));
        });
        return box;
      }
      var col = el('div', { class: 'two-col' }, [
        surprise('Over-performers', over, 'green'),
        surprise('Under-performers', under, 'red')
      ]);
      root.appendChild(col);
    }

    // Luck Index per player.
    var luck = WC.Stats.luckIndex(st, oddsState.rows);
    var lPanel = el('div', { class: 'panel' });
    lPanel.appendChild(el('h2', null, ['Luck Index ', el('span', { class: 'sub' }, ['actual vs odds-expected points'])]));
    var lt = el('table', { class: 'tbl' });
    lt.innerHTML = '<thead><tr><th>Player</th><th class="r">Actual pts</th><th class="r">Expected</th><th class="r">Luck</th></tr></thead>';
    var ltb = el('tbody');
    luck.forEach(function (r, i) {
      var tr = el('tr', i === 0 ? { class: 'leader' } : null);
      var lk = (r.luck >= 0 ? '+' : '−') + Math.abs(r.luck).toFixed(1);
      tr.innerHTML = '<td class="b">' + r.player + '</td><td class="r">' + r.actualPts + '</td><td class="r muted">' + r.expectedPts.toFixed(1) +
        '</td><td class="r b ' + (r.luck >= 0 ? 'green' : 'red') + '">' + lk + '</td>';
      ltb.appendChild(tr);
    });
    lt.appendChild(ltb); lPanel.appendChild(lt);
    lPanel.appendChild(el('p', { class: 'muted small', style: 'margin:10px 2px 0' }, ['Positive = a player’s teams are earning more points than the odds predicted; negative = unlucky.']));
    root.appendChild(lPanel);
    return root;
  }

  /* ---- TAB: Fixtures & Results (read-only) -------------------------------- */
  function renderFixtures() {
    var st = Live.get();
    var root = el('div');

    if (st.loading) { root.appendChild(loadingBlock('Loading fixtures from ESPN…')); return root; }
    if (!st.matches.length) {
      root.appendChild(el('p', { class: 'empty big' }, [st.error ? 'No data — ' + st.error : 'No matches returned by ESPN for the tournament window.']));
      return root;
    }

    root.appendChild(el('p', { class: 'count' }, [st.matches.length + ' matches · live from ESPN' + (st.detailLoading ? ' · loading scorers & cards…' : '')]));

    var byDate = {};
    st.matches.forEach(function (m) { (byDate[m.date || 'Undated'] = byDate[m.date || 'Undated'] || []).push(m); });
    Object.keys(byDate).sort().forEach(function (date) {
      root.appendChild(el('h3', { class: 'date-head' }, [date === 'Undated' ? 'Undated' : prettyDate(date)]));
      byDate[date].sort(byKickoff)
        .forEach(function (m) { root.appendChild(matchRow(m)); });
    });
    return root;
  }

  function matchRow(m) {
    var fin = S.isFinished(m);
    var live = m.status === 'live' && m.homeScore != null;
    var score = (fin || live) ? (m.homeScore + ' – ' + m.awayScore) : (m.kickoff ? m.kickoff + ' UK' : '—');
    var tag = live
      ? el('span', { class: 'tag live' }, [el('span', { class: 'live-dot' }), m.clock || m.statusDetail || 'LIVE'])
      : el('span', { class: 'tag' }, [m.group || '—']);
    var head = el('div', { class: 'match-head' }, [
      tag,
      el('span', { class: 'mr-teams' }, [
        flagEl(m.home), el('b', null, [m.home || '?']), ' ',
        el('span', { class: 'mr-score ' + (fin ? 'fin' : (live ? 'livescore' : 'sched')) }, [score]), ' ',
        el('b', null, [m.away || '?']), flagEl(m.away, 'flag-r')
      ]),
      el('span', { class: 'mr-owners muted' }, [WC.ownerOf(m.home) + ' v ' + WC.ownerOf(m.away)])
    ]);
    var cardCount = (m.cards || []).length;
    if (cardCount) head.appendChild(el('span', { class: 'mr-cards' }, [cardCount + ' card' + (cardCount === 1 ? '' : 's')]));

    var matchEl = el('div', { class: 'match ' + (fin ? 'is-ft' : (live ? 'is-live' : 'is-sched')) }, [head]);

    // Pre-match win-probability predictor on upcoming games (if ESPN provides it).
    if (!fin && !live && m.predictor && (m.predictor.home != null || m.predictor.away != null)) {
      matchEl.appendChild(predictorBar(m));
    }

    // Finished and in-play matches expand to show goalscorers and cards.
    if (fin || live) {
      matchEl.classList.add('expandable');
      head.appendChild(el('span', { class: 'chevron' }, ['▾']));
      matchEl.appendChild(el('div', { class: 'match-details' }, [teamDetail('home', m), teamDetail('away', m)]));
      head.addEventListener('click', function () { matchEl.classList.toggle('open'); });
    }
    return matchEl;
  }

  // Pre-match win-probability bar (home / draw / away) shown on scheduled cards.
  function predictorBar(m) {
    var p = m.predictor;
    function pct(v) { return v == null ? 0 : Math.max(0, Math.min(100, v)); }
    var h = pct(p.home), d = pct(p.draw), a = pct(p.away);
    var bar = el('div', { class: 'pred-bar' }, [
      el('span', { class: 'pred-h', style: 'width:' + h + '%' }),
      el('span', { class: 'pred-d', style: 'width:' + d + '%' }),
      el('span', { class: 'pred-a', style: 'width:' + a + '%' })
    ]);
    var label = el('div', { class: 'pred-label muted small' }, [
      (m.home || 'Home') + ' ' + Math.round(h) + '%  ·  Draw ' + Math.round(d) + '%  ·  ' + Math.round(a) + '% ' + (m.away || 'Away')
    ]);
    return el('div', { class: 'pred-wrap' }, [el('div', { class: 'pred-cap' }, ['Predicted win probability']), bar, label]);
  }

  function teamDetail(side, m) {
    var team = side === 'home' ? m.home : m.away;
    var scorers = (m.scorers || []).filter(function (s) { return s.team === side; });
    var cards = (m.cards || []).filter(function (c) { return c.team === side; });

    var col = el('div', { class: 'td-col' }, [
      el('div', { class: 'td-team' }, [flagEl(team), team || '?', el('span', { class: 'muted' }, [' · ' + WC.ownerOf(team)])])
    ]);

    var goals = el('div', { class: 'td-block' }, [el('div', { class: 'td-label' }, ['Goals'])]);
    if (scorers.length) scorers.forEach(function (s) { goals.appendChild(el('div', { class: 'td-item' }, ['⚽ ' + s.name])); });
    else goals.appendChild(el('div', { class: 'td-item muted' }, ['—']));
    col.appendChild(goals);

    var cardBlock = el('div', { class: 'td-block' }, [el('div', { class: 'td-label' }, ['Cards'])]);
    if (cards.length) cards.forEach(function (c) {
      cardBlock.appendChild(el('div', { class: 'td-item' }, [el('span', { class: 'cardchip ' + c.type }), ' ' + (c.player || 'Unknown')]));
    });
    else cardBlock.appendChild(el('div', { class: 'td-item muted' }, ['—']));
    col.appendChild(cardBlock);
    return col;
  }

  /* ---- TAB: Standings ----------------------------------------------------- */
  function standingsPanel(label, rows) {
    var panel = el('div', { class: 'panel' });
    var anyLive = rows.some(function (r) { return r.live; });
    panel.appendChild(el('h2', null, [label, anyLive ? el('span', { class: 'sub' }, ['live — provisional']) : null]));
    var t = el('table', { class: 'tbl standings' });
    t.innerHTML = '<thead><tr><th>#</th><th>Team</th><th>Owner</th><th class="r">P</th><th class="r">W</th><th class="r">D</th><th class="r">L</th><th class="r">GF</th><th class="r">GA</th><th class="r">GD</th><th class="r">Pts</th></tr></thead>';
    var tb = el('tbody');
    rows.forEach(function (r) {
      var gd = (r.GD > 0 ? '+' : '') + r.GD;
      var tr = el('tr', r.live ? { class: 'liverow' } : null);
      var team = WC.flagHTML(r.team) + (r.live ? '<span class="live-dot"></span>' : '') + r.team;
      tr.innerHTML = '<td>' + r.pos + '</td><td>' + team + '</td><td class="muted">' + r.owner + '</td><td class="r">' + r.P + '</td><td class="r">' + r.W + '</td><td class="r">' + r.D + '</td><td class="r">' + r.L + '</td><td class="r">' + r.GF + '</td><td class="r">' + r.GA + '</td><td class="r">' + gd + '</td><td class="r b">' + r.Pts + '</td>';
      tb.appendChild(tr);
    });
    t.appendChild(tb); panel.appendChild(t);
    return panel;
  }

  function renderStandings() {
    var st = Live.get();
    if (st.loading) { var r0 = el('div'); r0.appendChild(loadingBlock('Loading standings…')); return r0; }
    var groups = S.groupTables(st);
    var keys = Object.keys(groups).sort();
    var root = el('div');
    if (!keys.length) { root.appendChild(el('p', { class: 'empty big' }, ['No standings yet.'])); return root; }

    // ESPN doesn't expose group labels on this feed, so everything lands in one
    // table — present it full-width as the Overall Table. If real groups ever
    // appear, lay them out in the grid.
    if (keys.length === 1) {
      var label = keys[0] === 'Unassigned' ? 'Overall Table' : keys[0];
      root.appendChild(standingsPanel(label, groups[keys[0]]));
      return root;
    }
    var grid = el('div', { class: 'group-grid' });
    keys.forEach(function (g) { grid.appendChild(standingsPanel(g === 'Unassigned' ? 'Overall Table' : g, groups[g])); });
    root.appendChild(grid);
    return root;
  }

  /* ---- TAB: Allocations --------------------------------------------------- */
  function renderAllocations() {
    var root = el('div', { class: 'panel' });
    root.appendChild(el('h2', null, ['Team Allocations']));
    var t = el('table', { class: 'tbl alloc' });
    t.innerHTML = '<thead><tr><th>Player</th><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th><th>6</th></tr></thead>';
    var tb = el('tbody');
    WC.PLAYERS.forEach(function (p) {
      var tr = el('tr');
      tr.innerHTML = '<td class="b gold">' + p.name + '</td>' + p.teams.map(function (t) { return '<td>' + WC.flagHTML(t) + t + '</td>'; }).join('');
      tb.appendChild(tr);
    });
    t.appendChild(tb); root.appendChild(t);
    return root;
  }

  /* ---- TAB: Morning Report ----------------------------------------------- */
  var reportState = { reportDate: null, scale: 2 };
  function renderReport() {
    var st = Live.get();
    if (!reportState.reportDate) reportState.reportDate = todayISO();
    var root = el('div', { class: 'report-tab' });

    var controls = el('div', { class: 'panel report-controls' });
    controls.appendChild(el('h2', null, ['Morning Report']));

    controls.appendChild(field('Report date', dateInput(reportState.reportDate, function (v) { reportState.reportDate = v; refreshPreview(); })));

    var ef = el('label', { class: 'chk' }, [
      (function () { var c = el('input', { type: 'checkbox' }); c.checked = !!st.earlyFilter; c.addEventListener('change', function () { Live.setEarlyFilter(c.checked); }); return c; })(),
      el('span', null, ['Early-tournament filter (Worst Teams: only 0 pts & −GD)'])
    ]);
    controls.appendChild(ef);

    controls.appendChild(field('Footer note (optional)', textInput(st.footerNote, 'e.g. Brazil v Mexico (20:00) lands tomorrow', function (v) { Live.setFooter(v); refreshPreview(); })));

    var scaleSel = el('select', { html: '<option value="1">1× (1080px)</option><option value="2" selected>2× (2160px, crisp)</option><option value="3">3× (3240px)</option>' });
    scaleSel.addEventListener('change', function () { reportState.scale = parseInt(scaleSel.value, 10); });
    controls.appendChild(field('Export resolution', scaleSel));

    controls.appendChild(el('div', { class: 'report-btns' }, [
      el('button', { class: 'btn primary', onclick: exportPNG }, ['⬇ Export PNG']),
      el('button', { class: 'btn', onclick: refreshPreview }, ['↻ Refresh preview'])
    ]));
    if (st.detailLoading) controls.appendChild(el('p', { class: 'muted small' }, ['Scorers & cards still loading — refresh once done for the full report.']));
    root.appendChild(controls);

    root.appendChild(el('div', { class: 'preview', id: 'report-preview' }));
    setTimeout(refreshPreview, 0);
    return root;
  }

  var flagPNGCache = {};   // Twemoji code -> PNG data URI (rasterised once per session)

  // Rasterise a flag SVG to a PNG data URI via an offscreen canvas, so the report
  // (SVG → canvas → PNG) embeds self-contained images that render identically on
  // every device. Same-origin SVG with no external refs → canvas isn't tainted.
  function rasterizeFlag(code) {
    return new Promise(function (resolve) {
      if (flagPNGCache[code]) return resolve();
      fetch('flags/' + code + '.svg').then(function (r) { return r.text(); }).then(function (svg) {
        if (!/<svg[^>]*\bwidth=/.test(svg)) svg = svg.replace('<svg', '<svg width="128" height="128"');
        var img = new Image();
        img.onload = function () {
          try {
            var c = document.createElement('canvas'); c.width = 128; c.height = 128;
            c.getContext('2d').drawImage(img, 0, 0, 128, 128);
            flagPNGCache[code] = c.toDataURL('image/png');
          } catch (e) {}
          resolve();
        };
        img.onerror = function () { resolve(); };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      })['catch'](function () { resolve(); });
    });
  }

  // Rasterise the flags for every team appearing in the report, then run cb.
  function ensureReportFlags(cb) {
    var codes = {};
    (Live.get().matches || []).forEach(function (m) {
      [m.home, m.away].forEach(function (t) { var c = WC.FLAG && WC.FLAG[t]; if (c && !flagPNGCache[c]) codes[c] = 1; });
    });
    var list = Object.keys(codes);
    if (!list.length) return cb();
    Promise.all(list.map(rasterizeFlag)).then(cb, cb);
  }

  function buildReport() {
    return R.build(Live.get(), {
      reportDate: reportState.reportDate,
      timestamp: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      flags: flagPNGCache
    });
  }
  function refreshPreview() {
    ensureReportFlags(function () { var p = $('#report-preview'); if (p) p.innerHTML = buildReport().svg; });
  }
  function exportPNG() {
    ensureReportFlags(function () {
      var built = buildReport();
      R.toPNG(built, reportState.scale, function (blob) {
        if (!blob) { alert('Export failed.'); return; }
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'wc26-morning-report-' + reportState.reportDate + '.png';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      });
    });
  }

  // small input helpers (commit on change so a re-render doesn't drop focus)
  function field(label, control) { return el('label', { class: 'fld' }, [el('span', null, [label]), control]); }
  function dateInput(val, onset) { var i = el('input', { type: 'date', value: val || '' }); i.addEventListener('change', function () { onset(i.value); }); return i; }
  function textInput(val, ph, onset) { var i = el('input', { type: 'text', value: val == null ? '' : val, placeholder: ph || '' }); i.addEventListener('change', function () { onset(i.value); }); return i; }

  function loadingBlock(msg) { return el('div', { class: 'loading' }, [el('div', { class: 'spinner' }), el('span', null, [msg])]); }

  /* ---- Odds (The Odds API) ------------------------------------------------ */
  var oddsState = { status: 'idle', rows: [], error: null, updatedAt: null };
  function loadOdds() {
    var cfg = WC.Odds.getConfig();
    if (!cfg.apiKey) { oddsState.status = 'nokey'; render(); return; }
    oddsState.status = 'loading'; render();
    WC.Odds.fetchAll().then(function (res) {
      oddsState.rows = res.rows; oddsState.updatedAt = res.updatedAt; oddsState.status = 'ok'; render();
    }).catch(function (e) {
      oddsState.status = 'error'; oddsState.error = (e && e.message) ? e.message : 'request failed'; render();
    });
  }

  function renderOdds() {
    var cfg = WC.Odds.getConfig();
    var root = el('div');

    // --- status / table ---
    if (oddsState.status === 'nokey' || (oddsState.status === 'idle' && !cfg.apiKey)) {
      root.appendChild(el('p', { class: 'empty big' }, ['Tournament-winner odds aren’t available right now.']));
      return root;
    }
    if (oddsState.status === 'loading') { root.appendChild(loadingBlock('Loading odds…')); return root; }
    if (oddsState.status === 'error') {
      root.appendChild(el('p', { class: 'empty big red' }, ['Could not load odds — ' + oddsState.error]));
      root.appendChild(el('p', { class: 'muted small', style: 'text-align:center' }, ['If this is a CORS error, the browser is blocked from calling the API directly and a small proxy is needed.']));
      return root;
    }
    if (oddsState.status !== 'ok') { root.appendChild(loadingBlock('Loading odds…')); return root; }

    var rows = oddsState.rows.slice().sort(function (a, b) {
      if (a.winnerOdds == null && b.winnerOdds == null) return a.team.localeCompare(b.team);
      if (a.winnerOdds == null) return 1;
      if (b.winnerOdds == null) return -1;
      return a.winnerOdds - b.winnerOdds;
    });

    var panel = el('div', { class: 'panel' });
    panel.appendChild(el('h2', null, ['All Teams · Outright Odds ',
      el('span', { class: 'sub' }, [oddsState.updatedAt ? 'updated ' + oddsState.updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''])]));
    var t = el('table', { class: 'tbl' });
    t.innerHTML = '<thead><tr><th>#</th><th>Team</th><th>Owner</th><th class="r">Win %</th><th class="r">Winner</th><th class="r">Runner-up</th></tr></thead>';
    var tb = el('tbody');
    rows.forEach(function (r, i) {
      var tr = el('tr');
      tr.innerHTML = '<td>' + (i + 1) + '</td><td>' + WC.flagHTML(r.team) + r.team + '</td><td class="muted">' + r.owner +
        '</td><td class="r b gold">' + fmtPct(r.winnerProb) + '</td><td class="r">' + fmtOdds(r.winnerOdds) +
        '</td><td class="r muted">' + fmtOdds(r.runnerUpOdds) + '</td>';
      tb.appendChild(tr);
    });
    t.appendChild(tb); panel.appendChild(t);
    root.appendChild(panel);
    return root;
  }

  /* ---- header status ------------------------------------------------------ */
  function renderStatus() {
    var st = Live.get();
    var box = $('#status');
    box.className = 'status';
    if (st.loading) { box.classList.add('busy'); box.innerHTML = '<span class="dot"></span>Loading live data from ESPN…'; return; }
    if (st.error) { box.classList.add('err'); box.innerHTML = '<span class="dot"></span>Couldn’t reach ESPN — <a id="reload">reload</a>'; wireReload(); return; }
    var t = st.updatedAt ? st.updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
    var liveCount = st.matches.filter(function (m) { return m.status === 'live'; }).length;
    box.classList.add('ok');
    if (liveCount) box.classList.add('live');
    var lead = liveCount ? ('<span class="dot"></span>' + liveCount + ' live now') : '<span class="dot"></span>Live from ESPN';
    box.innerHTML = lead + (st.detailLoading ? ' · loading details…' : ' · updated ' + t) + ' — <a id="reload">reload</a>';
    wireReload();
  }
  function wireReload() { var a = $('#reload'); if (a) a.addEventListener('click', function () { location.reload(); }); }

  /* ---- top-level render --------------------------------------------------- */
  var TABS = [
    ['dashboard', 'Dashboard', renderDashboard],
    ['fixtures', 'Fixtures & Results', renderFixtures],
    ['standings', 'Standings', renderStandings],
    ['odds', 'Winner Odds', renderOdds],
    ['players', 'Player Tracker', renderPlayers],
    ['stats', 'Stats', renderStats],
    ['report', 'Morning Report', renderReport],
    ['allocations', 'Allocations', renderAllocations]
  ];

  function render() {
    $$('#tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === activeTab); });
    renderStatus();
    var view = $('#view');
    view.innerHTML = '';
    view.appendChild(TABS.filter(function (t) { return t[0] === activeTab; })[0][2]());
    // Wrap data tables so wide ones scroll horizontally instead of overflowing.
    $$('#view table.tbl').forEach(function (t) {
      var p = t.parentNode;
      if (p && p.classList && p.classList.contains('tbl-wrap')) return;
      var w = el('div', { class: 'tbl-wrap' });
      p.insertBefore(w, t); w.appendChild(t);
    });
  }

  function init() {
    var tabsEl = $('#tabs');
    TABS.forEach(function (t) {
      tabsEl.appendChild(el('button', { 'data-tab': t[0], onclick: function () { activeTab = t[0]; render(); } }, [t[1]]));
    });
    Live.onChange(function () { render(); });
    render();
    Live.load();
    loadOdds(); // fetch odds if a key is already configured (else flags 'nokey')
  }

  document.addEventListener('DOMContentLoaded', init);

})(window.WC = window.WC || {});
