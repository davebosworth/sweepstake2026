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

  function compact(iso) { return iso.replace(/-/g, ''); }       // 2026-06-12 -> 20260612

  // The local match day for a kick-off instant, in the host region's time zone
  // (WC2026 is in North America). This is what groups a game to the day it is
  // actually played there: a late-evening US kick-off that falls after midnight
  // UTC/UK still belongs to the US calendar day, not the next one. Derived from
  // the true kick-off time so it never depends on which scoreboard query the
  // event came back from. YYYY-MM-DD.
  function localDay(input) {
    var d = (input instanceof Date) ? input : new Date(input);
    if (isNaN(d)) return null;
    var p = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(d).reduce(function (a, x) { a[x.type] = x.value; return a; }, {});
    return p.year + '-' + p.month + '-' + p.day;
  }

  // The UK kick-off time (HH:MM) for display only. The day a match belongs to
  // is the local match day (ESPN's scoreboard date), NOT this — the hosts are
  // 5-8h behind the UK, so a US evening kickoff is the small hours UK time and
  // must still count as that match day, not the next one.
  function ukTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(d).reduce(function (a, p) { a[p.type] = p.value; return a; }, {});
    return (parts.hour === '24' ? '00' : parts.hour) + ':' + parts.minute;
  }

  function teamName(competitor) {
    var t = competitor.team || {};
    return t.displayName || t.name || t.shortDisplayName || t.location || '';
  }

  /* ---- parsing ------------------------------------------------------------ */
  // Normalise one scoreboard event into the app's match shape (no scorers/cards
  // yet — those come from the summary). Carries _espn metadata + any unmapped
  // names so the UI can flag them.
  function parseEvent(ev, matchDay) {
    var comp = get(ev, ['competitions', 0]);
    if (!comp) return null;
    var comps = comp.competitors || [];
    var home = comps.filter(function (c) { return c.homeAway === 'home'; })[0] || comps[0];
    var away = comps.filter(function (c) { return c.homeAway === 'away'; })[0] || comps[1];
    if (!home || !away) return null;

    var rawHome = teamName(home), rawAway = teamName(away);
    var state = get(comp, ['status', 'type', 'state'], 'pre'); // pre | in | post
    var completed = get(comp, ['status', 'type', 'completed'], false);
    var finished = state === 'post' && completed;
    var live = state === 'in';                       // match in progress right now
    var hasScore = finished || live;

    // Group label if ESPN exposes one (often absent on the scoreboard).
    var group = get(comp, ['notes', 0, 'headline'], '') || get(ev, ['groupId'], '') || '';
    var gm = /group\s+([a-l])/i.exec(group);
    if (gm) group = 'Group ' + gm[1].toUpperCase(); else group = '';

    return {
      _espnId: ev.id,
      _rawHome: rawHome,
      _rawAway: rawAway,
      _state: state,
      _ts: Date.parse(ev.date) || 0,   // absolute kick-off instant, for true chronological order
      date: (ev.date && localDay(ev.date)) || matchDay,   // day the game is played locally (host time zone)
      kickoff: ukTime(ev.date),    // UK time, for display only
      clock: live ? (get(comp, ['status', 'displayClock'], '') || '') : '',     // e.g. "67'"
      statusDetail: get(comp, ['status', 'type', 'shortDetail'], '') || '',     // e.g. "HT", "1st Half"
      group: group,
      home: mapTeam(rawHome),
      away: mapTeam(rawAway),
      status: finished ? 'ft' : (live ? 'live' : 'scheduled'),
      homeScore: hasScore ? toInt(home.score) : null,
      awayScore: hasScore ? toInt(away.score) : null,
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
    return { scorers: scorers, cards: cards, predictor: parsePredictor(summary), xg: parseXG(summary, sideById) };
  }

  // Pre-match win-probability predictor (home/draw/away %), if ESPN provides it.
  // Field shapes are probed defensively; returns null if nothing usable is found.
  function parsePredictor(summary) {
    var p = summary && summary.predictor;
    if (!p) return null;
    var home = num(get(p, ['homeTeam', 'gameProjection']));
    var away = num(get(p, ['awayTeam', 'gameProjection']));
    if (home == null && away == null) return null;
    var draw = num(get(p, ['homeTeam', 'teamChanceTie'])) ||
               num(get(p, ['drawPercentage'])) || num(get(p, ['tiePercentage']));
    if (draw == null && home != null && away != null) draw = Math.max(0, 100 - home - away);
    return { home: home, draw: draw, away: away };
  }

  // Per-team expected goals (xG) from the box score statistics, if present.
  // ESPN's exact key is uncertain for the World Cup feed, so match defensively
  // on a stat whose name/label/abbreviation looks like xG; returns null if absent.
  function parseXG(summary, sideById) {
    var teams = get(summary, ['boxscore', 'teams'], []);
    if (!teams || !teams.length) return null;
    var out = {}, found = false;
    teams.forEach(function (t) {
      var side = sideById[String(get(t, ['team', 'id'], ''))];
      if (!side) return;
      (t.statistics || []).forEach(function (s) {
        var tag = ((s.name || '') + ' ' + (s.abbreviation || '') + ' ' + (s.label || '') + ' ' + (s.displayName || '')).toLowerCase();
        if (/expected goals|expectedgoals|\bxg\b/.test(tag)) {
          var v = parseFloat(s.displayValue != null ? s.displayValue : s.value);
          if (!isNaN(v)) { out[side] = v; found = true; }
        }
      });
    });
    return found ? out : null;
  }

  function num(v) { if (v == null) return null; var n = parseFloat(v); return isNaN(n) ? null : n; }

  /* ---- tiny session cache -------------------------------------------------
     Only ever caches data that can't change again: a day is cached once all
     its matches have ENDED (or the date is already in the past), and a match
     summary (scorers/cards) is only fetched/cached for finished matches.
     In-play and upcoming days are always re-fetched so live scores stay fresh.
     Lives in sessionStorage and clears when the tab closes. */
  // Bump the version whenever the parsed match shape changes, so stale
  // session caches from an older build are discarded rather than reused.
  var CACHE_KEY = 'wc26-cache-v5';
  var mem = { scoreboard: {}, summary: {} };
  var ss = (function () { try { return (typeof sessionStorage !== 'undefined') ? sessionStorage : null; } catch (e) { return null; } })();

  if (ss) { try { var raw = ss.getItem(CACHE_KEY); if (raw) { var o = JSON.parse(raw); mem.scoreboard = o.scoreboard || {}; mem.summary = o.summary || {}; } } catch (e) {} }

  var persistTimer = null;
  function persist() {
    if (!ss || persistTimer) return;
    persistTimer = setTimeout(function () {
      persistTimer = null;
      try { ss.setItem(CACHE_KEY, JSON.stringify(mem)); }
      catch (e) { try { ss.removeItem(CACHE_KEY); } catch (e2) {} } // quota: drop the cache rather than fail
    }, 300);
  }

  function todayUTC() { return localDay(new Date()); }   // "today" in the same (host) basis as match days
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // A day is safe to cache only when nothing on it can still change: it's a
  // past date, or every match returned has finished.
  function isSettled(dateISO, matches) {
    // Never cache a day with a game in progress, even a past-dated late kickoff.
    if (matches.some(function (m) { return m.status === 'live'; })) return false;
    if (dateISO < todayUTC()) return true;
    return matches.length > 0 && matches.every(function (m) { return m.status === 'ft'; });
  }

  /* ---- network ------------------------------------------------------------ */
  function fetchJSON(url) {
    return fetch(url, { headers: { 'Accept': 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function fetchScoreboard(dateISO) {
    var c = mem.scoreboard[dateISO];
    if (c) return Promise.resolve(c.matches.map(clone)); // only stored once settled
    return fetchJSON(BASE + '/scoreboard?dates=' + compact(dateISO)).then(function (data) {
      var matches = (data.events || []).map(function (ev) { return parseEvent(ev, dateISO); }).filter(Boolean);
      if (isSettled(dateISO, matches)) { mem.scoreboard[dateISO] = { matches: matches }; persist(); }
      return matches.map(clone);
    });
  }

  function fetchDetails(match) {
    if (!match._espnId) return Promise.resolve(match);
    var c = mem.summary[match._espnId];
    if (c) { match.scorers = clone(c.scorers); match.cards = clone(c.cards); match.xg = c.xg ? clone(c.xg) : null; return Promise.resolve(match); }
    return fetchJSON(BASE + '/summary?event=' + match._espnId)
      .then(function (s) {
        var d = parseSummary(s);
        match.scorers = d.scorers;
        match.cards = d.cards;
        match.predictor = d.predictor;   // meaningful pre-match
        match.xg = d.xg;                 // meaningful in-play / post-match
        // Only a finished match's details are final; never cache in-play data.
        if (match.status === 'ft') { mem.summary[match._espnId] = { scorers: d.scorers, cards: d.cards, xg: d.xg }; persist(); }
        return match;
      })
      .catch(function () { return match; }); // detail is best-effort
  }

  WC.ESPN = {
    fetchScoreboard: fetchScoreboard,
    fetchDetails: fetchDetails,
    mapTeam: mapTeam,
    localDay: localDay,
    BASE: BASE
  };

})(window.WC = window.WC || {});
