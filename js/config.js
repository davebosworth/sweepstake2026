/* ============================================================================
 * config.js — Shared settings for the World Cup sweepstake tracker.
 *
 * ⚠️  THIS REPO IS PUBLIC.  Anything in this file is visible to anyone who
 *     views the page source or browses the repo. Only put values here that you
 *     are comfortable being public. A free The Odds API key is fine: it has no
 *     billing attached and can be rotated any time at the-odds-api.com if the
 *     monthly quota gets abused.
 *
 * To share odds with friends without each person entering a key:
 *   1. Paste your the-odds-api.com key between the quotes on the apiKey line.
 *   2. Commit & push. Everyone who opens the page then sees odds automatically.
 *
 * These values are the shared source of truth — any non-empty setting here
 * overrides what an individual visitor has saved in their own browser, so
 * editing this file (e.g. rotating the key) reaches everyone on next load.
 * ========================================================================== */
window.WC_CONFIG = {
  apiKey: '',                                  // <-- paste your the-odds-api.com key here
  region: 'uk',                                // uk | eu | us | au
  winnerKey: 'soccer_fifa_world_cup_winner',   // tournament-winner outright market
  runnerUpKey: ''                              // set via "Find World Cup markets" if one exists
};
