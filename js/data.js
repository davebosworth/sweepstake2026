/* ============================================================================
 * data.js — Static seed data for the WC26 Sweepstake tracker.
 *
 * Allocations are fixed for the tournament (see the handover doc). Everything
 * here is the immutable reference data: players, their six teams, the design
 * tokens for the Morning Report graphic, and a couple of derived lookups.
 * ========================================================================== */
(function (WC) {
  'use strict';

  // The eight players in running order, each with their six teams.
  // This is the single source of truth for ownership — the team->owner
  // lookup is derived from it below.
  WC.PLAYERS = [
    { name: 'Skit',    teams: ['Sweden', 'Uzbekistan', 'Tunisia', 'Japan', 'Switzerland', 'England'] },
    { name: 'Dan',     teams: ['Türkiye', 'South Africa', 'Scotland', 'Australia', 'Croatia', 'Holland'] },
    { name: 'Jamie',   teams: ['Iraq', 'Saudi Arabia', 'Panama', 'Iran', 'Morocco', 'France'] },
    { name: 'Jonesy',  teams: ['DR Congo', 'Qatar', 'Algeria', 'Canada', 'Mexico', 'Brazil'] },
    { name: 'Gamble',  teams: ['Haiti', 'Jordan', 'Paraguay', 'Ecuador', 'Colombia', 'Portugal'] },
    { name: 'Gordie',  teams: ['Bosnia', 'Ghana', 'Norway', 'Austria', 'Germany', 'Argentina'] },
    { name: 'Cairnsy', teams: ['Czechia', 'Cape Verde', 'Egypt', 'South Korea', 'Uruguay', 'Spain'] },
    { name: 'Boz',     teams: ['New Zealand', 'Curaçao', 'Ivory Coast', 'Senegal', 'USA', 'Belgium'] }
  ];

  // team name -> owner name
  WC.TEAM_OWNER = {};
  // sorted flat list of all 48 teams
  WC.TEAMS = [];
  WC.PLAYERS.forEach(function (p) {
    p.teams.forEach(function (t) {
      WC.TEAM_OWNER[t] = p.name;
      WC.TEAMS.push(t);
    });
  });
  WC.TEAMS.sort(function (a, b) { return a.localeCompare(b); });

  WC.ownerOf = function (team) {
    return WC.TEAM_OWNER[team] || '—';
  };

  // Design system tokens, lifted straight from the handover "Design system".
  WC.THEME = {
    bgTop:   '#06231a',
    bgBottom:'#0c3326',
    cardFill:'#103a2c',
    cardBorder:'#1d5742',
    radius:  20,
    gold:    '#f4c430',
    green:   '#37d27a',
    red:     '#e8503a',
    yellow:  '#f2c84b',
    white:   '#ffffff',
    muted:   '#8fb3a4',
    font:    "'DejaVu Sans', Verdana, Geneva, sans-serif"
  };

  // Disciplinary scoring (FIFA fair-play scheme), applied PER PLAYER PER MATCH —
  // not per card — so a sending-off isn't double-counted with its bookings:
  //   yellow card .......................... 1
  //   indirect red (second yellow) ......... 3   (not 1 + 3)
  //   direct red ........................... 4
  //   yellow + a later direct red .......... 5
  WC.CARD_POINTS = { yellow: 1, yellowRed: 3, red: 4, yellowAndRed: 5 };

  // ── Tournament config ──────────────────────────────────────────────────
  // To reuse this tracker for the next World Cup, update THIS block and the
  // PLAYERS allocations above (and add any new teams to js/flags.js). The date
  // window is what the app polls ESPN's fifa.world feed across.
  WC.TOURNAMENT = {
    name: 'World Cup 2026',
    startDate: '2026-06-11',   // opening day = Day 1
    endDate: '2026-07-19'      // final
  };
  WC.DEFAULT_START_DATE = WC.TOURNAMENT.startDate;   // back-compat alias

})(window.WC = window.WC || {});
