/* SubnetPal - drawing board for the Prepare tab. The model and the SVG it draws are pure (tested in Node); mount() wires the board to the page.
   window.Draw / Node. The board is always a light "paper" (white, dark ink) so it looks the same in the app, the PNG and the report. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Draw = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const W = 1000, H = 600, GRID = 10, MIN_W = 30, MIN_H = 20, MAX_ITEMS = 300, MAX_UNDO = 60;
  const TYPES = [
    { t: 'box', l: 'Box', w: 140, h: 70 }, { t: 'round', l: 'Rounded box', w: 140, h: 70 }, { t: 'cloud', l: 'Cloud', w: 160, h: 90 },
    { t: 'fw', l: 'Firewall', w: 90, h: 70 }, { t: 'server', l: 'Server', w: 60, h: 90 }, { t: 'pc', l: 'PC', w: 80, h: 70 },
    { t: 'text', l: 'Text', w: 180, h: 40 },
  ];
  const COLOURS = [
    { c: '#1f2937', l: 'Ink' }, { c: '#4f46e5', l: 'Indigo' }, { c: '#0e7490', l: 'Teal' }, { c: '#15803d', l: 'Green' },
    { c: '#c2410c', l: 'Orange' }, { c: '#dc2626', l: 'Red' },
  ];
  const ICONS = { fw: 1, server: 1, pc: 1 };            // label sits under the drawing
  const byType = t => TYPES.find(x => x.t === t);
  const okColour = c => (/^#[0-9a-f]{6}$/i.test(String(c)) ? String(c).toLowerCase() : COLOURS[0].c);
  const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };
  const snap = v => Math.round(v / GRID) * GRID;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let seq = 0;
  const newId = (b, p) => { let id; do { id = p + (++seq).toString(36) + Math.random().toString(36).slice(2, 5); } while (b.items.some(x => x.id === id) || b.links.some(x => x.id === id)); return id; };

  const empty = () => ({ v: 1, items: [], links: [] });
  // Stored data is untrusted: keep known types, clamp numbers, drop links to missing shapes.
  function normalize(raw) {
    const b = empty();
    if (!raw || typeof raw !== 'object') return b;
    const seen = new Set();
    (Array.isArray(raw.items) ? raw.items : []).slice(0, MAX_ITEMS).forEach(it => {
      if (!it || !byType(it.t)) return;
      const id = String(it.id || '').slice(0, 40); if (!id || seen.has(id)) return; seen.add(id);
      const d = byType(it.t);
      b.items.push({ id, t: it.t, x: num(it.x, 0, -2000, 4000), y: num(it.y, 0, -2000, 4000), w: num(it.w, d.w, MIN_W, 2000), h: num(it.h, d.h, MIN_H, 2000), c: okColour(it.c), label: String(it.label == null ? '' : it.label).slice(0, 400) });
    });
    (Array.isArray(raw.links) ? raw.links : []).forEach(l => {
      if (!l || !seen.has(l.a) || !seen.has(l.b) || l.a === l.b) return;
      const id = String(l.id || '').slice(0, 40); if (!id || seen.has(id)) return; seen.add(id);
      b.links.push({ id, a: l.a, b: l.b, c: okColour(l.c), two: !!l.two });
    });
    return b;
  }
  const clone = b => JSON.parse(JSON.stringify(b));

  // ---- edits (mutate the board, return what was made) ----
  function addItem(b, t, x, y, c) {
    const d = byType(t); if (!d || b.items.length >= MAX_ITEMS) return null;
    const it = { id: newId(b, 'i'), t, x: snap(x), y: snap(y), w: d.w, h: d.h, c: okColour(c), label: t === 'text' ? 'Text' : '' };
    b.items.push(it); return it;
  }
  function addLink(b, a, z, c) {
    if (a === z || !b.items.some(x => x.id === a) || !b.items.some(x => x.id === z)) return null;
    const dup = b.links.find(l => (l.a === a && l.b === z) || (l.a === z && l.b === a));
    if (dup) { if (dup.a === z) dup.two = true; return dup; }         // drawing B->A on top of A->B makes it two-way
    const l = { id: newId(b, 'l'), a, b: z, c: okColour(c), two: false }; b.links.push(l); return l;
  }
  // Delete shapes and links by id; links to a deleted shape go too.
  function remove(b, ids) {
    const gone = new Set(ids);
    b.items = b.items.filter(x => !gone.has(x.id));
    const left = new Set(b.items.map(x => x.id));
    b.links = b.links.filter(l => !gone.has(l.id) && left.has(l.a) && left.has(l.b));
  }
  // Shapes stay on the board (0..W, 0..H) so nothing is dragged out of sight.
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  function move(it, x, y) { it.x = clamp(snap(x), 0, W - it.w); it.y = clamp(snap(y), 0, H - it.h); }
  function resize(it, w, h) { it.w = clamp(snap(w), MIN_W, W - it.x); it.h = clamp(snap(h), MIN_H, H - it.y); }

  // Undo stack of board snapshots (JSON strings). push() before each change; undo() returns the board to restore, or null.
  function history() {
    const past = [];
    return {
      push(b) { const s = JSON.stringify(b); if (past[past.length - 1] !== s) past.push(s); if (past.length > MAX_UNDO) past.shift(); },
      undo() { return past.length ? JSON.parse(past.pop()) : null; },
      get size() { return past.length; },
      clear() { past.length = 0; },
    };
  }

  // ---- geometry ----
  const centre = it => ({ x: it.x + it.w / 2, y: it.y + it.h / 2 });
  // Where the line from the shape's centre towards (tx,ty) leaves its box (+ gap).
  function edgePoint(it, tx, ty, gap) {
    const c = centre(it), dx = tx - c.x, dy = ty - c.y;
    if (!dx && !dy) return c;
    const s = it.t === 'cloud' ? 1 / Math.hypot(dx / (it.w * 0.46), dy / (it.h * 0.42))      // clouds: an ellipse inside the box, so arrows touch the bumps
      : Math.min(dx ? (it.w / 2) / Math.abs(dx) : Infinity, dy ? (it.h / 2) / Math.abs(dy) : Infinity);
    const len = Math.hypot(dx, dy), g = (gap || 0) / len;
    return { x: c.x + dx * (s + g), y: c.y + dy * (s + g) };
  }
  function linkEnds(b, l) {
    const A = b.items.find(x => x.id === l.a), Z = b.items.find(x => x.id === l.b);
    if (!A || !Z) return null;
    const ca = centre(A), cz = centre(Z);
    return { p: edgePoint(A, cz.x, cz.y, 3), q: edgePoint(Z, ca.x, ca.y, 3) };
  }
  // Area the drawing covers (labels under icons included), or null when empty.
  function bounds(b) {
    if (!b.items.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    b.items.forEach(it => { x0 = Math.min(x0, it.x); y0 = Math.min(y0, it.y); x1 = Math.max(x1, it.x + it.w); y1 = Math.max(y1, it.y + it.h + (ICONS[it.t] && it.label ? 22 * wrap(it.label, Math.max(it.w, 120), 14).length : 0)); });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // Word wrap by an average character width (SVG text does not wrap). Long words are cut.
  function wrap(text, width, size) {
    const per = Math.max(1, Math.floor(width / (size * 0.56))), out = [];
    String(text || '').split(/\r?\n/).forEach(para => {
      let line = '';
      para.split(/\s+/).filter(Boolean).forEach(w => {
        while (w.length > per) { if (line) { out.push(line); line = ''; } out.push(w.slice(0, per)); w = w.slice(per); }
        if (!line) line = w; else if ((line + ' ' + w).length <= per) line += ' ' + w; else { out.push(line); line = w; }
      });
      out.push(line);
    });
    while (out.length > 1 && out[out.length - 1] === '') out.pop();
    return out;
  }

  // ---- drawing ----
  const fillOf = c => c + '1f';                         // colour at ~12% for shape fills
  function cloudPath(it) {
    const P = (u, v) => `${(it.x + u * it.w / 100).toFixed(1)} ${(it.y + v * it.h / 60).toFixed(1)}`;
    return `M${P(22, 52)} C${P(6, 52)} ${P(2, 36)} ${P(14, 30)} C${P(10, 14)} ${P(30, 6)} ${P(40, 16)} C${P(46, 2)} ${P(70, 2)} ${P(74, 16)} C${P(90, 12)} ${P(100, 28)} ${P(90, 38)} C${P(98, 50)} ${P(86, 58)} ${P(76, 52)} Z`;
  }
  function shapeSvg(it) {
    const { x, y, w, h } = it, c = it.c, sw = 'stroke-width="2"';
    if (it.t === 'box') return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fillOf(c)}" stroke="${c}" ${sw}/>`;
    if (it.t === 'round') return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.round(Math.min(w, h) * 0.28)}" fill="${fillOf(c)}" stroke="${c}" ${sw}/>`;
    if (it.t === 'cloud') return `<path d="${cloudPath(it)}" fill="${fillOf(c)}" stroke="${c}" ${sw} stroke-linejoin="round"/>`;
    if (it.t === 'text') return '';
    if (it.t === 'fw') {                                // brick wall
      const rows = Math.max(2, Math.round(h / 18)), rh = h / rows, bw = Math.max(16, w / 4);
      let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fillOf(c)}" stroke="${c}" ${sw}/>`;
      for (let r = 1; r < rows; r++) s += `<line x1="${x}" y1="${(y + r * rh).toFixed(1)}" x2="${x + w}" y2="${(y + r * rh).toFixed(1)}" stroke="${c}" stroke-width="1.5"/>`;
      for (let r = 0; r < rows; r++) for (let v = x + (r % 2 ? bw / 2 : bw); v < x + w - 2; v += bw) s += `<line x1="${v.toFixed(1)}" y1="${(y + r * rh).toFixed(1)}" x2="${v.toFixed(1)}" y2="${(y + (r + 1) * rh).toFixed(1)}" stroke="${c}" stroke-width="1.5"/>`;
      return s;
    }
    if (it.t === 'server') {                            // tower with three bays and status lights
      let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fillOf(c)}" stroke="${c}" ${sw}/>`;
      for (let k = 0; k < 3; k++) { const by = y + h * (0.1 + k * 0.28); s += `<rect x="${(x + w * 0.14).toFixed(1)}" y="${by.toFixed(1)}" width="${(w * 0.72).toFixed(1)}" height="${(h * 0.18).toFixed(1)}" rx="2" fill="none" stroke="${c}" stroke-width="1.5"/><circle cx="${(x + w * 0.76).toFixed(1)}" cy="${(by + h * 0.09).toFixed(1)}" r="${Math.max(1.5, Math.min(w, h) * 0.04).toFixed(1)}" fill="${c}"/>`; }
      return s;
    }
    if (it.t === 'pc') {                                // monitor, neck, base
      const mh = h * 0.72;
      return `<rect x="${x}" y="${y}" width="${w}" height="${mh.toFixed(1)}" rx="4" fill="${fillOf(c)}" stroke="${c}" ${sw}/>` +
        `<rect x="${(x + w * 0.08).toFixed(1)}" y="${(y + h * 0.08).toFixed(1)}" width="${(w * 0.84).toFixed(1)}" height="${(mh - h * 0.16).toFixed(1)}" fill="none" stroke="${c}" stroke-width="1"/>` +
        `<line x1="${x + w / 2}" y1="${(y + mh).toFixed(1)}" x2="${x + w / 2}" y2="${(y + h * 0.9).toFixed(1)}" stroke="${c}" ${sw}/>` +
        `<line x1="${(x + w * 0.28).toFixed(1)}" y1="${(y + h * 0.92).toFixed(1)}" x2="${(x + w * 0.72).toFixed(1)}" y2="${(y + h * 0.92).toFixed(1)}" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`;
    }
    return '';
  }
  function labelSvg(it) {
    if (!it.label) return '';
    const size = it.t === 'text' ? 16 : 14, lh = size * 1.25, under = !!ICONS[it.t];
    const width = under ? Math.max(it.w, 120) : it.w - 12, lines = wrap(it.label, width, size);
    const cx = it.x + it.w / 2, top = under ? it.y + it.h + size + 4 : it.y + it.h / 2 - (lines.length - 1) * lh / 2 + size * 0.35;
    const fill = it.t === 'text' ? it.c : '#111318';
    return `<text x="${cx}" y="${top.toFixed(1)}" font-family="system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif" font-size="${size}" font-weight="${it.t === 'text' ? 600 : 500}" fill="${fill}" text-anchor="middle">` +
      lines.map((t, k) => `<tspan x="${cx}" dy="${k ? lh : 0}">${esc(t)}</tspan>`).join('') + '</text>';
  }
  function arrowHead(p, q, c) {
    const a = Math.atan2(q.y - p.y, q.x - p.x), L = 12, s = 0.42;
    const pt = d => `${(q.x - L * Math.cos(a + d)).toFixed(1)},${(q.y - L * Math.sin(a + d)).toFixed(1)}`;
    return `<polygon points="${q.x.toFixed(1)},${q.y.toFixed(1)} ${pt(s)} ${pt(-s)}" fill="${c}"/>`;
  }
  function linkSvg(b, l, sel) {
    const e = linkEnds(b, l); if (!e) return '';
    const { p, q } = e, d = `M${p.x.toFixed(1)} ${p.y.toFixed(1)} L${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
    const back = l.two ? arrowHead(q, p, l.c) : '';
    return `<g data-link="${esc(l.id)}">` + (sel ? `<path d="${d}" stroke="#60a5fa" stroke-width="8" stroke-linecap="round" opacity=".45" fill="none"/>` : '') +
      `<path d="${d}" stroke="${l.c}" stroke-width="2" fill="none"/>${arrowHead(p, q, l.c)}${back}` +
      (sel !== undefined ? `<path d="${d}" stroke="transparent" stroke-width="16" fill="none" class="hit"/>` : '') + '</g>';
  }
  // The board as SVG. opts: { sel: Set of ids (editor), linkFrom: id (connect mode), standalone: true (sized to the drawing, white background, for PNG/report) }
  function svg(b, opts) {
    opts = opts || {};
    const edit = !!opts.edit, sel = opts.sel || new Set();
    const body = b.links.map(l => linkSvg(b, l, edit ? sel.has(l.id) : undefined)).join('') + b.items.map(it => {
      const on = sel.has(it.id), from = opts.linkFrom === it.id;
      let s = `<g data-item="${esc(it.id)}"${edit ? ' class="dshape"' : ''}>`;
      if (edit) s += `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="transparent" class="hit"/>`;
      if (edit && it.t === 'text' && !on) s += `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="none" stroke="#94a3b8" stroke-dasharray="4 4" stroke-width="1"/>`;
      s += shapeSvg(it) + labelSvg(it);
      if (from) s += `<rect x="${it.x - 6}" y="${it.y - 6}" width="${it.w + 12}" height="${it.h + 12}" rx="6" fill="none" stroke="#16a34a" stroke-width="2" stroke-dasharray="6 4"/>`;
      if (on) s += `<rect x="${it.x - 4}" y="${it.y - 4}" width="${it.w + 8}" height="${it.h + 8}" fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-dasharray="5 3"/><rect x="${it.x + it.w - 4}" y="${it.y + it.h - 4}" width="16" height="16" rx="3" fill="#3b82f6" stroke="#fff" stroke-width="2" data-resize="${esc(it.id)}" class="rsz"/>`;
      return s + '</g>';
    }).join('');
    if (!opts.standalone) return body;
    const bb = bounds(b) || { x: 0, y: 0, w: 400, h: 200 }, pad = 24;
    const x = bb.x - pad, y = bb.y - pad, w = Math.ceil(bb.w + pad * 2), h = Math.ceil(bb.h + pad * 2);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(opts.title || 'Site sketch')}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>${body}</svg>`;
  }

  // ---------- page wiring (browser only) ----------
  // host: element to fill. io: { load() -> board, save(board), toast(msg), fileName() }
  function mount(host, io) {
    const doc = host.ownerDocument;
    let b = normalize(io.load()), sel = new Set(), mode = 'select', linkFrom = null, colour = COLOURS[1].c, drag = null, labelUndo = false;
    const hist = history();
    host.innerHTML = `<div class="dtools" role="toolbar" aria-label="Drawing tools">
        <span class="dgrp">${TYPES.map(d => `<button type="button" class="btn sm dbtn" data-add="${d.t}" title="Add ${d.l.toLowerCase()}">${d.l}</button>`).join('')}</span>
        <span class="dgrp"><button type="button" class="btn sm dbtn" data-mode="link" aria-pressed="false" title="Tap a shape, then the shape the arrow points to">Arrow</button></span>
        <span class="dgrp dcols" role="radiogroup" aria-label="Colour">${COLOURS.map(k => `<button type="button" class="dcol" role="radio" data-col="${k.c}" style="--c:${k.c}" aria-label="${k.l}" title="${k.l}"></button>`).join('')}</span>
        <span class="dgrp"><button type="button" class="btn sm dbtn" data-act="del" title="Delete the selection (Delete key)">Delete</button><button type="button" class="btn sm dbtn" data-act="undo" title="Undo (Ctrl+Z)">Undo</button><button type="button" class="btn sm dbtn" data-act="png">Export PNG</button><button type="button" class="btn sm dbtn danger" data-act="clear">Clear</button></span>
      </div>
      <label class="fld dlabel">Text on the selected shape<input data-label autocomplete="off" spellcheck="true" placeholder="Select a shape, then type its label" disabled></label>
      <p class="hint dmsg" role="status"></p>
      <div class="dwrap"><svg class="dboard" viewBox="0 0 ${W} ${H}" tabindex="0" role="application" aria-label="Drawing board. Add shapes with the buttons above. Drag to move, drag the blue corner to resize."></svg></div>`;
    const svgEl = host.querySelector('svg'), lab = host.querySelector('[data-label]'), msg = host.querySelector('.dmsg');
    const say = t => { msg.textContent = t || ''; };
    const commit = () => io.save(clone(b));
    const change = fn => { hist.push(b); fn(); commit(); render(); };
    function render() {
      svgEl.innerHTML = `<defs><pattern id="dgrid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#e5e7eb" stroke-width="1"/></pattern></defs><rect x="-4000" y="-4000" width="10000" height="10000" fill="url(#dgrid)" class="bg"/>` + svg(b, { edit: true, sel, linkFrom });
      host.querySelectorAll('[data-col]').forEach(k => { const on = k.dataset.col === colour; k.classList.toggle('on', on); k.setAttribute('aria-checked', String(on)); });
      const lk = host.querySelector('[data-mode="link"]'); lk.classList.toggle('primary', mode === 'link'); lk.setAttribute('aria-pressed', String(mode === 'link'));
      const one = sel.size === 1 ? b.items.find(x => sel.has(x.id)) : null;
      lab.disabled = !one; if (doc.activeElement !== lab) lab.value = one ? one.label : '';
      host.querySelector('[data-act="undo"]').disabled = !hist.size;
      host.querySelector('[data-act="del"]').disabled = !sel.size;
    }
    const pt = e => { const m = svgEl.getScreenCTM(); if (!m) return { x: 0, y: 0 }; const p = svgEl.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const r = p.matrixTransform(m.inverse()); return { x: r.x, y: r.y }; };
    // New shapes go near the middle, stepping down-right so they do not stack exactly.
    let nth = 0;
    host.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t || !host.contains(t)) return;
      if (t.dataset.add) {
        const d = byType(t.dataset.add), k = nth++ % 8;
        let it; change(() => { it = addItem(b, d.t, W / 2 - d.w / 2 - 120 + k * 30, H / 2 - d.h / 2 - 90 + k * 25, d.t === 'text' ? COLOURS[0].c : colour); });
        if (it) { sel = new Set([it.id]); mode = 'select'; linkFrom = null; render(); if (d.t === 'text') { lab.focus(); lab.select(); } } else say('The board is full.');
      } else if (t.dataset.mode === 'link') {
        mode = mode === 'link' ? 'select' : 'link'; linkFrom = null; sel.clear(); render(); say(mode === 'link' ? 'Arrow: tap the shape it starts from, then the shape it points to. Tap Arrow again to stop.' : '');
      } else if (t.dataset.col) {
        colour = t.dataset.col;
        if (sel.size) change(() => { b.items.concat(b.links).forEach(x => { if (sel.has(x.id)) x.c = colour; }); }); else render();
      } else if (t.dataset.act === 'del') del();
      else if (t.dataset.act === 'undo') undo();
      else if (t.dataset.act === 'clear') {
        if (!b.items.length) return;
        if (!t.dataset.armed) { t.dataset.armed = '1'; t.textContent = 'Clear all?'; setTimeout(() => { if (t.isConnected) { delete t.dataset.armed; t.textContent = 'Clear'; } }, 3000); return; }
        delete t.dataset.armed; t.textContent = 'Clear'; change(() => { b = empty(); }); sel.clear(); render(); say('Cleared. Undo brings it back.');
      } else if (t.dataset.act === 'png') exportPng();
    });
    function del() { if (!sel.size) return; change(() => remove(b, Array.from(sel))); sel.clear(); render(); }
    function undo() { const prev = hist.undo(); if (!prev) return; b = normalize(prev); sel = new Set(Array.from(sel).filter(id => b.items.some(x => x.id === id) || b.links.some(x => x.id === id))); commit(); render(); }
    lab.addEventListener('focus', () => { labelUndo = false; });
    lab.addEventListener('input', () => {
      const one = sel.size === 1 ? b.items.find(x => sel.has(x.id)) : null; if (!one) return;
      if (!labelUndo) { hist.push(b); labelUndo = true; }
      one.label = lab.value.slice(0, 400); commit(); render();
    });
    lab.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); svgEl.focus(); } });
    svgEl.addEventListener('keydown', e => {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); del(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if (e.key === 'Escape') { sel.clear(); linkFrom = null; render(); }
      else if (sel.size && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) >= 0) {
        e.preventDefault(); const dx = e.key === 'ArrowLeft' ? -GRID : e.key === 'ArrowRight' ? GRID : 0, dy = e.key === 'ArrowUp' ? -GRID : e.key === 'ArrowDown' ? GRID : 0;
        change(() => b.items.forEach(it => { if (sel.has(it.id)) move(it, it.x + dx, it.y + dy); }));
      }
    });
    svgEl.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      const p = pt(e), rz = e.target.closest('[data-resize]'), g = e.target.closest('[data-item]'), lk = e.target.closest('[data-link]');
      svgEl.focus({ preventScroll: true });
      if (mode === 'link') {
        if (!g) { linkFrom = null; render(); return; }
        const id = g.dataset.item;
        if (!linkFrom) { linkFrom = id; say('Now tap the shape the arrow points to.'); render(); return; }
        if (linkFrom !== id) { const from = linkFrom; change(() => addLink(b, from, id, colour)); say('Arrow added. Tap another start shape, or tap Arrow to stop.'); }
        linkFrom = null; render(); return;
      }
      if (rz) { const it = b.items.find(x => x.id === rz.dataset.resize); if (it) drag = { kind: 'size', it, p, w: it.w, h: it.h, snap: JSON.stringify(b), moved: false }; }
      else if (g) {
        const id = g.dataset.item;
        if (e.shiftKey) { if (sel.has(id)) sel.delete(id); else sel.add(id); } else if (!sel.has(id)) sel = new Set([id]);
        drag = { kind: 'move', p, start: b.items.filter(x => sel.has(x.id)).map(x => ({ it: x, x: x.x, y: x.y })), snap: JSON.stringify(b), moved: false };
      } else if (lk) { sel = new Set([lk.dataset.link]); drag = null; }
      else { sel.clear(); drag = null; }
      if (drag) { try { svgEl.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } e.preventDefault(); }
      render();
    });
    svgEl.addEventListener('pointermove', e => {
      if (!drag) return;
      const p = pt(e), dx = p.x - drag.p.x, dy = p.y - drag.p.y;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      drag.moved = true;
      if (drag.kind === 'move') drag.start.forEach(s => move(s.it, s.x + dx, s.y + dy)); else resize(drag.it, drag.w + dx, drag.h + dy);
      render();
    });
    const end = () => { if (!drag) return; if (drag.moved) { hist.push(JSON.parse(drag.snap)); commit(); } drag = null; render(); };
    svgEl.addEventListener('pointerup', end); svgEl.addEventListener('pointercancel', end);
    function exportPng() {
      if (!b.items.length) { say('Nothing to export yet.'); return; }
      const s = svg(b, { standalone: true }), m = /width="(\d+)" height="(\d+)"/.exec(s.slice(0, 400)), w = +m[1], h = +m[2], k = 2;
      const img = new Image();
      img.onload = () => {
        const cv = doc.createElement('canvas'); cv.width = w * k; cv.height = h * k;
        const cx = cv.getContext('2d'); cx.scale(k, k); cx.drawImage(img, 0, 0, w, h);
        cv.toBlob(blob => {
          if (!blob) { say('PNG export failed in this browser.'); return; }
          const a = doc.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (io.fileName ? io.fileName() : 'sketch') + '.png';
          doc.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          say('PNG downloaded.');
        }, 'image/png');
      };
      img.onerror = () => say('PNG export failed in this browser.');
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
    }
    render();
    return {
      reload() { b = normalize(io.load()); sel.clear(); linkFrom = null; mode = 'select'; hist.clear(); say(''); render(); },
    };
  }

  return { W, H, TYPES, COLOURS, empty, normalize, clone, addItem, addLink, remove, move, resize, history, edgePoint, linkEnds, bounds, wrap, svg, mount };
}));
