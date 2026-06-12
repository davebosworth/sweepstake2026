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
    var grid = el('div', { class: 'grid' });
    grid.appendChild(statCard('Matches played', finished));
    grid.appendChild(statCard('Teams in action', played + ' / 48'));
    grid.appendChild(statCard('Disciplinary leader', disc.length ? disc[0].team + ' · ' + disc[0].owner : '—'));
    grid.appendChild(statCard('Wooden spoon', worst.length ? worst[0].team + ' · ' + worst[0].owner : '—'));
    root.appendChild(grid);

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
    var score = fin ? (m.homeScore + ' – ' + m.awayScore) : (m.kickoff || '—');
    var main = [
      el('span', { class: 'tag' }, [m.group || '—']),
      el('span', { class: 'mr-teams' }, [
        el('b', null, [m.home || '?']), ' ',
        el('span', { class: 'mr-score ' + (fin ? 'fin' : 'sched') }, [score]), ' ',
        el('b', null, [m.away || '?'])
      ]),
      el('span', { class: 'mr-owners muted' }, [WC.ownerOf(m.home) + ' v ' + WC.ownerOf(m.away)])
    ];
    var cardCount = (m.cards || []).length;
    if (cardCount) main.push(el('span', { class: 'mr-cards' }, [cardCount + ' card' + (cardCount === 1 ? '' : 's')]));
    return el('div', { class: 'match ' + (fin ? 'is-ft' : 'is-sched') }, [el('div', { class: 'match-main' }, main)]);
  }

  /* ---- TAB: Standings ----------------------------------------------------- */
  function renderStandings() {
    var st = Live.get();
    if (st.loading) { var r0 = el('div'); r0.appendChild(loadingBlock('Loading standings…')); return r0; }
    var groups = S.groupTables(st);
    var keys = Object.keys(groups).sort();
    var root = el('div');
    if (!keys.length) { root.appendChild(el('p', { class: 'empty big' }, ['No group data yet.'])); return root; }
    var grid = el('div', { class: 'group-grid' });
    keys.forEach(function (g) {
      var panel = el('div', { class: 'panel' });
      panel.appendChild(el('h2', null, [g]));
      var t = el('table', { class: 'tbl' });
      t.innerHTML = '<thead><tr><th>#</th><th>Team</th><th>Owner</th><th class="r">P</th><th class="r">W</th><th class="r">D</th><th class="r">L</th><th class="r">GF</th><th class="r">GA</th><th class="r">GD</th><th class="r">Pts</th></tr></thead>';
      var tb = el('tbody');
      groups[g].forEach(function (r) {
        var gd = (r.GD > 0 ? '+' : '') + r.GD;
        var tr = el('tr');
        tr.innerHTML = '<td>' + r.pos + '</td><td>' + r.team + '</td><td class="muted">' + r.owner + '</td><td class="r">' + r.P + '</td><td class="r">' + r.W + '</td><td class="r">' + r.D + '</td><td class="r">' + r.L + '</td><td class="r">' + r.GF + '</td><td class="r">' + r.GA + '</td><td class="r">' + gd + '</td><td class="r b">' + r.Pts + '</td>';
        tb.appendChild(tr);
      });
      t.appendChild(tb); panel.appendChild(t);
      grid.appendChild(panel);
    });
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

  /* ---- header status ------------------------------------------------------ */
  function renderStatus() {
    var st = Live.get();
    var box = $('#status');
    box.className = 'status';
    if (st.loading) { box.classList.add('busy'); box.innerHTML = '<span class="dot"></span>Loading live data from ESPN…'; return; }
    if (st.error) { box.classList.add('err'); box.innerHTML = '<span class="dot"></span>Couldn’t reach ESPN — <a id="reload">reload</a>'; wireReload(); return; }
    var t = st.updatedAt ? st.updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
    box.classList.add('ok');
    box.innerHTML = '<span class="dot"></span>Live from ESPN' + (st.detailLoading ? ' · loading details…' : ' · updated ' + t) + ' — <a id="reload">reload</a>';
    wireReload();
  }
  function wireReload() { var a = $('#reload'); if (a) a.addEventListener('click', function () { location.reload(); }); }

  /* ---- top-level render --------------------------------------------------- */
  var TABS = [
    ['dashboard', 'Dashboard', renderDashboard],
    ['fixtures', 'Fixtures & Results', renderFixtures],
    ['standings', 'Standings', renderStandings],
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
  }

  document.addEventListener('DOMContentLoaded', init);

})(window.WC = window.WC || {});
