(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const KEY = 'subnetpal.v2';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const color = i => `hsl(${(i * 47 + 205) % 360} 62% 58%)`;
  const rng = Fmt.rng;
  const SECTIONS = ['plan', 'diagram', 'handover', 'export'];
  const isPhone = () => matchMedia('(max-width: 899px)').matches;

  // ---------- storage ----------
  let store = { current: null, clients: {} };
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (raw && raw.clients) { store = raw; if (!store.clients[store.current]) store.current = null; }
    } catch (e) { /* ignore */ }
  }
  let saveT;
  function save() { clearTimeout(saveT); saveT = setTimeout(saveNow, 250); }
  function saveNow() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* private mode / full */ } }
  const cur = () => store.clients[store.current];
  const project = () => Intake.toProject(cur());

  // ---------- state ----------
  let result = null;
  let openSec = null;
  let outView = 'forti';
  const openCards = new Set();

  // ---------- toast ----------
  let toastT;
  function toast(msg) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------- clients ----------
  function renderClientSel() {
    const list = Object.values(store.clients).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    $('#clientSel').innerHTML = list.map(c => `<option value="${esc(c.id)}"${c.id === store.current ? ' selected' : ''}>${esc(c.name || 'New client')}${c.site ? ' · ' + esc(c.site) : ''}</option>`).join('');
    $('#samples').innerHTML = Object.keys(Intake.SAMPLES).map(k => `<button class="btn sm" type="button" data-sample="${esc(k)}">+ ${esc(k)}</button>`).join('');
  }
  function selectClient(id) {
    store.current = id;
    const c = cur();
    Intake.migrate(c);
    Intake.applyIntake(c);
    openCards.clear();
    renderClientSel(); renderIntake(); recalc();
  }
  function addClient(c) {
    c.updated = Date.now(); store.clients[c.id] = c; selectClient(c.id);
  }
  function bindClients() {
    $('#clientSel').addEventListener('change', e => selectClient(e.target.value));
    $('#btnNew').addEventListener('click', () => {
      addClient(Intake.newClient('New client'));
      setSideCollapsed(false); const n = $('#i-name'); n.focus(); n.select();
    });
    $('#btnDup').addEventListener('click', () => {
      const copy = JSON.parse(JSON.stringify(cur())); copy.id = Math.random().toString(36).slice(2, 9); copy.name = (copy.name || 'Client') + ' (copy)';
      addClient(copy);
    });
    $('#btnDel').addEventListener('click', () => {
      const c = cur(); if (!c || !confirm(`Delete "${c.name || 'this client'}"? This cannot be undone.`)) return;
      delete store.clients[c.id];
      const left = Object.values(store.clients).sort((a, b) => (b.updated || 0) - (a.updated || 0));
      if (left.length) selectClient(left[0].id); else addClient(Intake.newClient('New client'));
      save();
    });
    $('#samples').addEventListener('click', e => { const b = e.target.closest('[data-sample]'); if (b) addClient(Intake.sampleClient(b.dataset.sample)); });
  }

  // ---------- intake (left panel) ----------
  function buildReqs() {
    $('#reqs').innerHTML = Intake.OPTIONAL.map(o => `<div class="reqrow" data-row="${o.key}">
      <label class="check"><input type="checkbox" data-req="${o.key}"> ${esc(o.label)}</label>
      <input class="cnt" data-count="${o.key}" inputmode="numeric" autocomplete="off" placeholder="How many ${esc(o.unit)}?" aria-label="Number of ${esc(o.unit)}" hidden>
    </div>`).join('');
  }
  function renderIntake() {
    const c = cur(), it = c.intake;
    $('#i-name').value = c.name || ''; $('#i-site').value = c.site || '';
    $('#c-staff').value = it.counts.staff || '';
    Intake.OPTIONAL.forEach(o => {
      const on = !!it.req[o.key];
      $(`[data-req="${o.key}"]`).checked = on;
      const cnt = $(`[data-count="${o.key}"]`); cnt.hidden = !on; cnt.value = it.counts[o.key] || '';
    });
    $('#i-existing').value = it.existing || ''; $('#i-wan').value = it.wanNote || '';
    $('#i-style').value = c.opts.style === 'packed' ? 'packed' : 'vlan24';
    $('#i-parent').value = c.parentAuto === false ? c.parent : '';
    const v6 = c.v6 || { enabled: false, prefix: '' };
    $('#v6-on').checked = !!v6.enabled; $('#v6-prefix').value = v6.prefix || '';
    $('#v6-prefix').disabled = $('#v6-new').disabled = !v6.enabled;
    renderExpansion();
  }
  function renderExpansion() {
    const e = cur().intake.expansion;
    $$('#expansion .opt').forEach(b => { const on = b.dataset.exp === e; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  }
  function touch() { cur().updated = Date.now(); save(); }
  // Fields that change the network list re-run the intake; the rest only re-plan.
  function onIntake(e) {
    const t = e.target, c = cur(), it = c.intake; let replan = false;
    if (t.id === 'i-name') c.name = t.value;
    else if (t.id === 'i-site') c.site = t.value;
    else if (t.id === 'i-wan') it.wanNote = t.value;
    else if (t.id === 'c-staff') { it.counts.staff = t.value; replan = true; }
    else if (t.dataset.count) { it.counts[t.dataset.count] = t.value; replan = true; }
    else if (t.dataset.req) {
      it.req[t.dataset.req] = t.checked; replan = true;
      const cnt = $(`[data-count="${t.dataset.req}"]`); cnt.hidden = !t.checked;
      if (t.checked) cnt.focus();
    } else if (t.id === 'i-existing') { it.existing = t.value; replan = true; }
    else if (t.id === 'i-style') { c.opts.style = t.value; replan = true; }
    else if (t.id === 'i-parent') { const v = t.value.trim(); c.parentAuto = v === ''; if (v) c.parent = v; replan = true; }
    else if (t.id === 'v6-on') {
      c.v6 = c.v6 || { enabled: false, prefix: '' }; c.v6.enabled = t.checked;
      if (c.v6.enabled && !String(c.v6.prefix).trim()) c.v6.prefix = Calc6.generateUla();
      $('#v6-prefix').value = c.v6.prefix; $('#v6-prefix').disabled = $('#v6-new').disabled = !c.v6.enabled;
    } else if (t.id === 'v6-prefix') { c.v6 = c.v6 || { enabled: true, prefix: '' }; c.v6.prefix = t.value; }
    else return;
    if (replan) Intake.applyIntake(c);
    touch(); recalc(); if (t.id === 'i-name' || t.id === 'i-site') renderClientSel();
  }
  function bindIntake() {
    const body = $('#sidebody');
    body.addEventListener('input', onIntake);
    $('#expansion').addEventListener('click', e => {
      const b = e.target.closest('.opt'); if (!b) return;
      cur().intake.expansion = b.dataset.exp; Intake.applyIntake(cur()); renderExpansion(); touch(); recalc();
    });
    $('#v6-new').addEventListener('click', () => { const c = cur(); c.v6.prefix = Calc6.generateUla(); $('#v6-prefix').value = c.v6.prefix; touch(); recalc(); });
    $('#sumBtn').addEventListener('click', () => { setSideCollapsed(!$('#side').classList.contains('collapsed')); if (!$('#side').classList.contains('collapsed')) window.scrollTo(0, 0); });
    $('#btnDone').addEventListener('click', () => { setSideCollapsed(true); window.scrollTo(0, 0); });
  }
  function setSideCollapsed(v) {
    $('#side').classList.toggle('collapsed', v);
    $('#sumBtn').setAttribute('aria-expanded', String(!v));
  }
  function renderSumLine() {
    const c = cur(), n = result && result.ok ? result.allocations.length : c.networks.length;
    $('#sumText').textContent = `Client: ${c.name || 'New client'} · ${n} network${n === 1 ? '' : 's'}`;
  }
  function renderV6Msg() {
    const el = $('#v6-msg'), c = cur(), r = result;
    el.textContent = !c.v6 || !c.v6.enabled ? 'IPv6 is off. Outputs stay IPv4 only.' : r && r.v6Error ? r.v6Error : r && r.v6 ? `${r.v6.kind === 'ULA' ? 'Private (ULA)' : 'Global'} site prefix. Each network gets a /64, numbered from its VLAN.` : '';
    el.className = 'hint' + (r && r.v6Error ? ' bad' : '');
  }

  // ---------- results (right panel) ----------
  // One warning banner, only when something is wrong.
  function renderWarn() {
    const items = [];
    if (result.conflicts && result.conflicts.length) items.push(...result.conflicts);
    if (!result.ok) items.push(...result.errors.map(e => e.msg));
    if (result.styleNote) items.push(result.styleNote);
    if (result.v6Error) items.push('IPv6: ' + result.v6Error);
    $('#warn').innerHTML = items.length ? `<div class="banner"><b>⚠ Check this</b><ul>${items.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>` : '';
  }
  function renderSummaries() {
    const c = cur(), ok = result.ok, n = ok ? result.allocations.length : 0;
    $('#sum-plan').textContent = ok ? `${n} networks · ${result.parent.cidr} · ${result.style === 'vlan24' ? 'one /24 per VLAN' : 'packed'}` : 'Cannot build the plan yet';
    $('#sum-diagram').textContent = ok ? `Internet, firewall and ${n} networks` : 'Waiting for a valid plan';
    $('#sum-handover').textContent = ok ? `For ${c.name || 'the client'}${c.site ? ' · ' + c.site : ''}` : 'Waiting for a valid plan';
    $('#sum-export').textContent = 'FortiOS CLI · CSV · text';
  }

  const typeOf = a => (a.role === 'Transit' ? 'Transit' : a.role === 'Loopback' ? 'Loopback' : a.vlan !== '' ? `VLAN ${a.vlan}` : 'Port');
  function renderCards() {
    const box = $('#cards');
    if (!result.ok) { box.innerHTML = '<p class="hint">Fix the problem above to see the networks.</p>'; return; }
    const names = cur().networks.map(n => String(n.name).trim());
    const list = result.allocations.slice().sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name));
    box.innerHTML = list.map(a => {
      const ci = Math.max(0, names.indexOf(a.name));
      const extra = [
        ['DHCP range', rng(a.dhcpStart, a.dhcpEnd) || 'None'], ['Static range', rng(a.staticStart, a.staticEnd) || 'None'],
        ['Broadcast', a.broadcast || 'None'], ['Wildcard', a.wildcard], ['Total / usable hosts', `${a.totalAddresses.toLocaleString()} / ${a.usableHosts.toLocaleString()}`],
      ];
      if (a.v6) extra.push(['IPv6 subnet', a.v6.cidr], ['IPv6 gateway', a.v6.address]);
      return `<details class="ncard" data-name="${esc(a.name)}"${openCards.has(a.name) ? ' open' : ''}>
        <summary>
          <span class="nt"><span class="swatch" style="background:${color(ci)}"></span><b>${esc(a.name)}</b><span class="ntype">${esc(typeOf(a))}</span><span class="chev" aria-hidden="true">▾</span></span>
          <dl class="nf">
            <div><dt>Usable range</dt><dd class="mono">${esc(Fmt.usable(a))}</dd></div>
            <div><dt>Port / gateway IP</dt><dd class="mono">${esc(a.gateway || a.firstUsable || '-')}</dd></div>
            <div><dt>Netmask</dt><dd class="mono">${esc(a.netmask)}</dd></div>
          </dl>
        </summary>
        <dl class="nf extra">${extra.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="mono">${esc(v)}</dd></div>`).join('')}</dl>
      </details>`;
    }).join('');
  }
  function renderGaps() {
    const box = $('#gaps');
    if (!result.ok) { box.innerHTML = ''; return; }
    const s = result.summary, gn = cur().genNotes || [];
    box.innerHTML = `<p>${s.used.toLocaleString()} of ${s.parentSize.toLocaleString()} addresses used (${s.percentUsed}%). ${s.free.toLocaleString()} left${s.largestFree ? `, largest free block <b class="mono">${esc(s.largestFree.cidr)}</b>` : ''}.</p>` +
      (s.reserved ? `<p class="dim">${s.reserved.toLocaleString()} addresses are existing ranges and were skipped.</p>` : '') +
      (result.gaps.length ? result.gaps.map(g => `<p class="mono small">${esc(Calc.intToIp(g.start))} - ${esc(Calc.intToIp(g.end))} · ${g.size.toLocaleString()} addresses · ${esc(g.cidrs.map(c => c.cidr).join(', '))}${g.between ? ' · gap between networks' : ' · free at the end'}</p>`).join('') : '<p class="hint">The block is completely allocated.</p>') +
      (gn.length ? `<ul class="notes">${gn.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : '');
  }
  function renderMap() {
    const map = $('#map'), legend = $('#legend');
    if (!result.ok || !result.parent || !result.allocations.length) { map.innerHTML = ''; legend.innerHTML = ''; return; }
    const par = result.parent, fit = $('#fitUsed').checked;
    const names = cur().networks.map(n => String(n.name).trim());
    const ex = result.conflicts && result.conflicts.length ? Calc.mergeRanges(project().existing.map(Calc.parseCidr).filter(e => !e.error && e.start <= par.end && e.end >= par.start).map(e => ({ start: Math.max(e.start, par.start), end: Math.min(e.end, par.end) }))) : [];
    let span = par.size;
    if (fit) { const maxEnd = Math.max.apply(null, result.allocations.map(a => a.end).concat(ex.map(e => e.end))); span = maxEnd + 1 - par.start; }
    const segs = result.allocations.map(a => {
      const ci = Math.max(0, names.indexOf(a.name));
      const left = (a.start - par.start) / span * 100, w = Math.max(a.size / span * 100, 0.4);
      return `<div class="seg" style="left:${left}%;width:${w}%;background:${color(ci)}" title="${esc(a.name)} ${esc(a.cidr)}">${w > 9 ? `<span>${esc(a.name)}</span>` : ''}</div>`;
    }).join('') + ex.map(e => `<div class="seg existing" style="left:${(e.start - par.start) / span * 100}%;width:${(e.end - e.start + 1) / span * 100}%" title="Existing range"></div>`).join('');
    map.innerHTML = `<div class="bar" role="img" aria-label="Address map of ${esc(par.cidr)}">${segs}</div>
      <div class="axis"><span class="mono">${esc(par.network)}</span><span class="mono">${esc(Calc.intToIp(par.start + span - 1))}</span></div>`;
    legend.innerHTML = result.allocations.map(a => {
      const ci = Math.max(0, names.indexOf(a.name));
      return `<div><span class="swatch" style="background:${color(ci)}"></span><span><b>${esc(a.name)}</b></span></div>`;
    }).join('') + (ex.length ? '<div><span class="swatch existing"></span><span>Existing range (in use)</span></div>' : '');
  }

  function topoCols() { const w = ($('#topo').clientWidth || window.innerWidth); return w >= 860 ? 3 : w >= 600 ? 2 : 1; }
  function topoSvg(theme) { return Topology.build(result, project(), { cols: topoCols(), theme, color, standalone: theme === 'light' }); }
  function renderTopo() {
    $('#topomsg').textContent = '';
    $('#topo').innerHTML = result && result.ok ? topoSvg('dark') : '<p class="hint">Fix the problem at the top to draw the diagram.</p>';
    $('#btnSvg').disabled = $('#btnSvgCopy').disabled = !(result && result.ok);
  }
  function bindTopo() {
    $('#btnSvg').addEventListener('click', () => {
      const blob = new Blob([topoSvg('light')], { type: 'image/svg+xml' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = (cur().name || 'network').replace(/[^\w-]+/g, '_') + '-network-map.svg';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      $('#topomsg').textContent = 'SVG downloaded (light theme, for documents).';
    });
    $('#btnSvgCopy').addEventListener('click', async () => { $('#topomsg').textContent = (await copy(topoSvg('light'))) ? 'SVG copied.' : 'Copy was blocked. Use Download SVG instead.'; });
    let t; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (openSec === 'diagram') renderTopo(); }, 150); });
  }

  // ---------- outputs ----------
  function text(kind) {
    if (!result || !result.ok) return '';
    const p = project();
    switch (kind) {
      case 'csv': return Fmt.toCSV(result);
      case 'forti': return Fmt.toFortiOS(result, p, p.ifName);
      case 'text': return Fmt.toText(result, p);
      case 'md': return Fmt.toHandoverDoc(result, p);
      case 'html': return Fmt.toHandoverHTML(result, p);
    }
    return '';
  }
  function renderHandover() {
    $('#docbox').innerHTML = result.ok ? text('html') : '<p class="hint">Fix the problem at the top to build the handover document.</p>';
  }
  function renderExport() {
    $$('.subtabs button').forEach(b => b.classList.toggle('on', b.dataset.out === outView));
    ['forti', 'csv', 'text'].forEach(k => { $('#out-' + k).hidden = k !== outView; });
    const ifn = $('#ifName'); if (ifn.value !== (cur().ifName || '')) ifn.value = cur().ifName || '';
    $('#fortinote').textContent = Fmt.FORTI_NOTE;
    const none = 'Fix the problem at the top to enable this output.';
    ['forti', 'csv', 'text'].forEach(k => { if (k === outView) $('#pre-' + k).textContent = text(k) || none; });
  }
  async function copy(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) { /* fall back */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, t.length);
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (e) { return false; }
  }
  function bindOutputs() {
    $('.subtabs').addEventListener('click', e => { const b = e.target.closest('button[data-out]'); if (!b) return; outView = b.dataset.out; renderExport(); });
    $$('[data-copy]').forEach(b => b.addEventListener('click', async () => {
      const t = text(b.dataset.copy);
      if (!t) { toast('Nothing to copy yet. Fix the problem at the top first.'); return; }
      const ok = await copy(t);
      toast(ok ? 'Copied to the clipboard.' : 'Copy was blocked. Press and hold the text, choose Select All, then Copy.');
      const old = b.textContent; b.textContent = ok ? 'Copied!' : 'Copy failed'; setTimeout(() => { b.textContent = old; }, 1500);
    }));
    $('#ifName').addEventListener('input', e => { cur().ifName = e.target.value; touch(); renderExport(); });
    $('#btnPrint').addEventListener('click', () => { setOpen('handover', false); window.print(); });
  }

  // ---------- accordion + jump bar ----------
  function renderSection(name) {
    if (!result) return;
    if (name === 'plan') { renderMap(); renderCards(); renderGaps(); }
    else if (name === 'diagram') renderTopo();
    else if (name === 'handover') renderHandover();
    else if (name === 'export') renderExport();
  }
  // Only one section is open at a time; name = null closes all.
  function setOpen(name, scroll) {
    openSec = name;
    SECTIONS.forEach(s => {
      const on = s === name;
      $('#sec-' + s).classList.toggle('open', on);
      $(`#sec-${s} .acc-head`).setAttribute('aria-expanded', String(on));
      $('#body-' + s).hidden = !on;
    });
    $$('nav.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    if (name) renderSection(name);
    if (scroll && name) jump(name);
  }
  function jump(name) {
    const el = $('#sec-' + name), reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior = reduce ? 'auto' : 'smooth';
    if (isPhone()) window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 8), behavior });
    else { const r = $('#right'); r.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top - r.getBoundingClientRect().top + r.scrollTop - 8), behavior }); }
  }
  function bindAccordion() {
    $$('.acc-head').forEach(b => b.addEventListener('click', () => { const n = b.dataset.sec; setOpen(openSec === n ? null : n, openSec !== n); }));
    $$('nav.tabs button').forEach(b => b.addEventListener('click', () => setOpen(b.dataset.tab, true)));
    $('#fitUsed').addEventListener('change', renderMap);
    $('#cards').addEventListener('toggle', e => { const d = e.target.closest('details'); if (!d) return; if (d.open) openCards.add(d.dataset.name); else openCards.delete(d.dataset.name); }, true);
  }

  function recalc() {
    if (!cur()) return;
    result = Calc.plan(project());
    Calc6.annotate(result, cur().v6).forEach(w => result.warnings.push(w));
    $('#i-parent').placeholder = cur().parentAuto === false ? 'auto' : `auto (${cur().parent || 'none free'})`;
    renderV6Msg(); renderWarn(); renderSummaries(); renderSumLine();
    if (openSec) renderSection(openSec);
    save();
  }

  // ---------- offline / service worker ----------
  function netState() {
    const pill = $('#netpill'), sw = pill.dataset.sw === '1';
    if (!navigator.onLine) { pill.textContent = 'Offline' + (sw ? ' · works' : ''); pill.className = 'pill off'; }
    else if (sw) { pill.textContent = 'Offline ready'; pill.className = 'pill ok'; }
    else { pill.textContent = 'Online'; pill.className = 'pill'; }
  }
  function registerSW() {
    const pill = $('#netpill');
    window.addEventListener('online', netState); window.addEventListener('offline', netState);
    netState();
    if (!('serviceWorker' in navigator)) { pill.textContent = 'No offline support'; return; }
    navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => { pill.dataset.sw = '1'; netState(); })
      .catch(() => { pill.textContent = 'Offline unavailable'; });
  }

  // ---------- init ----------
  load();
  buildReqs();
  bindClients(); bindIntake(); bindTopo(); bindOutputs(); bindAccordion();
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
  if (!cur()) {
    const left = Object.values(store.clients).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    if (left.length) store.current = left[0].id; else { const c = Intake.newClient('New client'); c.updated = Date.now(); store.clients[c.id] = c; store.current = c.id; }
  }
  (function first() {
    const c = cur(); Intake.migrate(c); Intake.applyIntake(c);
    renderClientSel(); renderIntake(); recalc();
    const done = c.name && c.name !== 'New client' && Number(c.intake.counts.staff) > 0;
    if (isPhone() && done) setSideCollapsed(true); // filled in: show just the one-line summary
  }());
  registerSW();
  const legacy = { clients: 'plan', intake: 'plan', plan: 'plan', map: 'diagram', outputs: 'export' };
  window.SubnetPal = {
    get state() { return store; }, get result() { return result; }, recalc, setOpen,
    show: v => { if (SECTIONS.indexOf(v) >= 0) setOpen(v, true); else if (legacy[v]) setOpen(legacy[v], true); },
  };
}());
