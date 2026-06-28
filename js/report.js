/* ============================================================================
 * report.js — Builds the "Morning Report" as an SVG and exports it to PNG.
 *
 * Faithful to the handover design spec: portrait, 1080px wide, height grows
 * with content. Sections top-to-bottom: Header, Yesterday's Results, Today's
 * Fixtures, Worst Teams, Disciplinary Prize, Footer. The SVG is rendered to a
 * canvas and saved as a PNG (the web equivalent of the cairosvg pipeline).
 * ========================================================================== */
(function (WC) {
  'use strict';

  var T = WC.THEME;
  var W = 1080;          // canvas width (WhatsApp portrait)
  var M = 60;            // outer margin
  var PAD = 40;          // inner card padding
  var CW = W - 2 * M;    // content width
  var _uid = 0;          // unique id source for per-bar SVG clip paths
  var FLAGS = {};        // code -> PNG data URI for the current build (set in build())
  var FW = 46;           // flag draw size (px)

  // PNG data URI for a team's flag, or null. Flags are pre-rasterised to PNG and
  // embedded (not external/SVG) so the SVG→canvas→PNG export stays self-contained
  // and renders identically on every device.
  function flagFor(team) {
    var code = WC.FLAG && WC.FLAG[team];
    return code ? (FLAGS[code] || null) : null;
  }
  function flagImage(parts, x, y, size, uri) {
    parts.push('<image x="' + x + '" y="' + y + '" width="' + size + '" height="' + size + '" href="' + uri + '" preserveAspectRatio="xMidYMid meet"/>');
  }

  /* ---- tiny SVG helpers ---------------------------------------------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function attrs(o) {
    return Object.keys(o).map(function (k) {
      return k.replace(/_/g, '-') + '="' + esc(o[k]) + '"';
    }).join(' ');
  }

  function rect(x, y, w, h, o) {
    o = o || {};
    var a = { x: x, y: y, width: w, height: h, rx: o.rx != null ? o.rx : 0, ry: o.ry != null ? o.ry : (o.rx != null ? o.rx : 0) };
    if (o.fill) a.fill = o.fill; else a.fill = 'none';
    if (o.stroke) { a.stroke = o.stroke; a['stroke-width'] = o.sw != null ? o.sw : 2; }
    if (o.opacity != null) a.opacity = o.opacity;
    return '<rect ' + attrs(a) + ' />';
  }

  function text(x, y, str, o) {
    o = o || {};
    var a = {
      x: x, y: y,
      fill: o.fill || T.white,
      'font-family': T.font,
      'font-size': o.size || 28,
      'font-weight': o.weight || 'normal',
      'text-anchor': o.anchor || 'start'
    };
    if (o.spacing) a['letter-spacing'] = o.spacing;
    if (o.opacity != null) a.opacity = o.opacity;
    return '<text ' + attrs(a) + '>' + esc(str) + '</text>';
  }

  // Greedy word/segment wrap, returns array of lines. Splits on the given
  // separator (default space) and packs up to `maxChars` per line.
  function wrap(str, maxChars, sep) {
    if (!str) return [];
    sep = sep || ' ';
    var parts = str.split(sep), lines = [], cur = '';
    parts.forEach(function (p) {
      var candidate = cur ? cur + sep + p : p;
      if (candidate.length > maxChars && cur) { lines.push(cur); cur = p; }
      else { cur = candidate; }
    });
    if (cur) lines.push(cur);
    return lines;
  }

  function dayNumber(startDate, reportDate) {
    var a = new Date(startDate + 'T00:00:00Z');
    var b = new Date(reportDate + 'T00:00:00Z');
    return Math.floor((b - a) / 86400000) + 1;
  }

  // UTC-safe date shift. Parsing/serialising in UTC avoids the off-by-one that
  // bites in timezones ahead of UTC (e.g. BST), where local-midnight rolls back
  // across the date line when round-tripped through toISOString.
  function shiftDate(dateStr, days) {
    var d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function prettyDate(dateStr) {
    var d = new Date(dateStr + 'T00:00:00Z');
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  /* ---- section builders ---------------------------------------------------- */

  function sectionHeading(parts, y, label) {
    parts.push(text(M, y, label.toUpperCase(), {
      fill: T.green, size: 26, weight: 'bold', spacing: 3
    }));
    return y + 24;
  }

  function card(parts, y, h) {
    parts.push(rect(M, y, CW, h, { rx: T.radius, fill: T.cardFill, stroke: T.cardBorder, sw: 2 }));
  }

  // A completed-match result card. Returns the new cursor y.
  function resultCard(parts, y, m) {
    var homeWin = m.homeScore > m.awayScore;
    var awayWin = m.awayScore > m.homeScore;

    var homeScorers = (m.scorers || []).filter(function (s) { return s.team === 'home'; })
      .map(function (s) { return s.name; }).join(', ');
    var awayScorers = (m.scorers || []).filter(function (s) { return s.team === 'away'; })
      .map(function (s) { return s.name; }).join(', ');

    var hLines = wrap(homeScorers, 30, ', ');
    var aLines = wrap(awayScorers, 30, ', ');
    var scorerLines = Math.max(hLines.length, aLines.length);

    var top = 64;                         // group tag + FT row
    var body = 84;                        // teams + score + owners
    var scorerBlock = scorerLines ? (18 + scorerLines * 28) : 8;
    var h = top + body + scorerBlock + 24;

    card(parts, y, h);
    var lx = M + PAD, rx = M + CW - PAD, cx = W / 2;
    var cy = y + 40;

    parts.push(text(lx, cy, m.group || '', { fill: T.muted, size: 22, weight: 'bold', spacing: 2 }));
    parts.push(text(rx, cy, 'FT', { fill: T.gold, size: 22, weight: 'bold', anchor: 'end', spacing: 2 }));

    // Teams + score (flags sit on the outer edges; text indents to make room)
    var ty = y + top + 24;
    var hf = flagFor(m.home), af = flagFor(m.away);
    var hx = lx + (hf ? FW + 12 : 0), ax = rx - (af ? FW + 12 : 0);
    if (hf) flagImage(parts, lx, ty - 36, FW, hf);
    if (af) flagImage(parts, rx - FW, ty - 36, FW, af);
    parts.push(text(hx, ty, m.home, { fill: homeWin || (!homeWin && !awayWin) ? T.white : T.muted, size: 34, weight: 'bold' }));
    parts.push(text(ax, ty, m.away, { fill: awayWin || (!homeWin && !awayWin) ? T.white : T.muted, size: 34, weight: 'bold', anchor: 'end' }));
    parts.push(text(cx, ty, m.homeScore + ' – ' + m.awayScore, { fill: T.gold, size: 40, weight: 'bold', anchor: 'middle' }));

    // Owners beneath each team
    var oy = ty + 34;
    parts.push(text(hx, oy, WC.ownerOf(m.home), { fill: homeWin ? T.green : T.muted, size: 24, weight: 'bold' }));
    parts.push(text(ax, oy, WC.ownerOf(m.away), { fill: awayWin ? T.green : T.muted, size: 24, weight: 'bold', anchor: 'end' }));

    // Goalscorers
    var sy = oy + 40;
    hLines.forEach(function (ln, i) { parts.push(text(hx, sy + i * 28, ln, { fill: T.muted, size: 22 })); });
    aLines.forEach(function (ln, i) { parts.push(text(ax, sy + i * 28, ln, { fill: T.muted, size: 22, anchor: 'end' })); });

    return y + h;
  }

  // A stacked home/draw/away win-probability bar (odds-implied), clipped to
  // rounded ends. Widths are proportional; null shares count as zero.
  function predictorBar(parts, x, y, w, p) {
    function pv(v) { return v == null ? 0 : Math.max(0, v); }
    var ph = pv(p.home), pd = pv(p.draw), pa = pv(p.away), sum = ph + pd + pa;
    if (sum <= 0) return;
    var barH = 18, id = 'predclip' + (++_uid);
    var wh = w * ph / sum, wd = w * pd / sum, wa = w - wh - wd;
    parts.push('<clipPath id="' + id + '"><rect ' + attrs({ x: x, y: y, width: w, height: barH, rx: 9, ry: 9 }) + '/></clipPath>');
    parts.push('<g clip-path="url(#' + id + ')">');
    parts.push(rect(x, y, w, barH, { fill: '#0d3225' }));
    parts.push(rect(x, y, wh, barH, { fill: T.green }));
    parts.push(rect(x + wh, y, wd, barH, { fill: T.muted }));
    parts.push(rect(x + wh + wd, y, wa, barH, { fill: T.gold }));
    parts.push('</g>');
  }

  // An upcoming-fixture card. Returns the new cursor y.
  function fixtureCard(parts, y, m) {
    var p = m.predictor, hasPred = !!(p && (p.home != null || p.away != null));
    var h = hasPred ? 256 : 168;
    card(parts, y, h);
    var lx = M + PAD, rx = M + CW - PAD, cx = W / 2;
    var cy = y + 40;

    parts.push(text(lx, cy, m.group || '', { fill: T.muted, size: 22, weight: 'bold', spacing: 2 }));
    parts.push(text(rx, cy, (m.kickoff || '') + (m.kickoff ? ' UK' : ''), { fill: T.gold, size: 22, weight: 'bold', anchor: 'end' }));

    var ty = y + 92;
    var hf = flagFor(m.home), af = flagFor(m.away);
    var hx = lx + (hf ? FW + 12 : 0), ax = rx - (af ? FW + 12 : 0);
    if (hf) flagImage(parts, lx, ty - 35, FW, hf);
    if (af) flagImage(parts, rx - FW, ty - 35, FW, af);
    parts.push(text(hx, ty, m.home, { fill: T.white, size: 32, weight: 'bold' }));
    parts.push(text(cx, ty, 'vs', { fill: T.muted, size: 26, anchor: 'middle' }));
    parts.push(text(ax, ty, m.away, { fill: T.white, size: 32, weight: 'bold', anchor: 'end' }));

    var oy = ty + 32;
    parts.push(text(hx, oy, WC.ownerOf(m.home), { fill: T.muted, size: 24, weight: 'bold' }));
    parts.push(text(ax, oy, WC.ownerOf(m.away), { fill: T.muted, size: 24, weight: 'bold', anchor: 'end' }));

    if (hasPred) {
      function pr(v) { return Math.round(v == null ? 0 : v); }
      var capY = oy + 44;
      parts.push(text(lx, capY, 'PREDICTED RESULT', { fill: T.green, size: 18, weight: 'bold', spacing: 2 }));
      var barY = capY + 16;
      predictorBar(parts, lx, barY, CW - 2 * PAD, p);
      var labY = barY + 18 + 28;
      parts.push(text(lx, labY, m.home + ' ' + pr(p.home) + '%', { fill: T.green, size: 22, weight: 'bold' }));
      parts.push(text(cx, labY, 'Draw ' + pr(p.draw) + '%', { fill: T.muted, size: 22, anchor: 'middle' }));
      parts.push(text(rx, labY, pr(p.away) + '% ' + m.away, { fill: T.gold, size: 22, weight: 'bold', anchor: 'end' }));
    }

    return y + h;
  }

  function emptyCard(parts, y, msg) {
    var h = 88;
    card(parts, y, h);
    parts.push(text(W / 2, y + 52, msg, { fill: T.muted, size: 24, anchor: 'middle' }));
    return y + h;
  }

  // Worst Teams table card.
  function worstTable(parts, y, rows) {
    var rowH = 60, headH = 56;
    var h = headH + Math.max(rows.length, 1) * rowH + 24;
    card(parts, y, h);

    var cRank = M + PAD;
    var cTeam = M + PAD + 70;
    var cOwner = M + CW - PAD - 230;
    var cPts = M + CW - PAD - 90;
    var cGD = M + CW - PAD;

    var hy = y + 40;
    parts.push(text(cRank, hy, '#', { fill: T.muted, size: 20, weight: 'bold', spacing: 1 }));
    parts.push(text(cTeam, hy, 'TEAM', { fill: T.muted, size: 20, weight: 'bold', spacing: 1 }));
    parts.push(text(cOwner, hy, 'OWNER', { fill: T.muted, size: 20, weight: 'bold', spacing: 1 }));
    parts.push(text(cPts, hy, 'PTS', { fill: T.muted, size: 20, weight: 'bold', spacing: 1, anchor: 'end' }));
    parts.push(text(cGD, hy, 'GD', { fill: T.muted, size: 20, weight: 'bold', spacing: 1, anchor: 'end' }));

    if (!rows.length) {
      parts.push(text(W / 2, y + headH + 36, 'No qualifying teams yet', { fill: T.muted, size: 24, anchor: 'middle' }));
      return y + h;
    }

    rows.forEach(function (r, i) {
      var ry = y + headH + i * rowH;
      if (i % 2 === 1) parts.push(rect(M + 12, ry, CW - 24, rowH, { rx: 10, fill: '#0d3225' }));
      var ty = ry + 40;
      parts.push(text(cRank, ty, r.rank + (i === 0 ? ' ★' : ''), { fill: T.gold, size: 26, weight: 'bold' }));
      var tf = flagFor(r.team);
      if (tf) flagImage(parts, cTeam, ty - 27, 32, tf);
      parts.push(text(cTeam + (tf ? 42 : 0), ty, r.team, { fill: T.white, size: 26, weight: 'bold' }));
      parts.push(text(cOwner, ty, r.owner, { fill: T.muted, size: 24 }));
      parts.push(text(cPts, ty, r.Pts, { fill: T.white, size: 26, weight: 'bold', anchor: 'end' }));
      var gd = (r.GD > 0 ? '+' : '') + r.GD;
      parts.push(text(cGD, ty, gd, { fill: r.GD < 0 ? T.red : T.muted, size: 26, weight: 'bold', anchor: 'end' }));
    });
    return y + h;
  }

  function chip(parts, x, y, label, fill, textFill) {
    var w = 30 + String(label).length * 14;
    parts.push(rect(x, y - 22, w, 32, { rx: 8, fill: fill }));
    parts.push(text(x + w / 2, y, label, { fill: textFill, size: 20, weight: 'bold', anchor: 'middle' }));
    return w;
  }

  // Disciplinary leaderboard card.
  function disciplinaryTable(parts, y, rows) {
    var rowH = 64, headH = 56;
    var h = headH + Math.max(rows.length, 1) * rowH + 24;
    card(parts, y, h);

    var cRank = M + PAD;
    var cTeam = M + PAD + 70;
    var cOwner = M + PAD + 340;
    var cChips = M + CW - PAD - 230;
    var cTotal = M + CW - PAD;

    var hy = y + 40;
    parts.push(text(cRank, hy, '#', { fill: T.muted, size: 20, weight: 'bold', spacing: 1 }));
    parts.push(text(cTeam, hy, 'TEAM', { fill: T.muted, size: 20, weight: 'bold', spacing: 1 }));
    parts.push(text(cOwner, hy, 'OWNER', { fill: T.muted, size: 20, weight: 'bold', spacing: 1 }));
    parts.push(text(cChips, hy, 'CARDS', { fill: T.muted, size: 20, weight: 'bold', spacing: 1 }));
    parts.push(text(cTotal, hy, 'PTS', { fill: T.muted, size: 20, weight: 'bold', spacing: 1, anchor: 'end' }));

    if (!rows.length) {
      parts.push(text(W / 2, y + headH + 36, 'No cards recorded yet', { fill: T.muted, size: 24, anchor: 'middle' }));
      return y + h;
    }

    rows.forEach(function (r, i) {
      var ry = y + headH + i * rowH;
      var leading = i === 0;
      if (i % 2 === 1) parts.push(rect(M + 12, ry, CW - 24, rowH, { rx: 10, fill: '#0d3225' }));

      var ty = ry + 42;
      parts.push(text(cRank, ty, r.rank + (leading ? ' ★' : ''), { fill: T.gold, size: 26, weight: 'bold' }));
      var tf = flagFor(r.team);
      if (tf) flagImage(parts, cTeam, ty - 27, 32, tf);
      parts.push(text(cTeam + (tf ? 42 : 0), ty, r.team, { fill: T.white, size: 26, weight: 'bold' }));
      parts.push(text(cOwner, ty, r.owner, { fill: leading ? T.gold : T.muted, size: 24, weight: leading ? 'bold' : 'normal' }));

      var cx = cChips;
      if (r.red > 0) { cx += chip(parts, cx, ty - 6, r.red, T.red, '#1a0b08') + 10; }
      chip(parts, cx, ty - 6, r.yellow, T.yellow, '#2a2206');

      parts.push(text(cTotal, ty, r.cardPoints, { fill: T.gold, size: 28, weight: 'bold', anchor: 'end' }));
    });
    return y + h;
  }

  /* ---- top-level build ----------------------------------------------------- */

  function build(state, opts) {
    opts = opts || {};
    FLAGS = opts.flags || {};   // code -> PNG data URI (pre-rasterised by the caller)
    var reportDate = opts.reportDate || new Date().toISOString().slice(0, 10);
    var startDate = state.startDate || WC.DEFAULT_START_DATE;
    var yDate = shiftDate(reportDate, -1);

    // True chronological order by kick-off instant (a post-midnight game sorts
    // after the same match day's earlier kick-offs, not before).
    function byTs(a, b) {
      if (a._ts && b._ts) return a._ts - b._ts;
      return (a.kickoff || '').localeCompare(b.kickoff || '');
    }

    // Results: everything completed that's still fresh — yesterday's games plus
    // any that finished earlier today (e.g. an early-hours kick-off that, in the
    // host time zone, is dated today). Without the reportDate case these
    // finished-today games show in neither section.
    var results = state.matches.filter(function (m) {
      return WC.Standings.isFinished(m) && (m.date === yDate || m.date === reportDate);
    }).sort(byTs);

    var fixtures = state.matches.filter(function (m) {
      return m.date === reportDate && !WC.Standings.isFinished(m);
    }).sort(byTs);

    var worst = WC.Standings.worstTeams(state);
    var disc = WC.Standings.disciplinary(state);

    var parts = [];
    var y = 0;

    // -- Header --
    var headH = 168;
    parts.push(rect(M, 40, CW, headH, { rx: T.radius, fill: T.cardFill, stroke: T.cardBorder, sw: 2 }));
    parts.push(rect(M, 40, CW, 10, { rx: 6, fill: T.gold }));     // gold title bar
    parts.push(text(M + PAD, 110, 'World Cup 2026 · Sweepstake', { fill: T.white, size: 40, weight: 'bold' }));
    parts.push(text(M + PAD, 152, 'MORNING REPORT', { fill: T.green, size: 26, weight: 'bold', spacing: 4 }));
    var dn = dayNumber(startDate, reportDate);
    parts.push(text(M + CW - PAD, 100, 'Day ' + dn, { fill: T.gold, size: 32, weight: 'bold', anchor: 'end' }));
    parts.push(text(M + CW - PAD, 138, prettyDate(reportDate), { fill: T.muted, size: 22, anchor: 'end' }));
    parts.push(text(M + CW - PAD, 168, 'Generated ' + (opts.timestamp || new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })), { fill: T.muted, size: 20, anchor: 'end' }));
    y = 40 + headH + 40;

    // -- Latest Results (yesterday + anything finished so far today) --
    y = sectionHeading(parts, y, 'Latest Results') + 8;
    if (results.length) {
      results.forEach(function (m) { y = resultCard(parts, y, m) + 20; });
    } else {
      y = emptyCard(parts, y, 'No completed matches yet') + 20;
    }
    y += 14;

    // -- Knocked Out (teams eliminated by yesterday's / today's results) --
    var koTeams = [];
    [yDate, reportDate].forEach(function (d) {
      WC.Standings.newlyEliminated(state, d).forEach(function (t) { if (koTeams.indexOf(t) === -1) koTeams.push(t); });
    });
    if (koTeams.length) {
      y = sectionHeading(parts, y, 'Knocked Out') + 8;
      var koH = koTeams.length * 40 + 26;
      card(parts, y, koH);
      koTeams.forEach(function (t, i) {
        var ry = y + 38 + i * 40;
        parts.push(text(M + PAD, ry, t, { fill: T.white, size: 28, weight: 'bold' }));
        parts.push(text(M + CW - PAD, ry, 'OUT · ' + WC.ownerOf(t), { fill: T.red, size: 24, weight: 'bold', anchor: 'end' }));
      });
      y += koH + 34;
    }

    // -- Today's Fixtures --
    y = sectionHeading(parts, y, "Today's Fixtures") + 8;
    if (fixtures.length) {
      fixtures.forEach(function (m) { y = fixtureCard(parts, y, m) + 20; });
    } else {
      y = emptyCard(parts, y, 'No fixtures scheduled today') + 20;
    }
    y += 14;

    // -- Worst Teams --
    y = sectionHeading(parts, y, 'Worst Teams · Fewest Points') + 8;
    y = worstTable(parts, y, worst) + 34;

    // -- Disciplinary --
    y = sectionHeading(parts, y, 'Disciplinary Prize') + 6;
    parts.push(text(M, y, 'Red = 3 · Yellow = 1 · most points wins', { fill: T.muted, size: 22 }));
    y += 22;
    y = disciplinaryTable(parts, y, disc.slice(0, 5)) + 30;

    // -- Footer --
    var note = state.footerNote || (fixtures.length ? 'Late kick-offs land in tomorrow’s report.' : 'All confirmed results shown.');
    parts.push(text(W / 2, y + 8, note, { fill: T.muted, size: 22, anchor: 'middle' }));
    y += 50;

    var H = y;
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + T.bgTop + '"/><stop offset="1" stop-color="' + T.bgBottom + '"/>' +
      '</linearGradient></defs>' +
      '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#bg)"/>' +
      parts.join('') +
      '</svg>';

    return { svg: svg, width: W, height: H };
  }

  /* ---- Allocations sheet: who owns which teams, with knock-outs marked ----- */
  function buildAllocations(state, opts) {
    opts = opts || {};
    FLAGS = opts.flags || {};
    var ko = WC.Standings.knockedOut(state);
    var reportDate = opts.reportDate || new Date().toISOString().slice(0, 10);
    var parts = [], y = 0;

    var headH = 150;
    parts.push(rect(M, 40, CW, headH, { rx: T.radius, fill: T.cardFill, stroke: T.cardBorder, sw: 2 }));
    parts.push(rect(M, 40, CW, 10, { rx: 6, fill: T.gold }));
    parts.push(text(M + PAD, 104, 'World Cup 2026 · Sweepstake', { fill: T.white, size: 40, weight: 'bold' }));
    parts.push(text(M + PAD, 144, 'TEAM ALLOCATIONS', { fill: T.green, size: 26, weight: 'bold', spacing: 4 }));
    var totalOut = WC.PLAYERS.reduce(function (n, p) { return n + p.teams.filter(function (t) { return ko[t]; }).length; }, 0);
    parts.push(text(M + CW - PAD, 100, totalOut + ' / ' + (WC.PLAYERS.length * 6) + ' out', { fill: T.gold, size: 32, weight: 'bold', anchor: 'end' }));
    parts.push(text(M + CW - PAD, 138, prettyDate(reportDate), { fill: T.muted, size: 22, anchor: 'end' }));
    y = 40 + headH + 28;

    WC.PLAYERS.forEach(function (p) {
      var nOut = p.teams.filter(function (t) { return ko[t]; }).length;
      var rowH = 98;
      parts.push(rect(M, y, CW, rowH, { rx: 14, fill: T.cardFill, stroke: T.cardBorder, sw: 2 }));
      parts.push(text(M + PAD, y + 42, p.name, { fill: T.gold, size: 30, weight: 'bold' }));
      parts.push(text(M + PAD, y + 74, (6 - nOut) + ' left · ' + nOut + ' out', { fill: nOut ? T.red : T.muted, size: 20, weight: nOut ? 'bold' : 'normal' }));

      var chipsX = M + 232, chipsW = CW - 232 - PAD, n = p.teams.length, cw = chipsW / n, midY = y + rowH / 2;
      p.teams.forEach(function (team, i) {
        var out = !!ko[team];
        var fx = chipsX + i * cw + (cw - 90) / 2;
        var uri = flagFor(team), op = out ? 0.4 : 1;
        if (uri) parts.push('<image x="' + fx + '" y="' + (midY - 18) + '" width="36" height="36" href="' + uri + '" opacity="' + op + '" preserveAspectRatio="xMidYMid meet"/>');
        parts.push(text(fx + 46, midY + 8, WC.abbrOf(team), { fill: out ? T.red : T.white, size: 23, weight: 'bold', opacity: out ? 0.85 : 1 }));
        if (out) parts.push('<line x1="' + (fx - 2) + '" y1="' + (midY + 2) + '" x2="' + (fx + 92) + '" y2="' + (midY + 2) + '" stroke="' + T.red + '" stroke-width="3"/>');
      });
      y += rowH + 16;
    });

    parts.push(text(W / 2, y + 4, 'Teams with a line through are knocked out (group stage or a lost knockout tie).', { fill: T.muted, size: 20, anchor: 'middle' }));
    y += 44;

    var H = y;
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + T.bgTop + '"/><stop offset="1" stop-color="' + T.bgBottom + '"/>' +
      '</linearGradient></defs>' +
      '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#bg)"/>' +
      parts.join('') +
      '</svg>';
    return { svg: svg, width: W, height: H };
  }

  // Render an SVG string to a PNG Blob at the given pixel scale.
  function toPNG(built, scale, cb) {
    scale = scale || 2;
    var blob = new Blob([built.svg], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var img = new Image();
    img.onload = function () {
      var canvas = document.createElement('canvas');
      canvas.width = built.width * scale;
      canvas.height = built.height * scale;
      var ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(function (out) { cb(out); }, 'image/png');
    };
    img.onerror = function () { URL.revokeObjectURL(url); cb(null); };
    img.src = url;
  }

  WC.Report = { build: build, buildAllocations: buildAllocations, toPNG: toPNG };

})(window.WC = window.WC || {});
