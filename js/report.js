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

    // Teams + score
    var ty = y + top + 24;
    parts.push(text(lx, ty, m.home, { fill: homeWin || (!homeWin && !awayWin) ? T.white : T.muted, size: 34, weight: 'bold' }));
    parts.push(text(rx, ty, m.away, { fill: awayWin || (!homeWin && !awayWin) ? T.white : T.muted, size: 34, weight: 'bold', anchor: 'end' }));
    parts.push(text(cx, ty, m.homeScore + ' – ' + m.awayScore, { fill: T.gold, size: 40, weight: 'bold', anchor: 'middle' }));

    // Owners beneath each team
    var oy = ty + 34;
    parts.push(text(lx, oy, WC.ownerOf(m.home), { fill: homeWin ? T.green : T.muted, size: 24, weight: 'bold' }));
    parts.push(text(rx, oy, WC.ownerOf(m.away), { fill: awayWin ? T.green : T.muted, size: 24, weight: 'bold', anchor: 'end' }));

    // Goalscorers
    var sy = oy + 40;
    hLines.forEach(function (ln, i) { parts.push(text(lx, sy + i * 28, ln, { fill: T.muted, size: 22 })); });
    aLines.forEach(function (ln, i) { parts.push(text(rx, sy + i * 28, ln, { fill: T.muted, size: 22, anchor: 'end' })); });

    return y + h;
  }

  // An upcoming-fixture card. Returns the new cursor y.
  function fixtureCard(parts, y, m) {
    var h = 168;
    card(parts, y, h);
    var lx = M + PAD, rx = M + CW - PAD, cx = W / 2;
    var cy = y + 40;

    parts.push(text(lx, cy, m.group || '', { fill: T.muted, size: 22, weight: 'bold', spacing: 2 }));
    parts.push(text(rx, cy, (m.kickoff || '') + (m.kickoff ? ' UK' : ''), { fill: T.gold, size: 22, weight: 'bold', anchor: 'end' }));

    var ty = y + 92;
    parts.push(text(lx, ty, m.home, { fill: T.white, size: 32, weight: 'bold' }));
    parts.push(text(cx, ty, 'vs', { fill: T.muted, size: 26, anchor: 'middle' }));
    parts.push(text(rx, ty, m.away, { fill: T.white, size: 32, weight: 'bold', anchor: 'end' }));

    var oy = ty + 32;
    parts.push(text(lx, oy, WC.ownerOf(m.home), { fill: T.muted, size: 24, weight: 'bold' }));
    parts.push(text(rx, oy, WC.ownerOf(m.away), { fill: T.muted, size: 24, weight: 'bold', anchor: 'end' }));

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
      parts.push(text(cRank, ty, r.rank, { fill: T.gold, size: 26, weight: 'bold' }));
      parts.push(text(cTeam, ty, r.team, { fill: T.white, size: 26, weight: 'bold' }));
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
      if (leading) parts.push(rect(M + 12, ry + 4, CW - 24, rowH - 8, { rx: 12, fill: 'none', stroke: T.gold, sw: 3 }));
      else if (i % 2 === 1) parts.push(rect(M + 12, ry, CW - 24, rowH, { rx: 10, fill: '#0d3225' }));

      var ty = ry + 42;
      parts.push(text(cRank, ty, r.rank, { fill: T.gold, size: 26, weight: 'bold' }));
      parts.push(text(cTeam, ty, r.team, { fill: T.white, size: 26, weight: 'bold' }));
      parts.push(text(cOwner, ty, r.owner, { fill: leading ? T.gold : T.muted, size: 24, weight: leading ? 'bold' : 'normal' }));

      var cx = cChips;
      if (r.red > 0) { cx += chip(parts, cx, ty - 6, r.red, T.red, '#1a0b08') + 10; }
      chip(parts, cx, ty - 6, r.yellow, T.yellow, '#2a2206');

      parts.push(text(cTotal, ty, r.cardPoints, { fill: T.gold, size: 28, weight: 'bold', anchor: 'end' }));

      if (leading) parts.push(text(cTotal, ry + rowH - 6, '★ LEADING', { fill: T.gold, size: 16, weight: 'bold', anchor: 'end', spacing: 1 }));
    });
    return y + h;
  }

  /* ---- top-level build ----------------------------------------------------- */

  function build(state, opts) {
    opts = opts || {};
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
    y = disciplinaryTable(parts, y, disc) + 30;

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

  WC.Report = { build: build, toPNG: toPNG };

})(window.WC = window.WC || {});
