/* Bob in the Lab: a side panel in the FortiOS mock with "Check my ..." buttons.
   Each button runs BobCheck (../bobcheck.js, offline rules) on the mock's saved config for that area,
   shows findings by severity with CLI fixes, and "Ask real Bob" copies only that area with a focused prompt. */
(function () {
  'use strict';
  const B = window.BobCheck, fm = () => window.__fm || {};
  if (!B) return;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const full = () => { try { return fm().cli.full(); } catch (e) { return ''; } };
  const client = () => { try { const s = parent !== window && parent.SubnetPal && parent.SubnetPal.state, c = s && s.clients && s.clients[s.current]; return (c && c.name) || ''; } catch (e) { return ''; } };
  function copy(text, btn, done) {
    const was = btn.textContent, ok = () => { btn.textContent = done; setTimeout(() => { btn.textContent = was; }, 1800); };
    const fall = () => { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) { /* ignore */ } t.remove(); ok(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fall); else fall();
  }

  const css = document.createElement('style');
  css.textContent = `#bobbtn{position:fixed;right:14px;bottom:64px;z-index:77;background:#407f4d;color:#fff;border:0;border-radius:18px;padding:7px 14px;font:600 13px system-ui,sans-serif;box-shadow:0 2px 10px #00000040;cursor:pointer}
#bobbtn:hover{background:#2f6b3b}body:has(#ov.on) #bobbtn,body:has(#cli.on) #bobbtn,body:has(#bobp.on) #bobbtn{display:none}
#bobp{position:fixed;top:41px;right:0;bottom:0;width:min(460px,100vw);background:#fff;box-shadow:-4px 0 14px #00000059;z-index:76;display:none;flex-direction:column;font:13px system-ui,sans-serif;color:#222}
#bobp.on{display:flex}#bobp .bh{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #ddd;background:#f4f4f4}
#bobp .av{width:30px;height:30px;border-radius:50%;background:#407f4d;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700}
#bobp .bh b{font-size:14px}#bobp .bh small{display:block;color:#666;font-size:11px}#bobp .bx{margin-left:auto;cursor:pointer;font-size:16px;color:#555;background:none;border:0}
#bobp .bb{flex:1;overflow:auto;padding:12px 14px}#bobp .bgrid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px}
#bobp .bgrid button{border:1px solid #bbb;background:#fff;border-radius:4px;padding:7px 8px;text-align:left;cursor:pointer;font:inherit}
#bobp .bgrid button:hover,#bobp .bgrid button.on{border-color:#407f4d;background:#f2f8f3}#bobp .bgrid .all{grid-column:1/-1;text-align:center;font-weight:600}
#bobp .say{background:#f2f8f3;border-left:3px solid #407f4d;padding:8px 10px;margin:0 0 10px;border-radius:0 4px 4px 0}
#bobp .bcnt{display:flex;gap:6px;margin:0 0 10px}#bobp .sv{display:inline-block;border-radius:3px;padding:1px 7px;font-size:11px;font-weight:700;color:#fff}
#bobp .sv.High{background:#c0392b}#bobp .sv.Medium{background:#d68910}#bobp .sv.Low{background:#2e86c1}
#bobp .fd{border:1px solid #ddd;border-radius:4px;padding:8px 10px;margin:0 0 8px}#bobp .fd.High{border-left:4px solid #c0392b}#bobp .fd.Medium{border-left:4px solid #d68910}#bobp .fd.Low{border-left:4px solid #2e86c1}
#bobp .fd .t{font-weight:600;margin:0 0 3px}#bobp .fd .w{color:#444;margin:0 0 4px}#bobp .fd .s{color:#888;font-size:11px;text-transform:uppercase;margin-left:6px}
#bobp pre{background:#1e1e1e;color:#e6e6e6;padding:6px 8px;border-radius:3px;margin:4px 0;white-space:pre-wrap;font:12px Consolas,monospace}
#bobp .fa{display:flex;gap:6px}#bobp .fa button,#bobp .bf button{border:1px solid #bbb;background:#fff;border-radius:3px;padding:3px 8px;cursor:pointer;font:12px system-ui,sans-serif}
#bobp .fa button:hover,#bobp .bf button:hover{border-color:#407f4d}#bobp .ok{color:#2f6b3b;margin:2px 0}#bobp details{margin:8px 0}#bobp summary{cursor:pointer;color:#555}
#bobp .bf{display:flex;gap:6px;flex-wrap:wrap;padding:10px 14px;border-top:1px solid #ddd;background:#fafafa}#bobp .bf .real{background:#407f4d;color:#fff;border-color:#407f4d;font-weight:600}
#bobp .note{color:#777;font-size:11px;margin:10px 0 0}`;
  document.head.appendChild(css);

  const btn = document.createElement('button');
  btn.id = 'bobbtn'; btn.type = 'button'; btn.textContent = '\u{1F9D1}‍\u{1F527} Ask Bob'; btn.title = 'Bob checks one area of this config';
  const p = document.createElement('div');
  p.id = 'bobp';
  p.innerHTML = `<div class="bh"><span class="av">B</span><div><b>Bob · check my work</b><small>Offline rule checks on this config. Nothing leaves the browser.</small></div><button class="bx" type="button" data-bob="close" title="Close">✕</button></div>
<div class="bb"><div class="bgrid">${B.SECTIONS.map(s => `<button type="button" data-sec="${s.id}">${esc(s.label)}</button>`).join('')}<button type="button" class="all" data-sec="all">Check everything</button></div><div data-out><p class="say">Pick an area and I'll go through it like a review: what breaks first, then what I'd tidy. Each fix is FortiOS CLI you can copy or run in the console.</p></div></div>
<div class="bf"><button type="button" data-bob="again" disabled>↻ Check again</button><button type="button" class="real" data-bob="real" disabled>➜ Ask real Bob</button></div>`;
  document.body.appendChild(btn); document.body.appendChild(p);
  const out = p.querySelector('[data-out]'), real = p.querySelector('[data-bob="real"]'), again = p.querySelector('[data-bob="again"]');
  let cur = null, last = null;

  function verdict(c) {
    if (c.High) return `Fix the ${c.High} High one${c.High > 1 ? 's' : ''} before this goes near a real box.`;
    if (c.Medium) return `Nothing that breaks it. ${c.Medium} thing${c.Medium > 1 ? 's' : ''} I'd fix before handover.`;
    if (c.Low) return 'Looks solid. Just some tidying.';
    return 'Clean. Nothing to flag here.';
  }
  function run(id) {
    cur = id;
    p.querySelectorAll('.bgrid button').forEach(b => b.classList.toggle('on', b.dataset.sec === id));
    const text = full();
    if (!text) { out.innerHTML = '<p class="say">I can\'t read the config yet. Give the Lab a second to load and try again.</p>'; return; }
    const r = B.check(text, id), s = B.SECTIONS.find(z => z.id === id), many = id === 'all';
    last = r;
    const label = many ? 'Everything' : s.short;
    out.innerHTML = `<p class="say"><b>${esc(label)}:</b> ${esc(verdict(r.counts))}</p>
<div class="bcnt">${['High', 'Medium', 'Low'].map(k => `<span class="sv ${k}">${r.counts[k]} ${k}</span>`).join('')}</div>
${r.findings.map((f, i) => `<div class="fd ${f.sev}"><p class="t"><span class="sv ${f.sev}">${f.sev}</span> ${esc(f.title)}${many ? `<span class="s">${esc(f.section)}</span>` : ''}</p>${f.why ? `<p class="w">${esc(f.why)}</p>` : ''}${f.fix ? `<pre>${esc(f.fix)}</pre><div class="fa"><button type="button" data-copy="${i}">⧉ Copy fix</button>${/<[^>]+>/.test(f.fix) ? '' : `<button type="button" data-run="${i}" title="Type this fix into the CLI console">▶ Run in console</button>`}</div>` : ''}</div>`).join('')}
${r.passed.length ? `<details${r.findings.length ? '' : ' open'}><summary>✔ ${r.passed.length} check${r.passed.length > 1 ? 's' : ''} passed</summary>${r.passed.map(x => `<p class="ok">✔ ${esc(x.title)}${many ? ` <span class="s">${esc(x.section)}</span>` : ''}</p>`).join('')}</details>` : ''}
<p class="note">Rule-based checks, not the real Bob. Fixes with &lt;angle brackets&gt; need your values first. Generated, untested: verify on the lab VM.</p>`;
    again.disabled = false; real.disabled = false;
    real.textContent = many ? '➜ Send full config to Bob' : `➜ Ask real Bob about ${s.short.toLowerCase()}`;
  }
  p.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.sec) return run(t.dataset.sec);
    if (t.dataset.bob === 'close') { p.classList.remove('on'); return; }
    if (t.dataset.bob === 'again' && cur) return run(cur);
    if (t.dataset.bob === 'real' && cur) {
      if (cur === 'all') { const sb = document.querySelector('#cli [data-cli="bob"]'); if (sb) { sb.click(); real.textContent = '✔ Copied, paste it to Bob'; setTimeout(() => { real.textContent = '➜ Send full config to Bob'; }, 1800); } return; }
      return copy(B.prompt(full(), cur, client()), t, '✔ Copied, paste it to Bob');
    }
    if (t.dataset.copy && last) return copy(last.findings[Number(t.dataset.copy)].fix, t, '✔ Copied');
    if (t.dataset.run && last) {
      const cli = fm().cli; if (!cli) return;
      cli.open();
      last.findings[Number(t.dataset.run)].fix.split('\n').map(l => l.trim()).filter(Boolean).forEach(l => cli.run(l));
      p.classList.add('on'); run(cur);
    }
  });
  const open = () => { const lp = document.getElementById('labp'); if (lp) lp.classList.remove('on'); p.classList.add('on'); };   // the lab brief panel sits in the same place
  btn.addEventListener('click', open);
  // Also in the CLI console header, next to Send to Bob.
  const hdr = document.querySelector('#cli .ch [data-cli="bob"]');
  if (hdr) { const a = document.createElement('span'); a.style.cssText = 'cursor:pointer;margin-left:14px'; a.title = 'Bob checks one area of this config'; a.textContent = '\u{1F9D1}‍\u{1F527} Ask Bob'; a.addEventListener('click', e => { e.stopPropagation(); open(); }); hdr.insertAdjacentElement('afterend', a); }
  fm().bob = { open, run, close: () => p.classList.remove('on') };
})();
