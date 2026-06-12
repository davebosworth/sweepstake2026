/* ============================================================================
 * live.js — Live data layer. Replaces the old localStorage Store.
 *
 * On load() it pulls the whole tournament from ESPN (scoreboard for scores +
 * per-match summaries for goalscorers/cards), holds it in memory only, and
 * notifies listeners as data streams in. Nothing is persisted — every page
 * load re-fetches, and all tables are recomputed on the fly from the matches.
 * ========================================================================== */
(function (WC) {
  'use strict';

  var START = '2026-06-11';   // WC2026 opening day (Day 1)
  var END = '2026-07-19';     // final

  var state = {
    startDate: START,
    endDate: END,
    earlyFilter: true,
    footerNote: '',
    matches: [],
    loading: true,       // scoreboard fetch in progress
    detailLoading: false,// summaries (scorers/cards) still streaming
    error: null,
    updatedAt: null,
    unmapped: 0,
    _filterTouched: false
  };

  var listeners = [];
  function emit() { listeners.forEach(function (fn) { fn(state); }); }

  function allDates() {
    var out = [], d = new Date(START + 'T00:00:00'), end = new Date(END + 'T00:00:00'), guard = 0;
    while (d <= end && guard++ < 100) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
    return out;
  }

  // Run `worker` over `items` with bounded concurrency; resolves when all done.
  function pool(items, worker, concurrency) {
    return new Promise(function (resolve) {
      var i = 0, active = 0, done = 0, n = items.length;
      if (!n) return resolve();
      (function next() {
        while (active < concurrency && i < n) {
          var item = items[i++]; active++;
          Promise.resolve(worker(item))['catch'](function () {})
            .then(function () { active--; done++; if (done === n) resolve(); else next(); });
        }
      })();
    });
  }

  function load() {
    state.loading = true; state.error = null; state.matches = []; state.updatedAt = null; emit();

    var collected = [], dropped = 0;
    return pool(allDates(), function (d) {
      return WC.ESPN.fetchScoreboard(d).then(function (list) {
        list.forEach(function (m) {
          if (m.home && m.away) collected.push(m); else dropped++;
        });
      });
    }, 6).then(function () {
      // de-dupe by ESPN id (a match can surface on adjacent days)
      var seen = {}, uniq = [];
      collected.forEach(function (m) { if (!seen[m._espnId]) { seen[m._espnId] = 1; uniq.push(m); } });

      var finished = uniq.filter(function (m) { return m.status === 'ft'; });
      // Goalscorers + cards are fetched for finished AND in-play matches.
      var detailed = uniq.filter(function (m) { return m.status === 'ft' || m.status === 'live'; });
      state.matches = uniq;
      state.unmapped = dropped;
      state.loading = false;
      state.detailLoading = detailed.length > 0; // flag before first paint so cards show "loading"
      state.updatedAt = new Date();
      if (!state._filterTouched) {
        state.earlyFilter = finished.length < 24; // relax automatically once the group stage fills out
      }
      emit();

      // Stream in goalscorers + cards.
      if (!detailed.length) { startPolling(); return; }
      var n = 0;
      return pool(detailed, function (m) {
        return WC.ESPN.fetchDetails(m).then(function () {
          n++; if (n % 4 === 0) { state.updatedAt = new Date(); emit(); }
        });
      }, 8).then(function () {
        state.detailLoading = false; state.updatedAt = new Date(); emit();
        startPolling();
      });
    })['catch'](function (err) {
      state.loading = false;
      state.error = (err && err.message) ? err.message : 'Could not reach ESPN';
      emit();
    });
  }

  /* ---- live polling -------------------------------------------------------
     Keeps in-play games fresh without a full reload. Only the three-day window
     around "today" is re-fetched (the only place live games can be), matches
     are merged back by ESPN id, and details (scorers/cards) are refreshed for
     in-play and just-finished games. Cadence: 30s while anything is live, else
     2 min to catch kick-offs; paused while the tab is hidden. */
  var POLL_LIVE = 30000, POLL_IDLE = 120000;
  var pollTimer = null, polling = false;

  function pollDates() {
    var out = [], base = new Date();
    for (var k = -1; k <= 1; k++) {
      var d = new Date(base); d.setUTCDate(d.getUTCDate() + k);
      var iso = d.toISOString().slice(0, 10);
      if (iso >= START && iso <= END) out.push(iso);
    }
    return out;
  }

  function anyLive() { return state.matches.some(function (m) { return m.status === 'live'; }); }

  function scheduleNext() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(refresh, anyLive() ? POLL_LIVE : POLL_IDLE);
  }

  function refresh() {
    var dates = pollDates();
    // Nothing to poll (outside the tournament window) or tab hidden: idle.
    if (!dates.length || (typeof document !== 'undefined' && document.hidden)) { scheduleNext(); return; }

    var updated = [];
    pool(dates, function (d) {
      return WC.ESPN.fetchScoreboard(d).then(function (list) {
        list.forEach(function (m) { if (m.home && m.away) updated.push(m); });
      });
    }, 3).then(function () {
      var idx = {};
      state.matches.forEach(function (m, i) { idx[m._espnId] = i; });
      updated.forEach(function (m) {
        if (idx[m._espnId] != null) state.matches[idx[m._espnId]] = m; else { idx[m._espnId] = state.matches.length; state.matches.push(m); }
      });
      state.updatedAt = new Date(); emit();
      // Refresh scorers/cards for live + just-finished games in the window.
      var fresh = updated.filter(function (m) { return m.status === 'live' || m.status === 'ft'; });
      return pool(fresh, function (m) {
        return WC.ESPN.fetchDetails(state.matches[idx[m._espnId]]);
      }, 4);
    }).then(function () {
      state.updatedAt = new Date(); emit(); scheduleNext();
    })['catch'](function () { scheduleNext(); });
  }

  function startPolling() {
    if (polling) return; polling = true;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) { if (pollTimer) clearTimeout(pollTimer); refresh(); }
      });
    }
    scheduleNext();
  }

  var Live = {
    get: function () { return state; },
    onChange: function (fn) { listeners.push(fn); },
    load: load,
    setEarlyFilter: function (v) { state.earlyFilter = !!v; state._filterTouched = true; emit(); },
    setFooter: function (v) { state.footerNote = v; emit(); }
  };

  WC.Live = Live;

})(window.WC = window.WC || {});
