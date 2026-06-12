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

  var activeTab = 'dashboard';

  /* ---- shared date helpers ------------------------------------------------ */
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function prettyDate(d) {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
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

    var liveNow = st.matches.filter(function (m) { return m.status === 'live'; })
      .sort(function (a, b) { return (a.kickoff || '').localeCompare(b.kickoff || ''); });
    if (liveNow.length) {
      var lp = el('div', { class: 'panel live-panel' });
      lp.appendChild(el('h2', null, [el('span', { class: 'live-dot' }), 'Live Now ',
        el('span', { class: 'sub' }, [liveNow.length + ' in play · auto-updating'])]));
      liveNow.forEach(function (m) { lp.appendChild(matchRow(m)); });
      root.appendChild(lp);
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
    dWrap.appendChild(el('h2', null, ['Disciplinary Prize ', el('span', { class: 'sub' }, ['Red = 3 · Yellow = 1 · most wins'])]));
    if (st.detailLoading && !disc.length) dWrap.appendChild(el('p', { class: 'empty' }, ['Loading cards from ESPN…']));
    else if (!disc.length) dWrap.appendChild(el('p', { class: 'empty' }, ['No cards recorded yet.']));
    else {
      var dt = el('table', { class: 'tbl' });
      dt.innerHTML = '<thead><tr><th>#</th><th>Team</th><th>Owner</th><th class="r">🟥</th><th class="r">🟨</th><th class="r">Pts</th></tr></thead>';
      var tb = el('tbody');
      disc.forEach(function (r) {
        var tr = el('tr', r.rank === 1 ? { class: 'leader' } : null);
        tr.innerHTML = '<td>' + r.rank + (r.rank === 1 ? ' ★' : '') + '</td><td>' + r.team + '</td><td class="muted">' + r.owner +
          '</td><td class="r">' + r.red + '</td><td class="r">' + r.yellow + '</td><td class="r b gold">' + r.cardPoints + '</td>';
        tb.appendChild(tr);
      });
      dt.appendChild(tb); dWrap.appendChild(dt);
    }
    col.appendChild(dWrap);

    var wWrap = el('div', { class: 'panel' });
    wWrap.appendChild(el('h2', null, ['Worst Teams ', el('span', { class: 'sub' }, [st.earlyFilter ? 'early filter on (0 pts, −GD)' : 'full table'])]));
    if (!worst.length) wWrap.appendChild(el('p', { class: 'empty' }, ['No qualifying teams yet.']));
    else {
      var wt = el('table', { class: 'tbl' });
      wt.innerHTML = '<thead><tr><th>#</th><th>Team</th><th>Owner</th><th class="r">Pts</th><th class="r">GD</th></tr></thead>';
      var wb = el('tbody');
      worst.forEach(function (r) {
        var tr = el('tr');
        var gd = (r.GD > 0 ? '+' : '') + r.GD;
        tr.innerHTML = '<td>' + r.rank + '</td><td>' + r.team + '</td><td class="muted">' + r.owner +
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
      tr.innerHTML = '<td>' + (i + 1) + (i === 0 ? ' ★' : '') + '</td><td>' + r.team + '</td><td class="muted">' + r.owner +
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
      { prize: 'Worst Team', amount: 20, team: worst && worst.team, owner: worst && worst.owner, basis: worst ? 'bottom of wooden-spoon table' : 'no matches yet' },
      { prize: 'Dirtiest Team', amount: 20, team: disc && disc.team, owner: disc && disc.owner, basis: disc ? 'most disciplinary points' : 'no cards yet' },
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
        '<td>' + (p.team || '<span class="muted">—</span>') + '</td>' +
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
        tr.innerHTML = '<td>' + tm.team + '</td><td class="r">' + fmtOdds(tm.odds) + '</td><td class="r muted">' + fmtPct(tm.prob) + '</td>';
        tbb.appendChild(tr);
      });
      tt.appendChild(tbb); det.appendChild(tt);
      breakdown.appendChild(det);
    });
    root.appendChild(breakdown);
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
      byDate[date].sort(function (a, b) { return (a.kickoff || '').localeCompare(b.kickoff || ''); })
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
        el('b', null, [m.home || '?']), ' ',
        el('span', { class: 'mr-score ' + (fin ? 'fin' : (live ? 'livescore' : 'sched')) }, [score]), ' ',
        el('b', null, [m.away || '?'])
      ]),
      el('span', { class: 'mr-owners muted' }, [WC.ownerOf(m.home) + ' v ' + WC.ownerOf(m.away)])
    ]);
    var cardCount = (m.cards || []).length;
    if (cardCount) head.appendChild(el('span', { class: 'mr-cards' }, [cardCount + ' card' + (cardCount === 1 ? '' : 's')]));

    var matchEl = el('div', { class: 'match ' + (fin ? 'is-ft' : (live ? 'is-live' : 'is-sched')) }, [head]);

    // Finished and in-play matches expand to show goalscorers and cards.
    if (fin || live) {
      matchEl.classList.add('expandable');
      head.appendChild(el('span', { class: 'chevron' }, ['▾']));
      matchEl.appendChild(el('div', { class: 'match-details' }, [teamDetail('home', m), teamDetail('away', m)]));
      head.addEventListener('click', function () { matchEl.classList.toggle('open'); });
    }
    return matchEl;
  }

  function teamDetail(side, m) {
    var team = side === 'home' ? m.home : m.away;
    var scorers = (m.scorers || []).filter(function (s) { return s.team === side; });
    var cards = (m.cards || []).filter(function (c) { return c.team === side; });

    var col = el('div', { class: 'td-col' }, [
      el('div', { class: 'td-team' }, [team || '?', el('span', { class: 'muted' }, [' · ' + WC.ownerOf(team)])])
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
    panel.appendChild(el('h2', null, [label]));
    var t = el('table', { class: 'tbl' });
    t.innerHTML = '<thead><tr><th>#</th><th>Team</th><th>Owner</th><th class="r">P</th><th class="r">W</th><th class="r">D</th><th class="r">L</th><th class="r">GF</th><th class="r">GA</th><th class="r">GD</th><th class="r">Pts</th></tr></thead>';
    var tb = el('tbody');
    rows.forEach(function (r) {
      var gd = (r.GD > 0 ? '+' : '') + r.GD;
      var tr = el('tr');
      tr.innerHTML = '<td>' + r.pos + '</td><td>' + r.team + '</td><td class="muted">' + r.owner + '</td><td class="r">' + r.P + '</td><td class="r">' + r.W + '</td><td class="r">' + r.D + '</td><td class="r">' + r.L + '</td><td class="r">' + r.GF + '</td><td class="r">' + r.GA + '</td><td class="r">' + gd + '</td><td class="r b">' + r.Pts + '</td>';
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
      tr.innerHTML = '<td class="b gold">' + p.name + '</td>' + p.teams.map(function (t) { return '<td>' + t + '</td>'; }).join('');
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

  function buildReport() {
    return R.build(Live.get(), {
      reportDate: reportState.reportDate,
      timestamp: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    });
  }
  function refreshPreview() { var p = $('#report-preview'); if (p) p.innerHTML = buildReport().svg; }
  function exportPNG() {
    var built = buildReport();
    R.toPNG(built, reportState.scale, function (blob) {
      if (!blob) { alert('Export failed.'); return; }
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'wc26-morning-report-' + reportState.reportDate + '.png';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
  }

  // small input helpers (commit on change so a re-render doesn't drop focus)
  function field(label, control) { return el('label', { class: 'fld' }, [el('span', null, [label]), control]); }
  function dateInput(val, onset) { var i = el('input', { type: 'date', value: val || '' }); i.addEventListener('change', function () { onset(i.value); }); return i; }
  function textInput(val, ph, onset) { var i = el('input', { type: 'text', value: val == null ? '' : val, placeholder: ph || '' }); i.addEventListener('change', function () { onset(i.value); }); return i; }

  function loadingBlock(msg) { return el('div', { class: 'loading' }, [el('div', { class: 'spinner' }), el('span', null, [msg])]); }

  /* ---- Odds (The Odds API) ------------------------------------------------ */
  var oddsState = { status: 'idle', rows: [], error: null, updatedAt: null };
  var marketState = { status: 'idle', list: [], error: null };

  function discoverMarkets() {
    marketState.status = 'loading'; render();
    WC.Odds.listMarkets().then(function (list) {
      marketState.list = list; marketState.status = 'ok'; render();
    }).catch(function (e) {
      marketState.status = 'error'; marketState.error = (e && e.message) || 'failed'; render();
    });
  }

  function marketsBlock() {
    if (marketState.status === 'idle') return el('span');
    var box = el('div', { class: 'markets' });
    if (marketState.status === 'loading') { box.appendChild(el('p', { class: 'muted small' }, ['Looking up markets…'])); return box; }
    if (marketState.status === 'error') { box.appendChild(el('p', { class: 'small red' }, ['Market lookup failed — ' + marketState.error])); return box; }
    if (!marketState.list.length) {
      box.appendChild(el('p', { class: 'muted small' }, ['No World Cup outright markets found on this key — the winner market is usually soccer_fifa_world_cup_winner, and a runner-up market may simply not be offered.']));
      return box;
    }
    box.appendChild(el('div', { class: 'td-label' }, ['World Cup markets on your key']));
    marketState.list.forEach(function (s) {
      box.appendChild(el('div', { class: 'market-row' }, [
        el('code', null, [s.key]),
        el('span', { class: 'muted small' }, [' ' + (s.title || '')]),
        el('button', { class: 'btn small', onclick: function () { WC.Odds.setConfig({ winnerKey: s.key }); render(); } }, ['Use as winner']),
        el('button', { class: 'btn small', onclick: function () { WC.Odds.setConfig({ runnerUpKey: s.key }); render(); } }, ['Use as runner-up'])
      ]));
    });
    return box;
  }

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
    var oddsSharedKey = !!(window.WC_CONFIG && window.WC_CONFIG.apiKey);
    var root = el('div');

    // --- settings ---
    var draft = { apiKey: cfg.apiKey, region: cfg.region, winnerKey: cfg.winnerKey, runnerUpKey: cfg.runnerUpKey };
    var keyInput = el('input', { type: 'password', value: cfg.apiKey, placeholder: 'paste your the-odds-api.com key' });
    keyInput.addEventListener('input', function () { draft.apiKey = keyInput.value.trim(); });
    var regionSel = el('select', { html: ['uk', 'eu', 'us', 'au'].map(function (r) { return '<option value="' + r + '"' + (r === cfg.region ? ' selected' : '') + '>' + r.toUpperCase() + '</option>'; }).join('') });
    regionSel.addEventListener('change', function () { draft.region = regionSel.value; });

    var settings = el('div', { class: 'panel' }, [
      el('h2', null, ['Odds settings']),
      el('p', { class: 'muted small' }, [oddsSharedKey
        ? 'Using the shared key from config.js. Anything you type here applies to this browser only and is overridden by the shared config on reload.'
        : ['Free key from ', el('b', null, ['the-odds-api.com']), '. Stored only in this browser. To share with friends, commit it in ', el('code', null, ['js/config.js']), ' instead.']]),
      el('div', { class: 'odds-cfg' }, [
        field('API key', keyInput),
        field('Region', regionSel),
        field('Winner market key', textInput(cfg.winnerKey, 'soccer_fifa_world_cup_winner', function (v) { draft.winnerKey = v.trim(); })),
        field('Runner-up market key (optional)', textInput(cfg.runnerUpKey, 'leave blank if unknown', function (v) { draft.runnerUpKey = v.trim(); }))
      ]),
      el('div', { class: 'report-btns', style: 'flex-direction:row;flex-wrap:wrap' }, [
        el('button', { class: 'btn primary', onclick: function () { WC.Odds.setConfig(draft); loadOdds(); } }, ['Save & load odds']),
        el('button', { class: 'btn', onclick: loadOdds }, ['↻ Refresh']),
        el('button', { class: 'btn', onclick: function () { WC.Odds.setConfig(draft); discoverMarkets(); } }, ['🔍 Find World Cup markets'])
      ]),
      marketsBlock()
    ]);
    root.appendChild(settings);

    // --- status / table ---
    if (oddsState.status === 'nokey' || (oddsState.status === 'idle' && !cfg.apiKey)) {
      root.appendChild(el('p', { class: 'empty big' }, ['Enter an API key above to load tournament-winner odds for all 48 teams.']));
      return root;
    }
    if (oddsState.status === 'loading') { root.appendChild(loadingBlock('Loading odds…')); return root; }
    if (oddsState.status === 'error') {
      root.appendChild(el('p', { class: 'empty big red' }, ['Could not load odds — ' + oddsState.error]));
      root.appendChild(el('p', { class: 'muted small', style: 'text-align:center' }, ['If this is a CORS error, the browser is blocked from calling the API directly and a small proxy is needed.']));
      return root;
    }
    if (oddsState.status !== 'ok') { root.appendChild(el('p', { class: 'empty big' }, ['Click “Save & load odds”.'])); return root; }

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
      tr.innerHTML = '<td>' + (i + 1) + '</td><td>' + r.team + '</td><td class="muted">' + r.owner +
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
    ['report', 'Morning Report', renderReport],
    ['allocations', 'Allocations', renderAllocations]
  ];

  function render() {
    $$('#tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === activeTab); });
    renderStatus();
    var view = $('#view');
    view.innerHTML = '';
    view.appendChild(TABS.filter(function (t) { return t[0] === activeTab; })[0][2]());
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
