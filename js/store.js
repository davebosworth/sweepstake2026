/* ============================================================================
 * store.js — Application state, persistence and JSON import/export.
 *
 * Matches are the single source of truth. Team league stats and disciplinary
 * card points are all derived from the match list (see standings.js); nothing
 * is stored redundantly. State autosaves to localStorage so a single
 * maintainer can keep the tracker up to date across sessions, and can be
 * exported/imported as JSON to hand the dataset to someone else.
 * ========================================================================== */
(function (WC) {
  'use strict';

  var STORAGE_KEY = 'wc26-sweepstake-v1';

  function blankState() {
    return {
      startDate: WC.DEFAULT_START_DATE,
      // When true, the Worst Teams table only lists teams on 0 pts with a
      // negative GD (the early-tournament filter from the handover).
      earlyFilter: true,
      footerNote: '',
      matches: []
    };
  }

  var state = blankState();
  var listeners = [];

  function emit() {
    listeners.forEach(function (fn) { fn(state); });
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* storage may be unavailable; ignore */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        state = Object.assign(blankState(), parsed);
      }
    } catch (e) { state = blankState(); }
  }

  function uid() {
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  var Store = {
    onChange: function (fn) { listeners.push(fn); },

    get: function () { return state; },

    getMatch: function (id) {
      return state.matches.filter(function (m) { return m.id === id; })[0] || null;
    },

    setSettings: function (patch) {
      Object.assign(state, patch);
      save(); emit();
    },

    /* A match: { id, date, kickoff, group, home, away, status('scheduled'|'ft'),
       homeScore, awayScore, scorers:[{team,name}], cards:[{team,player,type}] } */
    upsertMatch: function (match) {
      if (!match.id) {
        match.id = uid();
        state.matches.push(match);
      } else {
        var i = state.matches.findIndex(function (m) { return m.id === match.id; });
        if (i >= 0) state.matches[i] = match; else state.matches.push(match);
      }
      save(); emit();
      return match;
    },

    deleteMatch: function (id) {
      state.matches = state.matches.filter(function (m) { return m.id !== id; });
      save(); emit();
    },

    replaceAll: function (newState) {
      state = Object.assign(blankState(), newState || {});
      save(); emit();
    },

    reset: function () {
      state = blankState();
      save(); emit();
    },

    exportJSON: function () {
      return JSON.stringify(state, null, 2);
    },

    init: function () { load(); }
  };

  WC.Store = Store;

})(window.WC = window.WC || {});
