/* ============================================================================
 * espn.js — Pull fixtures, results, goalscorers and cards from ESPN's free,
 * no-key "hidden" API for the FIFA World Cup (league slug: fifa.world).
 *
 *   scoreboard: .../soccer/fifa.world/scoreboard?dates=YYYYMMDD   (scores)
 *   summary:    .../soccer/fifa.world/summary?event=<id>          (scorers/cards)
 *
 * This endpoint is unofficial and can change without notice, so everything is
 * parsed defensively and surfaced to the user for review before it's saved.
 * Team names are mapped to the sweepstake's localised spellings.
 * ========================================================================== */
(function (WC) {
  'use strict';

  var BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';

  /* ---- team-name mapping --------------------------------------------------
     ESPN (and most feeds) use standard English names; the sweepstake uses a
     few localised spellings. Key = lowercased alias, value = app team name.
     Every one of the 48 owned teams maps to itself by default; only the
     differing spellings need explicit aliases. */
  var ALIAS = {};
  WC.TEAMS.forEach(function (t) { ALIAS[t.toLowerCase()] = t; });
  [
    ['Netherlands', 'Holland'],
    ['Turkey', 'Türkiye'], ['Turkiye', 'Türkiye'],
    ['Korea Republic', 'South Korea'], ['Republic of Korea', 'South Korea'], ['Korea', 'South Korea'],
    ["Côte d'Ivoire", 'Ivory Coast'], ['Cote d Ivoire', 'Ivory Coast'], ["Cote d'Ivoire", 'Ivory Coast'],
    ['Czech Republic', 'Czechia'],
    ['United States', 'USA'], ['United States of America', 'USA'], ['US', 'USA'],
    ['Congo DR', 'DR Congo'], ['DR Congo', 'DR Congo'], ['Democratic Republic of the Congo', 'DR Congo'],
    ['Curacao', 'Curaçao'],
    ['Cabo Verde', 'Cape Verde'],
    ['Bosnia and Herzegovina', 'Bosnia'], ['Bosnia & Herzegovina', 'Bosnia'], ['Bosnia-Herzegovina', 'Bosnia']
  ].forEach(function (pair) { ALIAS[pair[0].toLowerCase()] = pair[1]; });

  function mapTeam(name) {
    if (!name) return null;
    var key = String(name).trim().toLowerCase();
    return ALIAS[key] || null;
  }

  /* ---- small helpers ------------------------------------------------------ */
  function get(obj, path, fallback) {
    var cur = obj;
    for (var i = 0; i < path.length; i++) {
      if (cur == null) return fallback;
      cur = cur[path[i]];
    }
    return cur == null ? fallback : cur;
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function compact(iso) { return iso.replace(/-/g, ''); }       // 2026-06-12 -> 20260612

  // Convert an ISO timestamp to UK local date (YYYY-MM-DD) and time (HH:MM).
  function toUK(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return { date: null, time: '' };
    var parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(d).reduce(function (a, p) { a[p.type] = p.value; return a; }, {});
    return {
      date: parts.year + '-' + parts.month + '-' + parts.day,
      time: (parts.hour === '24' ? '00' : parts.hour) + ':' + parts.minute
    };
  }

  function teamName(competitor) {
    var t = competitor.team || {};
    return t.displayName || t.name || t.shortDisplayName || t.location || '';
  }

  /* ---- parsing ------------------------------------------------------------ */
  // Normalise one scoreboard event into the app's match shape (no scorers/cards
  // yet — those come from the summary). Carries _espn metadata + any unmapped
  // names so the UI can flag them.
  function parseEvent(ev) {
    var comp = get(ev, ['competitions', 0]);
    if (!comp) return null;
    var comps = comp.competitors || [];
    var home = comps.filter(function (c) { return c.homeAway === 'home'; })[0] || comps[0];
    var away = comps.filter(function (c) { return c.homeAway === 'away'; })[0] || comps[1];
    if (!home || !away) return null;

    var rawHome = teamName(home), rawAway = teamName(away);
    var uk = toUK(ev.date);
    var state = get(comp, ['status', 'type', 'state'], 'pre'); // pre | in | post
    var completed = get(comp, ['status', 'type', 'completed'], false);
    var finished = state === 'post' && completed;

    // Group label if ESPN exposes one (often absent on the scoreboard).
    var group = get(comp, ['notes', 0, 'headline'], '') || get(ev, ['groupId'], '') || '';
    var gm = /group\s+([a-l])/i.exec(group);
    if (gm) group = 'Group ' + gm[1].toUpperCase(); else group = '';

    return {
      _espnId: ev.id,
      _rawHome: rawHome,
      _rawAway: rawAway,
      _state: state,
      date: uk.date,
      kickoff: uk.time,
      group: group,
      home: mapTeam(rawHome),
      away: mapTeam(rawAway),
      status: finished ? 'ft' : 'scheduled',
      homeScore: finished ? toInt(home.score) : null,
      awayScore: finished ? toInt(away.score) : null,
      scorers: [],
      cards: []
    };
  }

  function toInt(v) {
    if (v == null) return null;
    var n = parseInt(String(typeof v === 'object' ? v.value || v.displayValue : v), 10);
    return isNaN(n) ? null : n;
  }

  // Pull goalscorers and cards out of a summary payload.
  function parseSummary(summary) {
    var scorers = [], cards = [];

    // Map ESPN team id -> 'home'/'away' from the summary header.
    var sideById = {};
    var hcomps = get(summary, ['header', 'competitions', 0, 'competitors'], []);
    hcomps.forEach(function (c) {
      if (c && c.id != null && c.homeAway) sideById[String(c.id)] = c.homeAway;
    });

    var events = summary.keyEvents || get(summary, ['commentary'], []) || [];
    events.forEach(function (e) {
      var typeText = (get(e, ['type', 'text'], '') || '').toLowerCase();
      var side = sideById[String(get(e, ['team', 'id'], ''))];
      if (!side) return;
      var who = get(e, ['athletesInvolved', 0, 'displayName'], '') ||
                get(e, ['participants', 0, 'athlete', 'displayName'], '') ||
                get(e, ['athletesInvolved', 0, 'shortName'], '') || '';
      var clock = get(e, ['clock', 'displayValue'], '') || '';

      if (typeText.indexOf('goal') !== -1 && typeText.indexOf('disallow') === -1) {
        var label = who + (clock ? ' ' + clock : '');
        if (typeText.indexOf('penalty') !== -1) label += ' (pen)';
        if (typeText.indexOf('own') !== -1) label += ' (og)';
        scorers.push({ team: side, name: label.trim() });
      } else if (typeText.indexOf('red card') !== -1 || typeText.indexOf('yellow red') !== -1) {
        cards.push({ team: side, player: who || 'Unknown', type: 'red' });
      } else if (typeText.indexOf('yellow card') !== -1) {
        cards.push({ team: side, player: who || 'Unknown', type: 'yellow' });
      }
    });
    return { scorers: scorers, cards: cards };
  }

  /* ---- network ------------------------------------------------------------ */
  function fetchJSON(url) {
    return fetch(url, { headers: { 'Accept': 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function fetchScoreboard(dateISO) {
    return fetchJSON(BASE + '/scoreboard?dates=' + compact(dateISO))
      .then(function (data) {
        return (data.events || []).map(parseEvent).filter(Boolean);
      });
  }

  function fetchDetails(match) {
    if (!match._espnId) return Promise.resolve(match);
    return fetchJSON(BASE + '/summary?event=' + match._espnId)
      .then(function (s) {
        var d = parseSummary(s);
        match.scorers = d.scorers;
        match.cards = d.cards;
        return match;
      })
      .catch(function () { return match; }); // detail is best-effort
  }

  WC.ESPN = {
    fetchScoreboard: fetchScoreboard,
    fetchDetails: fetchDetails,
    mapTeam: mapTeam,
    BASE: BASE
  };

})(window.WC = window.WC || {});
