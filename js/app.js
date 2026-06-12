/* ============================================================================
 * app.js — UI controller: tabs, tables, the match editor and the report tab.
 * Vanilla JS, no build step. Talks to WC.Store / WC.Standings / WC.Report.
 * ========================================================================== */
(function (WC) {
  'use strict';

  var Store = WC.Store, S = WC.Standings, R = WC.Report;
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
  var draft = null; // match being edited in the modal

  /* ---- option list for team selects --------------------------------------- */
  function teamOptions(selected) {
    var opts = '<option value="">— team —</option>';
    WC.TEAMS.forEach(function (t) {
      opts += '<option value="' + t + '"' + (t === selected ? ' selected' : '') + '>' + t + ' (' + WC.ownerOf(t) + ')</option>';
    });
    return opts;
  }

  /* ---- TAB: Dashboard ----------------------------------------------------- */
  function renderDashboard() {
    var st = Store.get();
    var disc = S.disciplinary(st);
    var worst = S.worstTeams(st);
    var teams = S.computeTeams(st);
    var played = Object.keys(teams).filter(function (k) { return teams[k].played; }).length;
    var finished = st.matches.filter(S.isFinished).length;

    var wrap = el('div', { class: 'grid' });

    wrap.appendChild(statCard('Matches played', finished));
    wrap.appendChild(statCard('Teams in action', played + ' / 48'));
    wrap.appendChild(statCard('Disciplinary leader', disc.length ? disc[0].team + ' · ' + disc[0].owner : '—'));
    wrap.appendChild(statCard('Wooden spoon', worst.length ? worst[0].team + ' · ' + worst[0].owner : '—'));

    var col = el('div', { class: 'two-col' });

    // Disciplinary
    var dWrap = el('div', { class: 'panel' });
    dWrap.appendChild(el('h2', null, ['Disciplinary Prize ', el('span', { class: 'sub' }, ['Red = 3 · Yellow = 1 · most wins'])]));
    if (!disc.length) dWrap.appendChild(el('p', { class: 'empty' }, ['No cards recorded yet.']));
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

    // Worst teams
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

    var root = el('div');
    root.appendChild(wrap);
    root.appendChild(col);
    return root;
  }

  function statCard(label, value) {
    return el('div', { class: 'stat' }, [
      el('div', { class: 'stat-v' }, [String(value)]),
      el('div', { class: 'stat-l' }, [label])
    ]);
  }

  /* ---- TAB: Fixtures & Results -------------------------------------------- */
  function renderFixtures() {
    var st = Store.get();
    var root = el('div');

    var bar = el('div', { class: 'rowbar' }, [
      el('button', { class: 'btn primary', onclick: function () { openModal(null); } }, ['+ Add match']),
      el('button', { class: 'btn', onclick: openSync }, ['⟳ Sync from ESPN']),
      el('span', { class: 'count' }, [st.matches.length + ' match' + (st.matches.length === 1 ? '' : 'es')])
    ]);
    root.appendChild(bar);

    if (!st.matches.length) {
      root.appendChild(el('p', { class: 'empty big' }, ['No matches yet. Add fixtures and results to power the tables and the Morning Report.']));
      return root;
    }

    // Group by date (desc by default newest first? use ascending by date then kickoff)
    var byDate = {};
    st.matches.forEach(function (m) { (byDate[m.date || 'Undated'] = byDate[m.date || 'Undated'] || []).push(m); });
    Object.keys(byDate).sort().forEach(function (date) {
      root.appendChild(el('h3', { class: 'date-head' }, [date === 'Undated' ? 'Undated' : prettyDate(date)]));
      var list = byDate[date].sort(function (a, b) { return (a.kickoff || '').localeCompare(b.kickoff || ''); });
      list.forEach(function (m) { root.appendChild(matchRow(m)); });
    });
    return root;
  }

  function matchRow(m) {
    var fin = S.isFinished(m);
    var score = fin ? (m.homeScore + ' – ' + m.awayScore) : (m.kickoff || '—');
    var meta = [
      el('span', { class: 'tag' }, [m.group || 'No group']),
      el('span', { class: 'mr-teams' }, [
        el('b', null, [m.home || '?']), ' ',
        el('span', { class: 'mr-score ' + (fin ? 'fin' : 'sched') }, [score]), ' ',
        el('b', null, [m.away || '?'])
      ]),
      el('span', { class: 'mr-owners muted' }, [WC.ownerOf(m.home) + ' v ' + WC.ownerOf(m.away)])
    ];
    var cardCount = (m.cards || []).length;
    if (cardCount) meta.push(el('span', { class: 'mr-cards' }, [cardCount + ' card' + (cardCount === 1 ? '' : 's')]));

    return el('div', { class: 'match ' + (fin ? 'is-ft' : 'is-sched') }, [
      el('div', { class: 'match-main' }, meta),
      el('div', { class: 'match-act' }, [
        el('button', { class: 'btn small', onclick: function () { openModal(m.id); } }, ['Edit']),
        el('button', { class: 'btn small danger', onclick: function () { if (confirm('Delete this match?')) Store.deleteMatch(m.id); } }, ['Delete'])
      ])
    ]);
  }

  /* ---- Match editor modal ------------------------------------------------- */
  function openModal(id) {
    var m = id ? JSON.parse(JSON.stringify(Store.getMatch(id))) : {
      id: '', date: Store.get().startDate, kickoff: '', group: '', home: '', away: '',
      status: 'scheduled', homeScore: null, awayScore: null, scorers: [], cards: []
    };
    draft = m;
    renderModal();
    $('#modal').classList.add('open');
  }
  function closeModal() { draft = null; $('#modal').classList.remove('open'); }

  function renderModal() {
    var m = draft;
    var body = $('#modal-body');
    body.innerHTML = '';

    body.appendChild(field('Group / stage', input('text', m.group, 'group', 'e.g. Group A')));
    var dk = el('div', { class: 'row2' }, [
      field('Date', input('date', m.date, 'date')),
      field('Kick-off (UK)', input('time', m.kickoff, 'kickoff'))
    ]);
    body.appendChild(dk);

    var teams = el('div', { class: 'row2' }, [
      field('Home team', select(m.home, 'home')),
      field('Away team', select(m.away, 'away'))
    ]);
    body.appendChild(teams);

    var status = el('div', { class: 'row2' }, [
      field('Status', selectStatus(m.status)),
      field('Score (H – A)', scoreRow(m))
    ]);
    body.appendChild(status);

    // Scorers
    body.appendChild(listEditor('Goalscorers', m.scorers, 'scorers', function (s, i) {
      return el('div', { class: 'le-row' }, [
        sideSelect(s.team, function (v) { s.team = v; }),
        input2('text', s.name, 'Scorer e.g. Kane 23\'', function (v) { s.name = v; }),
        removeBtn(function () { m.scorers.splice(i, 1); renderModal(); })
      ]);
    }, function () { m.scorers.push({ team: 'home', name: '' }); renderModal(); }));

    // Cards
    body.appendChild(listEditor('Cards', m.cards, 'cards', function (c, i) {
      return el('div', { class: 'le-row' }, [
        sideSelect(c.team, function (v) { c.team = v; }),
        input2('text', c.player, 'Player', function (v) { c.player = v; }),
        cardTypeSelect(c.type, function (v) { c.type = v; }),
        removeBtn(function () { m.cards.splice(i, 1); renderModal(); })
      ]);
    }, function () { m.cards.push({ team: 'home', player: '', type: 'yellow' }); renderModal(); }));

    $('#modal-title').textContent = m.id ? 'Edit match' : 'Add match';
  }

  // --- modal field helpers ---
  function field(label, control) { return el('label', { class: 'fld' }, [el('span', null, [label]), control]); }
  function input(type, val, key, ph) {
    var i = el('input', { type: type, value: val == null ? '' : val });
    if (ph) i.placeholder = ph;
    i.addEventListener('input', function () { draft[key] = i.value; });
    return i;
  }
  function input2(type, val, ph, onset) {
    var i = el('input', { type: type, value: val == null ? '' : val, placeholder: ph || '' });
    i.addEventListener('input', function () { onset(i.value); });
    return i;
  }
  // Like input2 but commits on change/blur — used for settings that trigger a
  // full re-render, so typing doesn't lose focus mid-keystroke.
  function input3(type, val, ph, onset) {
    var i = el('input', { type: type, value: val == null ? '' : val, placeholder: ph || '' });
    i.addEventListener('change', function () { onset(i.value); });
    return i;
  }
  function select(val, key) {
    var s = el('select', { html: teamOptions(val) });
    s.addEventListener('change', function () { draft[key] = s.value; });
    return s;
  }
  function selectStatus(val) {
    var s = el('select', { html: '<option value="scheduled"' + (val === 'scheduled' ? ' selected' : '') + '>Scheduled</option>' +
      '<option value="ft"' + (val === 'ft' ? ' selected' : '') + '>Full time</option>' });
    s.addEventListener('change', function () { draft.status = s.value; });
    return s;
  }
  function scoreRow(m) {
    var h = el('input', { type: 'number', min: '0', class: 'score', value: m.homeScore == null ? '' : m.homeScore });
    var a = el('input', { type: 'number', min: '0', class: 'score', value: m.awayScore == null ? '' : m.awayScore });
    h.addEventListener('input', function () { draft.homeScore = h.value === '' ? null : parseInt(h.value, 10); });
    a.addEventListener('input', function () { draft.awayScore = a.value === '' ? null : parseInt(a.value, 10); });
    return el('div', { class: 'score-row' }, [h, el('span', null, ['–']), a]);
  }
  function sideSelect(val, onset) {
    var s = el('select', { class: 'side', html: '<option value="home"' + (val === 'home' ? ' selected' : '') + '>Home</option>' +
      '<option value="away"' + (val === 'away' ? ' selected' : '') + '>Away</option>' });
    s.addEventListener('change', function () { onset(s.value); });
    return s;
  }
  function cardTypeSelect(val, onset) {
    var s = el('select', { class: 'side', html: '<option value="yellow"' + (val === 'yellow' ? ' selected' : '') + '>Yellow</option>' +
      '<option value="red"' + (val === 'red' ? ' selected' : '') + '>Red</option>' });
    s.addEventListener('change', function () { onset(s.value); });
    return s;
  }
  function removeBtn(fn) { return el('button', { class: 'btn small danger', onclick: fn }, ['✕']); }
  function listEditor(label, items, key, rowFn, addFn) {
    var box = el('div', { class: 'le' }, [el('div', { class: 'le-head' }, [el('span', null, [label]), el('button', { class: 'btn small', onclick: addFn }, ['+ Add'])])]);
    (items || []).forEach(function (it, i) { box.appendChild(rowFn(it, i)); });
    return box;
  }

  function saveDraft() {
    var m = draft;
    if (!m.home || !m.away) { alert('Pick both teams.'); return; }
    if (m.status === 'ft' && (m.homeScore == null || m.awayScore == null)) { alert('Enter the score for a full-time match.'); return; }
    Store.upsertMatch(m);
    closeModal();
  }

  /* ---- ESPN sync ---------------------------------------------------------- */
  function dateRange(fromISO, toISO) {
    var out = [], d = new Date(fromISO + 'T00:00:00'), end = new Date(toISO + 'T00:00:00');
    if (isNaN(d) || isNaN(end) || end < d) return [fromISO];
    var guard = 0;
    while (d <= end && guard++ < 60) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
    return out;
  }

  // Pair a fetched match to an existing one by date + the unordered team set.
  function findExisting(fetched) {
    var key = fetched.date + '|' + [fetched.home, fetched.away].sort().join('|');
    return Store.get().matches.filter(function (m) {
      return (m.date + '|' + [m.home, m.away].sort().join('|')) === key;
    })[0] || null;
  }

  // Build the match object to save, merging a fetch onto any existing record.
  function mergeFetched(fetched, existing) {
    var m = existing ? JSON.parse(JSON.stringify(existing)) : { id: '' };
    m.date = fetched.date; m.kickoff = fetched.kickoff || m.kickoff || '';
    m.group = fetched.group || (m.group || '');
    m.home = fetched.home; m.away = fetched.away;
    m.status = fetched.status; m.homeScore = fetched.homeScore; m.awayScore = fetched.awayScore;
    // Only overwrite scorers/cards when the fetch actually carried detail,
    // so a failed/partial summary never wipes manual entries.
    if (fetched.scorers && fetched.scorers.length) m.scorers = fetched.scorers;
    else m.scorers = m.scorers || [];
    if (fetched.cards && fetched.cards.length) m.cards = fetched.cards;
    else m.cards = m.cards || [];
    return m;
  }

  function syncStatus(fetched) {
    if (!fetched.home || !fetched.away) return 'unmapped';
    var ex = findExisting(fetched);
    if (!ex) return 'new';
    if (ex.status === fetched.status && ex.homeScore === fetched.homeScore && ex.awayScore === fetched.awayScore) return 'same';
    return 'update';
  }

  function openSync() {
    var existing = $('#sync-modal');
    if (existing) existing.remove();

    var today = todayISO();
    var from = el('input', { type: 'date', value: shiftISO(today, -1) });
    var to = el('input', { type: 'date', value: today });
    var details = el('input', { type: 'checkbox' }); details.checked = true;
    var resultBox = el('div', { class: 'sync-results' });
    var statusLine = el('div', { class: 'sync-status muted' }, ['Pick a date range and fetch from ESPN.']);
    var fetchedRows = [];

    function doFetch() {
      statusLine.className = 'sync-status muted';
      statusLine.textContent = 'Fetching from ESPN…';
      resultBox.innerHTML = '';
      var dates = dateRange(from.value, to.value);
      WC.ESPN.sync(dates, details.checked).then(function (matches) {
        fetchedRows = matches;
        renderResults();
      }).catch(function (err) {
        statusLine.className = 'sync-status red';
        statusLine.innerHTML = 'Could not reach ESPN (' + (err && err.message ? err.message : 'network/CORS error') +
          '). The endpoint is unofficial — if this persists, add matches manually or try again later.';
      });
    }

    function renderResults() {
      resultBox.innerHTML = '';
      if (!fetchedRows.length) {
        statusLine.className = 'sync-status muted';
        statusLine.textContent = 'No matches returned for that range.';
        return;
      }
      var counts = { new: 0, update: 0, same: 0, unmapped: 0 };
      fetchedRows.forEach(function (f) { f._status = syncStatus(f); counts[f._status]++; });
      statusLine.className = 'sync-status';
      statusLine.innerHTML = fetchedRows.length + ' match(es): ' +
        '<b class="green">' + counts.new + ' new</b>, ' +
        '<b class="gold">' + counts.update + ' updated</b>, ' +
        counts.same + ' unchanged' +
        (counts.unmapped ? ', <b class="red">' + counts.unmapped + ' unmapped</b>' : '');

      fetchedRows.sort(function (a, b) { return (a.date + a.kickoff).localeCompare(b.date + b.kickoff); });
      fetchedRows.forEach(function (f, i) {
        var ok = f._status !== 'unmapped' && f._status !== 'same';
        var cb = el('input', { type: 'checkbox' }); cb.checked = ok; cb.disabled = f._status === 'unmapped';
        f._include = cb.checked;
        cb.addEventListener('change', function () { f._include = cb.checked; });

        var label = f._status === 'unmapped'
          ? (f._rawHome + ' v ' + f._rawAway + ' — name not recognised')
          : (f.home + ' ' + (f.status === 'ft' ? (f.homeScore + '–' + f.awayScore) : 'vs') + ' ' + f.away);
        var extra = [];
        if (f.scorers && f.scorers.length) extra.push(f.scorers.length + ' scorer(s)');
        if (f.cards && f.cards.length) extra.push(f.cards.length + ' card(s)');

        resultBox.appendChild(el('label', { class: 'sync-row ' + f._status }, [
          cb,
          el('span', { class: 'sync-badge ' + f._status }, [f._status.toUpperCase()]),
          el('span', { class: 'sync-when muted' }, [f.date + ' ' + (f.kickoff || '')]),
          el('span', { class: 'sync-label' }, [label]),
          el('span', { class: 'sync-extra muted' }, [extra.join(' · ')])
        ]));
      });
    }

    function doImport() {
      var chosen = fetchedRows.filter(function (f) { return f._include && f._status !== 'unmapped'; });
      if (!chosen.length) { statusLine.className = 'sync-status red'; statusLine.textContent = 'Nothing selected to import.'; return; }
      chosen.forEach(function (f) { Store.upsertMatch(mergeFetched(f, findExisting(f))); });
      close();
    }

    function close() { var m = $('#sync-modal'); if (m) m.remove(); }

    var modal = el('div', { id: 'sync-modal', class: 'modal open', onclick: function (e) { if (e.target.id === 'sync-modal') close(); } }, [
      el('div', { class: 'modal-card wide' }, [
        el('div', { class: 'modal-top' }, [el('h2', null, ['Sync from ESPN']), el('button', { class: 'icon-btn', onclick: close }, ['✕'])]),
        el('div', { class: 'modal-body' }, [
          el('p', { class: 'muted small' }, ['Pulls fixtures, results, goalscorers and cards from ESPN’s free World Cup feed and maps team names to the sweepstake. Review below before importing — nothing is saved until you do.']),
          el('div', { class: 'row2' }, [field('From', from), field('To', to)]),
          el('label', { class: 'chk' }, [details, el('span', null, ['Include goalscorers & cards (extra requests, slower)'])]),
          el('div', { class: 'sync-bar' }, [el('button', { class: 'btn primary', onclick: doFetch }, ['Fetch']), statusLine]),
          resultBox
        ]),
        el('div', { class: 'modal-foot' }, [
          el('button', { class: 'btn ghost', onclick: close }, ['Cancel']),
          el('button', { class: 'btn primary', onclick: doImport }, ['Import selected'])
        ])
      ])
    ]);
    document.body.appendChild(modal);
  }

  function shiftISO(iso, days) { var d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }

  /* ---- TAB: Standings ----------------------------------------------------- */
  function renderStandings() {
    var st = Store.get();
    var groups = S.groupTables(st);
    var keys = Object.keys(groups).sort();
    var root = el('div');
    if (!keys.length) { root.appendChild(el('p', { class: 'empty big' }, ['Add matches with group labels to build the league tables.'])); return root; }
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
    var st = Store.get();
    if (!reportState.reportDate) reportState.reportDate = todayISO();
    var root = el('div', { class: 'report-tab' });

    var controls = el('div', { class: 'panel report-controls' });
    controls.appendChild(el('h2', null, ['Morning Report']));

    controls.appendChild(field('Report date', input3('date', reportState.reportDate, '', function (v) { reportState.reportDate = v; refreshPreview(); })));
    controls.appendChild(field('Tournament start (Day 1)', input3('date', st.startDate, '', function (v) { Store.setSettings({ startDate: v }); })));

    var ef = el('label', { class: 'chk' }, [
      (function () { var c = el('input', { type: 'checkbox' }); c.checked = !!st.earlyFilter; c.addEventListener('change', function () { Store.setSettings({ earlyFilter: c.checked }); }); return c; })(),
      el('span', null, ['Early-tournament filter (Worst Teams: only 0 pts & −GD)'])
    ]);
    controls.appendChild(ef);

    controls.appendChild(field('Footer note (optional)', input3('text', st.footerNote, 'e.g. Brazil v Mexico (20:00) lands tomorrow', function (v) { Store.setSettings({ footerNote: v }); refreshPreview(); })));

    var scaleSel = el('select', { html: '<option value="1">1× (1080px)</option><option value="2" selected>2× (2160px, crisp)</option><option value="3">3× (3240px)</option>' });
    scaleSel.addEventListener('change', function () { reportState.scale = parseInt(scaleSel.value, 10); });
    controls.appendChild(field('Export resolution', scaleSel));

    controls.appendChild(el('div', { class: 'report-btns' }, [
      el('button', { class: 'btn primary', onclick: exportPNG }, ['⬇ Export PNG']),
      el('button', { class: 'btn', onclick: refreshPreview }, ['↻ Refresh preview'])
    ]));

    root.appendChild(controls);

    var preview = el('div', { class: 'preview', id: 'report-preview' });
    root.appendChild(preview);
    setTimeout(refreshPreview, 0);
    return root;
  }

  function buildReport() {
    return R.build(Store.get(), {
      reportDate: reportState.reportDate,
      timestamp: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    });
  }
  function refreshPreview() {
    var p = $('#report-preview');
    if (!p) return;
    p.innerHTML = buildReport().svg;
  }
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

  /* ---- shared date helpers ------------------------------------------------ */
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function prettyDate(d) {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

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
    var view = $('#view');
    view.innerHTML = '';
    var tab = TABS.filter(function (t) { return t[0] === activeTab; })[0];
    view.appendChild(tab[2]());
  }

  /* ---- data toolbar (export/import/sample/reset) -------------------------- */
  function exportData() {
    var blob = new Blob([Store.exportJSON()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wc26-sweepstake-data.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function importData() {
    var inp = el('input', { type: 'file', accept: 'application/json' });
    inp.addEventListener('change', function () {
      var f = inp.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try { Store.replaceAll(JSON.parse(r.result)); } catch (e) { alert('Could not read that file.'); }
      };
      r.readAsText(f);
    });
    inp.click();
  }

  /* ---- wire up ------------------------------------------------------------ */
  function init() {
    Store.init();

    // tabs
    var tabsEl = $('#tabs');
    TABS.forEach(function (t) {
      tabsEl.appendChild(el('button', { 'data-tab': t[0], onclick: function () { activeTab = t[0]; render(); } }, [t[1]]));
    });

    $('#btn-export').addEventListener('click', exportData);
    $('#btn-import').addEventListener('click', importData);
    $('#btn-sample').addEventListener('click', function () {
      if (Store.get().matches.length && !confirm('Load sample data? This replaces current data.')) return;
      Store.replaceAll(WC.SAMPLE);
    });
    $('#btn-reset').addEventListener('click', function () {
      if (confirm('Clear all matches and settings?')) Store.reset();
    });

    // modal buttons
    $('#modal-save').addEventListener('click', saveDraft);
    $('#modal-cancel').addEventListener('click', closeModal);
    $('#modal-close').addEventListener('click', closeModal);
    $('#modal').addEventListener('click', function (e) { if (e.target.id === 'modal') closeModal(); });

    Store.onChange(function () { render(); });
    render();
  }

  document.addEventListener('DOMContentLoaded', init);

})(window.WC = window.WC || {});
