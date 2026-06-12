/* ============================================================================
 * odds.js — Tournament outright odds from The Odds API (the-odds-api.com).
 *
 * Pulls the "winner" (and optionally "runner-up") outright markets, averages
 * each team's decimal price across bookmakers, and derives a normalised
 * win-probability. Team names are mapped to the sweepstake's spellings.
 *
 * The Odds API needs a key. To keep it out of the (public) repo it is entered
 * in the UI and kept in localStorage — config only, not sweepstake data. The
 * endpoint is unofficial-to-us and untested from the build sandbox, so calls
 * are defensive and failures surface clearly.
 * ========================================================================== */
(function (WC) {
  'use strict';

  var BASE = 'https://api.the-odds-api.com/v4';
  var CFG_KEY = 'wc26-odds-cfg-v1';

  function defaults() {
    return {
      apiKey: '',
      region: 'uk',                                  // uk | eu | us | au
      winnerKey: 'soccer_fifa_world_cup_winner',     // tournament winner outright
      runnerUpKey: ''                                // set if a runner-up market key is available
    };
  }

  // Non-empty values committed in config.js (window.WC_CONFIG). These are the
  // shared source of truth and win over a visitor's own saved settings, so the
  // person running the deployment can set/rotate the key for everyone at once.
  function sharedConfig() {
    var src = (typeof window !== 'undefined' && window.WC_CONFIG) ? window.WC_CONFIG : {};
    var out = {};
    Object.keys(src).forEach(function (k) { if (src[k] !== '' && src[k] != null) out[k] = src[k]; });
    return out;
  }

  // Precedence: hard defaults < this browser's saved settings < shared config.
  var cfg = defaults();
  try { var raw = localStorage.getItem(CFG_KEY); if (raw) Object.assign(cfg, JSON.parse(raw)); } catch (e) {}
  Object.assign(cfg, sharedConfig());

  function getConfig() { return cfg; }
  function setConfig(patch) {
    Object.assign(cfg, patch);
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {}
  }

  function fetchOutright(sportKey) {
    if (!cfg.apiKey) return Promise.reject(new Error('No API key set'));
    if (!sportKey) return Promise.resolve(null);
    var url = BASE + '/sports/' + encodeURIComponent(sportKey) + '/odds' +
      '?regions=' + encodeURIComponent(cfg.region) +
      '&markets=outrights&oddsFormat=decimal&apiKey=' + encodeURIComponent(cfg.apiKey);
    return fetch(url).then(function (r) {
      if (r.status === 401) throw new Error('Invalid API key (401)');
      if (r.status === 429) throw new Error('Quota exhausted (429)');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // Outright payload -> { appTeam: averageDecimalOdds }.
  function parseOutright(data) {
    var prices = {};
    (data || []).forEach(function (ev) {
      (ev.bookmakers || []).forEach(function (bk) {
        (bk.markets || []).forEach(function (mk) {
          if (mk.key !== 'outrights') return;
          (mk.outcomes || []).forEach(function (o) {
            var team = WC.ESPN.mapTeam(o.name);
            if (!team) return; // not one of the 48 owned teams (or unmapped name)
            if (typeof o.price === 'number' && o.price > 0) (prices[team] = prices[team] || []).push(o.price);
          });
        });
      });
    });
    var avg = {};
    Object.keys(prices).forEach(function (t) {
      var a = prices[t];
      avg[t] = a.reduce(function (s, x) { return s + x; }, 0) / a.length;
    });
    return avg;
  }

  // Decimal odds -> implied probabilities, normalised across teams to strip the
  // bookmaker overround so they sum to ~100%.
  function impliedProbs(oddsMap) {
    var raw = {}, sum = 0;
    Object.keys(oddsMap).forEach(function (t) { var p = 1 / oddsMap[t]; raw[t] = p; sum += p; });
    var out = {};
    if (sum > 0) Object.keys(raw).forEach(function (t) { out[t] = raw[t] / sum; });
    return out;
  }

  /* Fetch both markets and build a row per owned team. Returns a Promise of
     { rows, updatedAt }. rows: { team, owner, winnerOdds, winnerProb, runnerUpOdds }. */
  function fetchAll() {
    return Promise.all([
      fetchOutright(cfg.winnerKey),
      cfg.runnerUpKey ? fetchOutright(cfg.runnerUpKey) : Promise.resolve(null)
    ]).then(function (res) {
      var winner = parseOutright(res[0]);
      var runner = res[1] ? parseOutright(res[1]) : {};
      var prob = impliedProbs(winner);
      var rows = WC.TEAMS.map(function (t) {
        return {
          team: t,
          owner: WC.ownerOf(t),
          winnerOdds: winner[t] != null ? winner[t] : null,
          winnerProb: prob[t] != null ? prob[t] : null,
          runnerUpOdds: runner[t] != null ? runner[t] : null
        };
      });
      return { rows: rows, updatedAt: new Date() };
    });
  }

  // Discover which World Cup outright markets the account actually has. The
  // Odds API exposes outright markets as their own sport keys; ?all=true also
  // returns upcoming/out-of-season ones. Lets the user pick the real winner /
  // runner-up keys rather than guessing.
  function listMarkets() {
    if (!cfg.apiKey) return Promise.reject(new Error('No API key set'));
    return fetch(BASE + '/sports?all=true&apiKey=' + encodeURIComponent(cfg.apiKey))
      .then(function (r) {
        if (r.status === 401) throw new Error('Invalid API key (401)');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (list) {
        return (list || []).filter(function (s) {
          return /world.?cup/i.test(s.key || '') || /world cup/i.test(s.title || '') || /world cup/i.test(s.description || '');
        });
      });
  }

  WC.Odds = { fetchAll: fetchAll, listMarkets: listMarkets, getConfig: getConfig, setConfig: setConfig, BASE: BASE };

})(window.WC = window.WC || {});
