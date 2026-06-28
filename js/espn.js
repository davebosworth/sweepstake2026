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

  // The UK calendar day (YYYY-MM-DD). Used for the daily odds snapshot/trend so
  // "the day before" is the previous UK day, regardless of host time zone.
  function londonDay(input) {
    var d = (input instanceof Date) ? input : new Date(input == null ? Date.now() : input);
    if (isNaN(d)) return null;
    var p = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
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

    // Who actually advanced. ESPN flags the winning competitor with `winner:true`
    // even when a knockout is settled on penalties (regulation score level), so
    // this names the loser of a shoot-out that the scoreline alone can't.
    var winner = finished ? (home.winner === true ? 'home' : (away.winner === true ? 'away' : null)) : null;

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
      winner: winner,                                   // 'home' | 'away' | null (decides level knockout ties)
      homeShootout: finished ? toInt(home.shootoutScore) : null,
      awayShootout: finished ? toInt(away.shootoutScore) : null,
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
    var scorers = [], cards = [], goalSeen = {};

    // Map ESPN id -> 'home'/'away' from the summary header. Different parts of
    // the payload reference a side by different ids (the event-competitor id,
    // the underlying team id, the team uid), so register every one we can see
    // — otherwise a join silently fails and that team's data is dropped.
    var sideById = {};
    var hcomps = get(summary, ['header', 'competitions', 0, 'competitors'], []);
    hcomps.forEach(function (c) {
      if (!c || !c.homeAway) return;
      [c.id, get(c, ['team', 'id']), get(c, ['team', 'uid'])].forEach(function (id) {
        if (id != null) sideById[String(id)] = c.homeAway;
      });
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

      // A goal: ESPN flags it via scoringPlay, or the type says "Goal", or a
      // scored penalty ("Penalty - Scored" — note: no "goal" in that text, which
      // is why penalties were being dropped). Exclude misses/saves, disallowed
      // goals, and shoot-out kicks (those aren't match goals).
      var miss = /missed|saved|disallow|no goal|cancel/.test(typeText);
      var isGoal = !miss && e.shootout !== true &&
        (e.scoringPlay === true || typeText.indexOf('goal') !== -1 ||
         (typeText.indexOf('penalty') !== -1 && typeText.indexOf('scored') !== -1));

      if (isGoal) {
        // Guard against the same goal appearing as two key events (e.g. a
        // "Penalty - Scored" plus a "Goal"): skip an exact side+minute+player repeat.
        var dupKey = side + '|' + clock + '|' + who.toLowerCase();
        if (clock && who && goalSeen[dupKey]) return;
        goalSeen[dupKey] = 1;
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
    return { scorers: scorers, cards: cards, predictor: parsePredictor(summary) };
  }

  // Win-probability predictor (home/draw/away %). ESPN's World Cup summary has
  // no `predictor` block, but it does carry sportsbook odds in `pickcenter` (and
  // a copy in `odds`): a 1X2 moneyline for home/draw/away. We convert those to
  // implied probabilities and normalise out the bookmaker's overround so the
  // three sum to 100%. Returns null if no usable moneyline is present.
  function parsePredictor(summary) {
    var pc = summary && summary.pickcenter;
    var entry = (Array.isArray(pc) && pc.length ? pc[0] : null) || (summary && summary.odds) || null;
    if (!entry) return null;
    var ml = entry.moneyline || {};
    // Prefer the structured moneyline.{home,away,draw}.close.odds; fall back to
    // the {home,away}TeamOdds.moneyLine / drawOdds.moneyLine numbers.
    var home = americanToProb(mlOdds(ml.home, get(entry, ['homeTeamOdds', 'moneyLine'])));
    var away = americanToProb(mlOdds(ml.away, get(entry, ['awayTeamOdds', 'moneyLine'])));
    var draw = americanToProb(mlOdds(ml.draw, get(entry, ['drawOdds', 'moneyLine'])));
    if (home == null && away == null && draw == null) return null;
    var sum = (home || 0) + (away || 0) + (draw || 0);
    if (sum <= 0) return null;
    return {
      home: home != null ? home / sum * 100 : null,
      draw: draw != null ? draw / sum * 100 : null,
      away: away != null ? away / sum * 100 : null
    };
  }

  // Pull a moneyline price from a pickcenter side ({ close:{odds}, open:{odds} }),
  // falling back to a raw value (e.g. homeTeamOdds.moneyLine).
  function mlOdds(side, fallback) {
    var v = get(side, ['close', 'odds']);
    if (v == null) v = get(side, ['open', 'odds']);
    return v != null ? v : fallback;
  }

  // American moneyline (number or "+350" / "-115" string) -> implied prob 0..1.
  function americanToProb(ml) {
    if (ml == null) return null;
    var n = parseFloat(String(ml).replace('+', ''));
    if (isNaN(n) || n === 0) return null;
    return n > 0 ? 100 / (n + 100) : (-n) / (-n + 100);
  }

  /* ---- tiny session cache -------------------------------------------------
     Only ever caches data that can't change again: a day is cached once all
     its matches have ENDED (or the date is already in the past), and a match
     summary (scorers/cards) is only fetched/cached for finished matches.
     In-play and upcoming days are always re-fetched so live scores stay fresh.
     Lives in sessionStorage and clears when the tab closes. */
  // Bump the version whenever the parsed match shape changes, so stale
  // session caches from an older build are discarded rather than reused.
  var CACHE_KEY = 'wc26-cache-v9';
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
    if (c) { match.scorers = clone(c.scorers); match.cards = clone(c.cards); return Promise.resolve(match); }
    return fetchJSON(BASE + '/summary?event=' + match._espnId)
      .then(function (s) {
        var d = parseSummary(s);
        match.scorers = d.scorers;
        match.cards = d.cards;
        match.predictor = d.predictor;   // win-probability from sportsbook odds (pre-match)
        // Only a finished match's details are final; never cache in-play data.
        if (match.status === 'ft') { mem.summary[match._espnId] = { scorers: d.scorers, cards: d.cards }; persist(); }
        return match;
      })
      .catch(function () { return match; }); // detail is best-effort
  }

  // The scoreboard rarely labels a match's group, but the standings endpoint
  // lists each group with its teams. Fetch it once and build a team -> "Group X"
  // map so group-stage matches can be labelled by their teams. Knockout teams
  // aren't in the group tables, so those matches simply get no label. Defensive
  // about the payload shape; resolves to {} on any failure.
  var STANDINGS = 'https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings';
  function fetchGroups() {
    return fetchJSON(STANDINGS).then(function (data) {
      var map = {};
      var groups = data.children || get(data, ['standings', 'groups'], []) || [];
      (groups || []).forEach(function (g) {
        var nm = g.name || g.displayName || g.abbreviation || '';
        var gm = /group\s+([a-l])\b/i.exec(nm);
        if (!gm) return;
        var label = 'Group ' + gm[1].toUpperCase();
        var entries = get(g, ['standings', 'entries'], []) || g.entries || [];
        entries.forEach(function (e) {
          var raw = get(e, ['team', 'displayName']) || get(e, ['team', 'name']) ||
                    get(e, ['team', 'shortDisplayName']) || get(e, ['team', 'location']) || '';
          var team = mapTeam(raw);
          if (team) map[team] = label;
        });
      });
      return map;
    })['catch'](function () { return {}; });
  }

  WC.ESPN = {
    fetchScoreboard: fetchScoreboard,
    fetchDetails: fetchDetails,
    fetchGroups: fetchGroups,
    mapTeam: mapTeam,
    localDay: localDay,
    londonDay: londonDay,
    BASE: BASE
  };

})(window.WC = window.WC || {});
