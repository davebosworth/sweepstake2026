/* ============================================================================
 * debug.js — On-page API inspector. Fetches the RAW, unparsed ESPN responses
 * (scoreboard + per-match summary) and shows them in a copyable box so the
 * exact field shapes can be verified — the summary is where xG and the
 * win-probability predictor live.
 *
 * Self-contained: injects its own button + styles, touches nothing else, and
 * can be deleted (with its <script> tag) to remove the feature entirely.
 * A small "⚙ API" button sits bottom-left; it also auto-opens if the URL ends
 * in #debug.
 * ========================================================================== */
(function (WC) {
  'use strict';

  var BASE = (WC.ESPN && WC.ESPN.BASE) ||
    'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';

  function compact(d) { return String(d).replace(/-/g, ''); }      // 2026-06-13 -> 20260613
  function today() {
    if (WC.ESPN && WC.ESPN.localDay) return WC.ESPN.localDay(new Date());
    return new Date().toISOString().slice(0, 10);
  }

  // Raw fetch: keep the response as text so we can show it verbatim even if the
  // body isn't valid JSON (e.g. an allowlist 403 page).
  function fetchRaw(url) {
    return fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.text().then(function (t) { return { status: r.status, ok: r.ok, text: t }; }); })
      .catch(function (e) { return { status: 0, ok: false, text: 'fetch failed: ' + (e && e.message || e) }; });
  }

  function pretty(text) {
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch (e) { return text; }
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  function injectStyles() {
    var css =
      '#dbg-fab{position:fixed;left:10px;bottom:10px;z-index:9998;font:600 12px system-ui,sans-serif;' +
      'background:#0b3a2a;color:#e8c879;border:1px solid #1c5a43;border-radius:8px;padding:7px 11px;cursor:pointer;opacity:.85}' +
      '#dbg-fab:hover{opacity:1}' +
      '#dbg-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:none}' +
      '#dbg-overlay.open{display:block}' +
      '#dbg-panel{position:absolute;inset:0;margin:auto;max-width:760px;width:calc(100% - 16px);height:calc(100% - 16px);' +
      'background:#06231a;border:1px solid #1c5a43;border-radius:12px;display:flex;flex-direction:column;color:#e9f3ee;' +
      'font:13px system-ui,sans-serif;overflow:hidden}' +
      '#dbg-panel h2{margin:0;font-size:14px;color:#e8c879}' +
      '.dbg-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #134132}' +
      '.dbg-head .sp{flex:1}' +
      '.dbg-x{background:none;border:none;color:#e9f3ee;font-size:20px;cursor:pointer;line-height:1}' +
      '.dbg-ctl{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:10px 12px;border-bottom:1px solid #134132}' +
      '.dbg-ctl input,.dbg-ctl select{background:#0b3a2a;color:#e9f3ee;border:1px solid #1c5a43;border-radius:6px;padding:6px 8px;font:13px system-ui,sans-serif}' +
      '.dbg-ctl select{max-width:100%;flex:1 1 180px}' +
      '.dbg-btn{background:#0b3a2a;color:#e8c879;border:1px solid #1c5a43;border-radius:6px;padding:6px 10px;cursor:pointer;font:600 13px system-ui,sans-serif}' +
      '.dbg-btn:disabled{opacity:.5;cursor:default}' +
      '.dbg-msg{padding:4px 12px;color:#9fc7b6;font-size:12px;min-height:16px}' +
      '#dbg-out{flex:1;width:100%;box-sizing:border-box;resize:none;border:none;border-top:1px solid #134132;' +
      'background:#041a13;color:#cfe7dc;font:12px ui-monospace,Menlo,Consolas,monospace;padding:10px;white-space:pre;overflow:auto}';
    document.head.appendChild(el('style', {}, [css]));
  }

  function build() {
    injectStyles();

    var out = el('textarea', { id: 'dbg-out', readonly: 'readonly', spellcheck: 'false', placeholder: 'Raw JSON appears here…' });
    var msg = el('div', { class: 'dbg-msg' }, ['Load a day, pick a match, then “Summary JSON”. The summary is where xG / predictor live.']);
    var dateIn = el('input', { id: 'dbg-date', type: 'text', size: '10' });
    dateIn.value = today();
    var sel = el('select', { id: 'dbg-sel' });
    sel.appendChild(el('option', { value: '' }, ['— load a day first —']));

    var loadBtn = el('button', { class: 'dbg-btn' }, ['Load day']);
    var sbBtn = el('button', { class: 'dbg-btn' }, ['Scoreboard JSON']);
    var sumBtn = el('button', { class: 'dbg-btn' }, ['Summary JSON']);
    var copyBtn = el('button', { class: 'dbg-btn' }, ['Copy']);
    var closeBtn = el('button', { class: 'dbg-x', title: 'Close' }, ['×']);

    function set(text, note) { out.value = text; if (note != null) msg.textContent = note; }
    function busy(b, note) { [loadBtn, sbBtn, sumBtn].forEach(function (x) { x.disabled = b; }); if (note) msg.textContent = note; }

    function loadDay() {
      var url = BASE + '/scoreboard?dates=' + compact(dateIn.value.trim());
      busy(true, 'GET ' + url);
      fetchRaw(url).then(function (r) {
        set('// GET ' + url + '\n// HTTP ' + r.status + '\n\n' + pretty(r.text),
          'HTTP ' + r.status + (r.ok ? ' — scoreboard loaded' : ' — request blocked/failed (see body)'));
        // Populate the match dropdown from the events, if any.
        sel.innerHTML = '';
        var events = [];
        try { events = (JSON.parse(r.text).events) || []; } catch (e) {}
        if (!events.length) {
          sel.appendChild(el('option', { value: '' }, ['— no events for this day —']));
        } else {
          sel.appendChild(el('option', { value: '' }, ['— pick a match (' + events.length + ') —']));
          events.forEach(function (ev) {
            var comp = (ev.competitions && ev.competitions[0]) || {};
            var cs = comp.competitors || [];
            var nm = cs.map(function (c) { return (c.team && (c.team.displayName || c.team.abbreviation)) || '?'; }).join(' v ');
            var st = (comp.status && comp.status.type && comp.status.type.shortDetail) || '';
            sel.appendChild(el('option', { value: ev.id }, [nm + (st ? '  [' + st + ']' : '') + '  #' + ev.id]));
          });
        }
        busy(false);
      });
    }

    function loadSummary() {
      var id = sel.value;
      if (!id) { msg.textContent = 'Pick a match from the dropdown first (or paste an event id there).'; return; }
      var url = BASE + '/summary?event=' + id;
      busy(true, 'GET ' + url);
      fetchRaw(url).then(function (r) {
        set('// GET ' + url + '\n// HTTP ' + r.status + '\n\n' + pretty(r.text),
          'HTTP ' + r.status + (r.ok ? ' — summary loaded (this is the one to paste)' : ' — request blocked/failed (see body)'));
        busy(false);
      });
    }

    function loadScoreboard() {
      var url = BASE + '/scoreboard?dates=' + compact(dateIn.value.trim());
      busy(true, 'GET ' + url);
      fetchRaw(url).then(function (r) {
        set('// GET ' + url + '\n// HTTP ' + r.status + '\n\n' + pretty(r.text), 'HTTP ' + r.status);
        busy(false);
      });
    }

    function copy() {
      out.focus(); out.select();
      var done = function () { var t = copyBtn.textContent; copyBtn.textContent = 'Copied!'; setTimeout(function () { copyBtn.textContent = t; }, 1200); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(out.value).then(done, function () { try { document.execCommand('copy'); done(); } catch (e) {} });
      } else { try { document.execCommand('copy'); done(); } catch (e) {} }
    }

    loadBtn.addEventListener('click', loadDay);
    sbBtn.addEventListener('click', loadScoreboard);
    sumBtn.addEventListener('click', loadSummary);
    sel.addEventListener('change', function () { if (sel.value) loadSummary(); });
    copyBtn.addEventListener('click', copy);

    var panel = el('div', { id: 'dbg-panel' }, [
      el('div', { class: 'dbg-head' }, [el('h2', {}, ['ESPN API inspector']), el('span', { class: 'sp' }, []), copyBtn, closeBtn]),
      el('div', { class: 'dbg-ctl' }, [el('span', {}, ['Date']), dateIn, loadBtn, sumBtn, sbBtn]),
      el('div', { class: 'dbg-ctl' }, [el('span', {}, ['Match']), sel]),
      msg,
      out
    ]);
    var overlay = el('div', { id: 'dbg-overlay' }, [panel]);
    var fab = el('button', { id: 'dbg-fab', title: 'ESPN API inspector' }, ['⚙ API']);

    function open() { overlay.classList.add('open'); }
    function close() { overlay.classList.remove('open'); }
    fab.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

    document.body.appendChild(fab);
    document.body.appendChild(overlay);
    if (/(^|#)debug/.test(location.hash)) open();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();

})(window.WC = window.WC || {});
