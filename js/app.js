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
    var groupLeft = st.matches.filter(function (m) { return /group/i.test(m.group || '') && m.status !== 'ft'; }).length;
    grid.appendChild(statCard('Matches played', finished));
    grid.appendChild(statCard('Games left in group stage', groupLeft));
    grid.appendChild(statCard('Disciplinary leader', disc.length ? disc[0].team + ' · ' + disc[0].owner : '—'));
    grid.appendChild(statCard('Wooden spoon', worst.length ? worst[0].team + ' · ' + worst[0].owner : '—'));
    root.appendChild(grid);

    root.appendChild(prizePanel(st));
    root.appendChild(projectedReturnsPanel());
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
        var tr = el('tr', { class: (r.rank === 1 ? 'leader' : '') + (r.live ? ' liverow' : '') });
        var gd = (r.GD > 0 ? '+' : '') + r.GD;
        var team = WC.flagHTML(r.team) + (r.live ? '<span class="live-dot"></span>' : '') + r.team;
        tr.innerHTML = '<td>' + r.rank + (r.rank === 1 ? ' ★' : '') + '</td><td>' + team + '</td><td class="muted">' + r.owner +
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
  // Win-% movement vs a baseline (both fractions). Up = win chance improved.
  function trendHTML(cur, base) {
    if (cur == null || base == null) return '<span class="muted">—</span>';
    var dpp = (cur - base) * 100;
    if (Math.abs(dpp) < 0.05) return '<span class="muted">–</span>';
    var up = dpp > 0;
    return '<span class="' + (up ? 'green' : 'red') + '">' + (up ? '▲' : '▼') + ' ' + Math.abs(dpp).toFixed(1) + '</span>';
  }

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

    var baseline = oddsBaseline();
    var t = el('table', { class: 'tbl' });
    t.innerHTML = '<thead><tr><th>#</th><th>Team</th><th>Owner</th><th class="r">Win %</th><th class="r">Trend</th></tr></thead>';
    var tb = el('tbody');
    top.forEach(function (r, i) {
      var tr = el('tr', i === 0 ? { class: 'leader' } : null);
      tr.innerHTML = '<td>' + (i + 1) + (i === 0 ? ' ★' : '') + '</td><td>' + WC.flagHTML(r.team) + r.team + '</td><td class="muted">' + r.owner +
        '</td><td class="r b gold">' + fmtPct(r.winnerProb) + '</td><td class="r">' + trendHTML(r.winnerProb, baseline ? baseline[r.team] : null) + '</td>';
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

  // Group-stage form (W/D/L) for a team, oldest game first, padded to three
  // boxes. Unplayed/in-progress games stay blank so boxes fill in as results
  // come in. Group games are identified by their derived "Group X" label.
  function teamForm(team, matches) {
    var games = (matches || []).filter(function (m) {
      return /group/i.test(m.group || '') && (m.home === team || m.away === team);
    }).sort(function (a, b) { return (a._ts || 0) - (b._ts || 0); }).slice(0, 3);
    var out = games.map(function (m) {
      if (m.status !== 'ft' || m.homeScore == null || m.awayScore == null) return null;
      var us = m.home === team ? m.homeScore : m.awayScore;
      var them = m.home === team ? m.awayScore : m.homeScore;
      return us > them ? 'W' : (us < them ? 'L' : 'D');
    });
    while (out.length < 3) out.push(null);
    return out;
  }
  function formHTML(form) {
    return '<span class="form">' + form.map(function (res) {
      var cls = res === 'W' ? 'w' : res === 'L' ? 'l' : res === 'D' ? 'd' : 'e';
      return '<span class="form-box form-' + cls + '">' + (res || '') + '</span>';
    }).join('') + '</span>';
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

    // Per-player breakdown of the six teams: group-stage form + win %.
    var matches = Live.get().matches || [];
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
      tt.innerHTML = '<thead><tr><th>Team</th><th>Form</th><th class="r">Win %</th></tr></thead>';
      var tbb = el('tbody');
      s.teams.forEach(function (tm) {
        var tr = el('tr');
        tr.innerHTML = '<td>' + WC.flagHTML(tm.team) + tm.team + '</td><td>' + formHTML(teamForm(tm.team, matches)) +
          '</td><td class="r muted">' + fmtPct(tm.prob) + '</td>';
        tbb.appendChild(tr);
      });
      tt.appendChild(tbb); det.appendChild(tt);
      breakdown.appendChild(det);
    });
    root.appendChild(breakdown);
    return root;
  }

  /* ---- TAB: Projections (Monte Carlo) ------------------------------------- */
  // Cache the (expensive) simulation; only recompute when the inputs change.
  var projCache = { sig: null, proj: null, bracket: null };
  var projRunId = 0;   // bumped by the Re-run button to force a fresh Monte Carlo
  function projectionData() {
    var st = Live.get();
    var sig = st.matches.filter(S.isFinished).length + '|' + (oddsState.updatedAt ? oddsState.updatedAt.getTime() : 0) + '|' + projRunId;
    if (projCache.sig !== sig) {
      projCache.sig = sig;
      projCache.proj = WC.Sim.project(st, oddsState.rows, 3000);
      projCache.bracket = WC.Sim.projectedBracket(st, oddsState.rows);
    }
    return projCache;
  }
  function rerunSim() { projRunId++; render(); }
  function pctSmall(f) { return (f * 100).toFixed(f < 0.0995 ? 1 : 0) + '%'; }

  // Shared Projected Returns panel (used on the dashboard and Projections tab).
  function projectedReturnsPanel() {
    var panel = el('div', { class: 'panel' });
    var rerun = el('button', { class: 'btn small', type: 'button', style: 'float:right', onclick: rerunSim }, ['↻ Re-run']);
    panel.appendChild(el('h2', null, ['Projected Returns ', el('span', { class: 'sub' }, ['Monte Carlo · winner & runner-up']), rerun]));
    if (oddsState.status !== 'ok') {
      panel.appendChild(el('p', { class: 'empty' }, [oddsState.status === 'loading' ? 'Loading odds…' : 'Needs betting odds — see the Winner Odds tab.']));
      return panel;
    }
    var data = projectionData();
    if (!data.proj) { panel.appendChild(el('p', { class: 'empty' }, ['Not enough data to model yet.'])); return panel; }
    var t = el('table', { class: 'tbl' });
    t.innerHTML = '<thead><tr><th>#</th><th>Player</th><th class="r">Win £80</th><th class="r">RU £20</th><th class="r">Exp £</th></tr></thead>';
    var tb = el('tbody');
    data.proj.players.forEach(function (p, i) {
      var tr = el('tr', i === 0 ? { class: 'leader' } : null);
      tr.innerHTML = '<td>' + (i + 1) + (i === 0 ? ' ★' : '') + '</td><td class="b">' + p.player +
        '</td><td class="r muted">' + pctSmall(p.pWin) + '</td><td class="r muted">' + pctSmall(p.pRunner) +
        '</td><td class="r b gold">£' + p.exp.toFixed(1) + '</td>';
      tb.appendChild(tr);
    });
    t.appendChild(tb); panel.appendChild(t);
    panel.appendChild(el('p', { class: 'muted small', style: 'margin:10px 2px 0' }, ['Elo from the bookmaker win % nudged by results; the remaining tournament is simulated to a winner & runner-up. Exp £ = P(win)×£80 + P(runner-up)×£20 · ' + data.proj.n.toLocaleString() + ' sims.']));
    return panel;
  }

  function koMatchEl(m) {
    var loser = m.pick === m.a ? m.b : m.a;
    var score = m.pick === m.a ? (m.score[0] + '–' + m.score[1]) : (m.score[1] + '–' + m.score[0]);
    return el('div', { class: 'ko-match' }, [
      el('span', { class: 'ko-team win' }, [flagEl(m.pick), m.pick]),
      el('span', { class: 'ko-score' }, [score + (m.pens ? ' p' : '')]),
      el('span', { class: 'ko-team muted' }, [flagEl(loser), loser]),
      el('span', { class: 'ko-pct muted' }, [Math.round(m.winPct * 100) + '%'])
    ]);
  }

  function renderProjections() {
    var root = el('div');
    if (oddsState.status !== 'ok') {
      var np = el('div', { class: 'panel' });
      np.appendChild(el('h2', null, ['Projections']));
      np.appendChild(el('p', { class: 'empty' }, [oddsState.status === 'loading'
        ? 'Loading odds…' : 'Odds are needed to model the tournament — see the Winner Odds tab.']));
      root.appendChild(np); return root;
    }
    var data = projectionData();
    if (!data.proj) {
      var ep = el('div', { class: 'panel' });
      ep.appendChild(el('h2', null, ['Projections']));
      ep.appendChild(el('p', { class: 'empty' }, ['Not enough data to model yet — waiting on odds and the group fixtures.']));
      root.appendChild(ep); return root;
    }

    // Projected returns per player (shared with the dashboard)
    root.appendChild(projectedReturnsPanel());

    // Title odds per team (model)
    var cp = el('div', { class: 'panel' });
    cp.appendChild(el('h2', null, ['Title Odds ', el('span', { class: 'sub' }, ['model champion / runner-up'])]));
    var ct = el('table', { class: 'tbl' });
    ct.innerHTML = '<thead><tr><th>Team</th><th>Owner</th><th class="r">Champion</th><th class="r">Runner-up</th></tr></thead>';
    var ctb = el('tbody');
    data.proj.teams.filter(function (x) { return x.champ >= 0.005; }).slice(0, 12).forEach(function (x, i) {
      var tr = el('tr', i === 0 ? { class: 'leader' } : null);
      tr.innerHTML = '<td>' + WC.flagHTML(x.team) + x.team + '</td><td class="muted">' + x.owner +
        '</td><td class="r b gold">' + pctSmall(x.champ) + '</td><td class="r muted">' + pctSmall(x.ru) + '</td>';
      ctb.appendChild(tr);
    });
    ct.appendChild(ctb); cp.appendChild(ct); root.appendChild(cp);

    // Knockout predictor — projected bracket
    if (data.bracket) {
      var kp = el('div', { class: 'panel' });
      kp.appendChild(el('h2', null, ['Knockout Predictor ', el('span', { class: 'sub' }, ['projected bracket'])]));
      kp.appendChild(el('p', { class: 'muted small', style: 'margin:0 2px 12px' }, ['Most-likely qualifiers, seeded by rating, with each tie’s modelled result (p = decided on penalties). Firms up as group results land.']));
      data.bracket.rounds.forEach(function (rnd) {
        var det = el('details', rnd.matches.length <= 8 ? { open: 'open' } : null);
        det.appendChild(el('summary', null, [el('b', null, [rnd.name]),
          el('span', { class: 'muted small' }, ['  ' + rnd.matches.length + (rnd.matches.length === 1 ? ' tie' : ' ties')])]));
        var list = el('div', { class: 'ko-round' });
        rnd.matches.forEach(function (m) { list.appendChild(koMatchEl(m)); });
        det.appendChild(list); kp.appendChild(det);
      });
      kp.appendChild(el('div', { class: 'ko-champ' }, ['🏆 Projected winner: ', flagEl(data.bracket.champion), el('b', null, [data.bracket.champion])]));
      root.appendChild(kp);
    }
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

    // Golden Boot — top 5 scorers with 2+ goals; if players are level at the
    // cut-off, show everyone tied (never split a tie). One-goal players are
    // hidden.
    var gb = WC.Stats.goldenBoot(st);
    var top = gb.filter(function (r) { return r.goals >= 2; });
    if (top.length > 5) { var cut = top[4].goals; top = top.filter(function (r) { return r.goals >= cut; }); }
    var gbPanel = el('div', { class: 'panel' });
    gbPanel.appendChild(el('h2', null, ['Golden Boot ', el('span', { class: 'sub' }, ['2+ goals'])]));
    if (!top.length) {
      gbPanel.appendChild(el('p', { class: 'empty' }, [st.detailLoading ? 'Loading scorers from ESPN…'
        : (gb.length ? 'No player has scored twice yet.' : 'No goals recorded yet.')]));
    } else {
      var t = el('table', { class: 'tbl scorers' });
      t.innerHTML = '<thead><tr><th>#</th><th>Player</th><th>Team</th><th>Owner</th><th class="r">Goals</th><th class="r">Pens</th></tr></thead>';
      var tb = el('tbody');
      top.forEach(function (r, i) {
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

    // Row 1: centred team names + score. Row 2: owners (left) + group (right).
    var teamLine = el('div', { class: 'mr-teams' }, [
      flagEl(m.home), el('b', null, [m.home || '?']), ' ',
      el('span', { class: 'mr-score ' + (fin ? 'fin' : (live ? 'livescore' : 'sched')) }, [score]), ' ',
      el('b', null, [m.away || '?']), flagEl(m.away, 'flag-r')
    ]);
    var metaLine = el('div', { class: 'mr-meta muted' }, [
      el('span', null, [WC.ownerOf(m.home) + ' v ' + WC.ownerOf(m.away)]),
      (m.group ? el('span', { class: 'mr-group' }, [m.group]) : null)
    ]);
    var head = el('div', { class: 'match-head' }, [teamLine, metaLine]);

    // Row 3 (only when there's something to show): live clock / card count, plus
    // the expand chevron on the right.
    var cardCount = (m.cards || []).length;
    var footBits = [];
    if (live) footBits.push(el('span', { class: 'mr-live' }, [el('span', { class: 'live-dot' }), m.clock || m.statusDetail || 'LIVE']));
    if (cardCount) footBits.push(el('span', { class: 'mr-cards' }, [cardCount + ' card' + (cardCount === 1 ? '' : 's')]));
    if (footBits.length || fin || live) {
      var foot = el('div', { class: 'mr-foot' }, footBits);
      if (fin || live) foot.appendChild(el('span', { class: 'chevron' }, ['▾']));
      head.appendChild(foot);
    }

    var matchEl = el('div', { class: 'match ' + (fin ? 'is-ft' : (live ? 'is-live' : 'is-sched')) }, [head]);

    // Pre-match win-probability predictor on upcoming games (if ESPN provides it).
    if (!fin && !live && m.predictor && (m.predictor.home != null || m.predictor.away != null)) {
      matchEl.appendChild(predictorBar(m));
    }

    // Finished and in-play matches expand to show goalscorers and cards.
    if (fin || live) {
      matchEl.classList.add('expandable');
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
  function standingsPanel(label, rows, status) {
    status = status || {};
    var panel = el('div', { class: 'panel' });
    var anyLive = rows.some(function (r) { return r.live; });
    panel.appendChild(el('h2', null, [label, anyLive ? el('span', { class: 'sub' }, ['live — provisional']) : null]));
    var t = el('table', { class: 'tbl standings' });
    t.innerHTML = '<thead><tr><th>#</th><th>Team</th><th>Owner</th><th class="r">P</th><th class="r">W</th><th class="r">D</th><th class="r">L</th><th class="r">GF</th><th class="r">GA</th><th class="r">GD</th><th class="r">Pts</th></tr></thead>';
    var tb = el('tbody');
    rows.forEach(function (r) {
      var gd = (r.GD > 0 ? '+' : '') + r.GD;
      var s = status[r.team];
      var tr = el('tr', { class: (r.live ? 'liverow ' : '') + (s === 'eliminated' ? 'q-out' : (s === 'through' ? 'q-through' : '')) });
      var posCls = r.pos <= 2 ? 'qz-top' : (r.pos === 3 ? 'qz-third' : '');
      var badge = s === 'through' ? ' <span class="qbadge q-ok">✓</span>' : (s === 'eliminated' ? ' <span class="qbadge q-no">✗</span>' : '');
      var team = WC.flagHTML(r.team) + (r.live ? '<span class="live-dot"></span>' : '') + r.team + badge;
      tr.innerHTML = '<td class="' + posCls + '">' + r.pos + '</td><td>' + team + '</td><td class="muted">' + r.owner + '</td><td class="r">' + r.P + '</td><td class="r">' + r.W + '</td><td class="r">' + r.D + '</td><td class="r">' + r.L + '</td><td class="r">' + r.GF + '</td><td class="r">' + r.GA + '</td><td class="r">' + gd + '</td><td class="r b">' + r.Pts + '</td>';
      tb.appendChild(tr);
    });
    t.appendChild(tb); panel.appendChild(t);
    return panel;
  }

  // The best-8 third-placed race across all groups.
  function thirdPlacePanel(race) {
    var panel = el('div', { class: 'panel' });
    panel.appendChild(el('h2', null, ['Third-Place Race ', el('span', { class: 'sub' }, ['best 8 of 12 reach the Round of 32'])]));
    var t = el('table', { class: 'tbl' });
    t.innerHTML = '<thead><tr><th>#</th><th>Grp</th><th>Team</th><th>Owner</th><th class="r">P</th><th class="r">GD</th><th class="r">Pts</th></tr></thead>';
    var tb = el('tbody');
    race.forEach(function (r, i) {
      var tr = el('tr', { class: r.qualifying ? 'q-in-row' : 'q-out-row' });
      var gd = (r.GD > 0 ? '+' : '') + r.GD;
      var grp = (r.group || '').replace('Group ', '');
      tr.innerHTML = '<td>' + (i + 1) + '</td><td class="muted">' + grp + '</td><td>' + WC.flagHTML(r.team) + r.team +
        (r.settled ? '' : ' <span class="muted" style="font-size:10px">prov</span>') + '</td><td class="muted">' + r.owner +
        '</td><td class="r">' + r.P + '</td><td class="r">' + gd + '</td><td class="r b gold">' + r.Pts + '</td>';
      tb.appendChild(tr);
      if (i === 7) tb.appendChild(el('tr', { class: 'q-cut', html: '<td colspan="7">— qualification cut-off —</td>' }));
    });
    t.appendChild(tb); panel.appendChild(t);
    panel.appendChild(el('p', { class: 'muted small', style: 'margin:10px 2px 0' }, ['The eight best third-placed teams join the group winners and runners-up in the Round of 32. Positions are provisional (“prov”) until each group finishes.']));
    return panel;
  }

  function renderStandings() {
    var st = Live.get();
    if (st.loading) { var r0 = el('div'); r0.appendChild(loadingBlock('Loading standings…')); return r0; }
    var groups = S.groupTables(st);
    var status = S.groupStatus(st);
    var keys = Object.keys(groups).sort();
    var root = el('div');
    if (!keys.length) { root.appendChild(el('p', { class: 'empty big' }, ['No standings yet.'])); return root; }

    // ESPN doesn't expose group labels on this feed, so everything lands in one
    // table — present it full-width as the Overall Table. If real groups ever
    // appear, lay them out in the grid.
    if (keys.length === 1) {
      var label = keys[0] === 'Unassigned' ? 'Overall Table' : keys[0];
      root.appendChild(standingsPanel(label, groups[keys[0]], status));
      return root;
    }
    var grid = el('div', { class: 'group-grid' });
    keys.forEach(function (g) { grid.appendChild(standingsPanel(g === 'Unassigned' ? 'Overall Table' : g, groups[g], status)); });
    root.appendChild(grid);

    var race = S.thirdPlaceRace(st);
    if (race.length) root.appendChild(thirdPlacePanel(race));
    return root;
  }

  /* ---- TAB: Bracket (indicative, from current tables) --------------------- */
  function bracketMatchEl(m, showFrom) {
    function teamSpan(o, win) {
      var kids = [flagEl(o.team), o.team];
      if (showFrom && o.from) kids.push(el('span', { class: 'ko-from' }, [' ' + o.from]));
      return el('span', { class: 'ko-team' + (win ? ' win' : ' muted') }, kids);
    }
    if (m.bye) return el('div', { class: 'ko-match' }, [teamSpan(m.pick, true), el('span', { class: 'muted small' }, ['bye'])]);
    var loser = m.pick === m.a ? m.b : m.a;
    var score = m.pick === m.a ? (m.score[0] + '–' + m.score[1]) : (m.score[1] + '–' + m.score[0]);
    return el('div', { class: 'ko-match' }, [
      teamSpan(m.pick, true),
      el('span', { class: 'ko-score' }, [score + (m.pens ? ' p' : '')]),
      teamSpan(loser, false),
      el('span', { class: 'ko-pct muted' }, [Math.round(m.winPct * 100) + '%'])
    ]);
  }

  function renderBracket() {
    var root = el('div', { class: 'projections' });
    if (oddsState.status !== 'ok') {
      var np = el('div', { class: 'panel' });
      np.appendChild(el('h2', null, ['Knockout Bracket']));
      np.appendChild(el('p', { class: 'empty' }, [oddsState.status === 'loading' ? 'Loading odds…' : 'Needs betting odds for the predictions — see the Winner Odds tab.']));
      root.appendChild(np); return root;
    }
    var br = WC.Sim.currentBracket(Live.get(), oddsState.rows);
    var panel = el('div', { class: 'panel' });
    panel.appendChild(el('h2', null, ['Knockout Bracket ', el('span', { class: 'sub' }, ['indicative — from the current tables'])]));
    if (!br) { panel.appendChild(el('p', { class: 'empty' }, ['Waiting on the group fixtures and odds.'])); root.appendChild(panel); return root; }
    panel.appendChild(el('p', { class: 'muted small', style: 'margin:0 2px 12px' }, ['Built from the live group tables — current winners, runners-up and the best-8 third-placed teams, seeded by record, with each tie’s modelled result (p = penalties). The official Round-of-32 draw is only set once the group stage ends; this updates as results come in.']));
    br.rounds.forEach(function (rnd, idx) {
      var det = el('details', rnd.matches.length <= 8 ? { open: 'open' } : null);
      det.appendChild(el('summary', null, [el('b', null, [rnd.name]),
        el('span', { class: 'muted small' }, ['  ' + rnd.matches.length + (rnd.matches.length === 1 ? ' tie' : ' ties')])]));
      var list = el('div', { class: 'ko-round' });
      rnd.matches.forEach(function (m) { list.appendChild(bracketMatchEl(m, idx === 0)); });
      det.appendChild(list); panel.appendChild(det);
    });
    if (br.champion) panel.appendChild(el('div', { class: 'ko-champ' }, ['🏆 Projected winner: ', flagEl(br.champion.team), el('b', null, [br.champion.team])]));
    root.appendChild(panel);
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

  // Win-% movement (the Trend column) compares today's odds to an earlier day.
  // The source of truth is a CENTRAL daily history committed to the repo by a
  // GitHub Action (data/odds-history.json) — same for everyone, no historical
  // odds API needed. A per-browser localStorage snapshot is kept only as a
  // fallback for before the central file has data. { 'YYYY-MM-DD': { team: winProb } }
  var oddsHistory = null;   // central history, null until fetched
  function loadOddsHistory() {
    fetch('data/odds-history.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (h) { oddsHistory = h || {}; if (oddsState.status === 'ok') render(); })
      ['catch'](function () { oddsHistory = oddsHistory || {}; });
  }

  var SNAP_KEY = 'wc26-odds-snap-v1';
  function loadSnaps() { try { return JSON.parse(localStorage.getItem(SNAP_KEY)) || {}; } catch (e) { return {}; } }
  function snapshotOdds(rows) {
    var day = {};
    rows.forEach(function (r) { if (r.winnerProb != null) day[r.team] = r.winnerProb; });
    if (!Object.keys(day).length) return;
    var snaps = loadSnaps();
    snaps[WC.ESPN.londonDay()] = day;
    Object.keys(snaps).sort().slice(0, -30).forEach(function (d) { delete snaps[d]; }); // keep last 30 days
    try { localStorage.setItem(SNAP_KEY, JSON.stringify(snaps)); } catch (e) {}
  }
  // Baseline = most recent snapshot from a UK day before today; prefer the
  // central history, fall back to this browser's own snapshots.
  function oddsBaseline() {
    var today = WC.ESPN.londonDay();
    function priorFrom(snaps) {
      if (!snaps) return null;
      var prior = Object.keys(snaps).filter(function (d) { return d < today; }).sort();
      return prior.length ? snaps[prior[prior.length - 1]] : null;
    }
    return priorFrom(oddsHistory) || priorFrom(loadSnaps());
  }

  function loadOdds() {
    var cfg = WC.Odds.getConfig();
    if (!cfg.apiKey) { oddsState.status = 'nokey'; render(); return; }
    oddsState.status = 'loading'; render();
    WC.Odds.fetchAll().then(function (res) {
      oddsState.rows = res.rows; oddsState.updatedAt = res.updatedAt; oddsState.status = 'ok';
      snapshotOdds(res.rows);
      render();
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

    var baseline = oddsBaseline();
    var panel = el('div', { class: 'panel' });
    panel.appendChild(el('h2', null, ['All Teams · Outright Odds ',
      el('span', { class: 'sub' }, [oddsState.updatedAt ? 'updated ' + oddsState.updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''])]));
    var t = el('table', { class: 'tbl' });
    t.innerHTML = '<thead><tr><th>#</th><th>Team</th><th>Owner</th><th class="r">Win %</th><th class="r">Trend</th></tr></thead>';
    var tb = el('tbody');
    rows.forEach(function (r, i) {
      var tr = el('tr');
      tr.innerHTML = '<td>' + (i + 1) + '</td><td>' + WC.flagHTML(r.team) + r.team + '</td><td class="muted">' + r.owner +
        '</td><td class="r b gold">' + fmtPct(r.winnerProb) + '</td><td class="r">' + trendHTML(r.winnerProb, baseline ? baseline[r.team] : null) + '</td>';
      tb.appendChild(tr);
    });
    t.appendChild(tb); panel.appendChild(t);
    panel.appendChild(el('p', { class: 'muted small', style: 'margin:10px 2px 0' }, ['Trend is the change in win % (percentage points) since the previous day’s odds — it appears once a day’s snapshot exists to compare against.']));
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
    ['bracket', 'Bracket', renderBracket],
    ['odds', 'Winner Odds', renderOdds],
    ['projections', 'Projections', renderProjections],
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
    loadOddsHistory(); // central win-% history for the Trend column
    loadOdds(); // fetch odds if a key is already configured (else flags 'nokey')
  }

  document.addEventListener('DOMContentLoaded', init);

})(window.WC = window.WC || {});
