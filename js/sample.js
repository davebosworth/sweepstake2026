/* ============================================================================
 * sample.js — Optional demo dataset (loaded via the "Load sample" button).
 * A handful of day-1 results and day-2 fixtures so the tables and the Morning
 * Report have something to show out of the box. Not real WC26 data.
 * ========================================================================== */
(function (WC) {
  'use strict';

  WC.SAMPLE = {
    startDate: '2026-06-11',
    earlyFilter: true,
    footerNote: '',
    matches: [
      {
        id: 's1', date: '2026-06-11', kickoff: '20:00', group: 'Group A',
        home: 'Mexico', away: 'Croatia', status: 'ft', homeScore: 1, awayScore: 3,
        scorers: [
          { team: 'home', name: "Giménez 67'" },
          { team: 'away', name: "Modrić 12'" }, { team: 'away', name: "Kramarić 40'" }, { team: 'away', name: "Petković 88'" }
        ],
        cards: [
          { team: 'home', player: 'Álvarez', type: 'yellow' },
          { team: 'home', player: 'Sánchez', type: 'yellow' },
          { team: 'home', player: 'Montes', type: 'red' }
        ]
      },
      {
        id: 's2', date: '2026-06-11', kickoff: '17:00', group: 'Group B',
        home: 'USA', away: 'Spain', status: 'ft', homeScore: 0, awayScore: 2,
        scorers: [{ team: 'away', name: "Yamal 22'" }, { team: 'away', name: "Oyarzabal 71'" }],
        cards: [{ team: 'home', player: 'Adams', type: 'yellow' }]
      },
      {
        id: 's3', date: '2026-06-11', kickoff: '14:00', group: 'Group C',
        home: 'Qatar', away: 'Germany', status: 'ft', homeScore: 0, awayScore: 4,
        scorers: [{ team: 'away', name: "Wirtz 18'" }, { team: 'away', name: "Musiala 33'" }, { team: 'away', name: "Havertz 55'" }, { team: 'away', name: "Füllkrug 79'" }],
        cards: [{ team: 'away', player: 'Rüdiger', type: 'red' }]
      },
      {
        id: 's4', date: '2026-06-11', kickoff: '11:00', group: 'Group D',
        home: 'Haiti', away: 'Jordan', status: 'ft', homeScore: 1, awayScore: 1,
        scorers: [{ team: 'home', name: "Pierrot 44'" }, { team: 'away', name: "Al-Naimat 90'" }],
        cards: []
      },
      {
        id: 's5', date: '2026-06-12', kickoff: '14:00', group: 'Group A',
        home: 'Canada', away: 'Curaçao', status: 'scheduled', homeScore: null, awayScore: null, scorers: [], cards: []
      },
      {
        id: 's6', date: '2026-06-12', kickoff: '17:00', group: 'Group E',
        home: 'England', away: 'Senegal', status: 'scheduled', homeScore: null, awayScore: null, scorers: [], cards: []
      },
      {
        id: 's7', date: '2026-06-12', kickoff: '20:00', group: 'Group F',
        home: 'France', away: 'Argentina', status: 'scheduled', homeScore: null, awayScore: null, scorers: [], cards: []
      }
    ]
  };

})(window.WC = window.WC || {});
