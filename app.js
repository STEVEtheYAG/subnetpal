(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const KEY = 'subnetpal.v2';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 9);
  const color = i => `hsl(${(i * 47 + 205) % 360} 62% 58%)`;
  const COUNTS = [['staff', 'Staff'], ['wired', 'Wired devices'], ['wifi', 'Wi-Fi devices'], ['voice', 'Voice / phones'], ['cameras', 'Cameras'], ['iot', 'IoT'], ['servers', 'Servers'], ['guest', 'Guest users'], ['dmz', 'Public servers (DMZ)']];
  const REQS = [['guest', 'Guest Wi-Fi separation'], ['dmz', 'DMZ / public servers'], ['voice', 'Voice VLAN'], ['cameras', 'Cameras VLAN'], ['iot', 'IoT VLAN']];

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

  // ---------- state ----------
  let view = 'clients';
  let outView = 'handover';
  let result = null;
  const project = () => Intake.toProject(cur());

  // ---------- navigation ----------
  function show(v) {
    if (v !== 'clients' && !cur()) v = 'clients';
    view = v;
    const has = !!cur();
    $$('nav.tabs button').forEach(b => { b.classList.toggle('on', b.dataset.tab === v); b.disabled = b.dataset.tab !== 'clients' && !has; });
    $$('.panel').forEach(p => { p.hidden = p.id !== 'tab-clients' && !has; }); // one scrolling page: all sections once a client is open
    $('#crumb').textContent = cur() && v !== 'clients' ? cur().name + (cur().site ? ' · ' + cur().site : '') : '';
    renderClients();
    if (has) { renderIntake(); renderPlanInputs(); recalc(); }
    jump(v);
  }
  // Scroll to a section. The floating "Jump to" menu and every show() call use this.
  function jump(v) {
    const el = $('#tab-' + v);
    if (!el || v === 'clients') window.scrollTo(0, 0);
    else window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 12), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  // Highlight the section currently in view.
  let spyBusy = false;
  function spy() {
    if (spyBusy) return; spyBusy = true;
    setTimeout(() => {
      spyBusy = false;
      const ps = $$('.panel').filter(p => !p.hidden);
      let at = ps[0] ? ps[0].id.slice(4) : 'clients';
      ps.forEach(p => { if (p.getBoundingClientRect().top <= window.innerHeight * 0.35) at = p.id.slice(4); });
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4 && ps.length) at = ps[ps.length - 1].id.slice(4);
      view = at;
      $$('nav.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === at));
    }, 60);
  }

  // ---------- network map ----------
  function topoCols() { const w = ($('#topo').clientWidth || window.innerWidth); return w >= 860 ? 3 : w >= 600 ? 2 : 1; }
  function topoSvg(theme) { return Topology.build(result, project(), { cols: topoCols(), theme, color, standalone: theme === 'light' }); }
  function renderTopo() {
    $('#topomsg').textContent = '';
    $('#topo').innerHTML = result && result.ok ? topoSvg('dark') : '<p class="hint">Fix the problems on the Plan screen to draw the map.</p>';
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
    let t; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (view === 'map') renderTopo(); }, 150); });
  }

  // ---------- 1. clients ----------
  function renderClients() {
    const list = Object.values(store.clients).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    $('#clientList').innerHTML = list.length ? list.map(c => `<div class="client" data-id="${esc(c.id)}">
      <div class="cinfo"><b>${esc(c.name)}</b><span class="dim">${esc(c.site || 'No site')} · ${esc(c.date || '')}</span>
      <span class="dim mono">${esc(c.parent || 'no parent block')} · ${c.networks.length} networks</span></div>
      <div class="btnrow"><button class="btn sm primary" data-act="open">Open</button><button class="btn sm" data-act="dup">Duplicate</button><button class="btn sm danger" data-act="del">Delete</button></div></div>`).join('')
      : '<p class="hint">No clients yet. Create one or add a sample below.</p>';
    $('#samples').innerHTML = Object.keys(Intake.SAMPLES).map(k => `<button class="btn" data-sample="${esc(k)}">+ ${esc(k)}</button>`).join('');
  }
  function addClient(c) { c.updated = Date.now(); store.clients[c.id] = c; store.current = c.id; save(); }
  function bindClients() {
    $('#btnNewClient').addEventListener('click', () => { addClient(Intake.newClient('New client')); show('intake'); });
    $('#samples').addEventListener('click', e => { const b = e.target.closest('[data-sample]'); if (!b) return; addClient(Intake.sampleClient(b.dataset.sample)); show('plan'); });
    $('#clientList').addEventListener('click', e => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const id = b.closest('.client').dataset.id, c = store.clients[id];
      if (b.dataset.act === 'open') { store.current = id; save(); show(c.networks.length ? 'plan' : 'intake'); }
      else if (b.dataset.act === 'dup') {
        const d = JSON.parse(JSON.stringify(c)); d.id = uid(); d.name = c.name + ' copy'; addClient(d); renderClients();
      } else if (b.dataset.act === 'del') {
        if (!confirm(`Delete client "${c.name}"? This cannot be undone.`)) return;
        delete store.clients[id]; if (store.current === id) store.current = null; save(); renderClients(); show('clients');
      }
    });
  }

  // ---------- 2. intake ----------
  function buildIntakeForm() {
    $('#counts').innerHTML = COUNTS.map(([k, l]) => `<label class="fld">${l}<input data-count="${k}" inputmode="numeric" autocomplete="off"></label>`).join('');
    $('#reqs').innerHTML = REQS.map(([k, l]) => `<label class="check"><input type="checkbox" data-req="${k}"> ${l}</label>`).join('');
  }
  function renderIntake() {
    const c = cur(), it = c.intake;
    $('#i-name').value = c.name; $('#i-site').value = c.site; $('#i-date').value = c.date;
    COUNTS.forEach(([k]) => { $(`[data-count="${k}"]`).value = it.counts[k] || 0; });
    REQS.forEach(([k]) => { $(`[data-req="${k}"]`).checked = !!it.req[k]; });
    $('#i-existing').value = it.existing; $('#i-wan').value = it.wanNote;
    const v6 = c.v6 || { enabled: false, prefix: '' };
    $('#v6-on').checked = !!v6.enabled; $('#v6-prefix').value = v6.prefix || ''; $('#v6-prefix').disabled = !v6.enabled; $('#v6-new').disabled = !v6.enabled; renderV6Msg();
    $$('#expansion .opt').forEach(b => { const on = b.dataset.exp === it.expansion; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  }
  function renderV6Msg() {
    const el = $('#v6-msg'); if (!el) return;
    const c = cur(), r = result;
    el.textContent = !c.v6 || !c.v6.enabled ? 'IPv6 is off. Outputs stay IPv4 only.' : r && r.v6Error ? r.v6Error : r && r.v6 ? `${r.v6.kind === 'ULA' ? 'Private (ULA)' : 'Global'} site prefix. Each network gets a /64, numbered from its VLAN.` : '';
    el.className = 'hint' + (r && r.v6Error ? ' bad' : '');
  }
  function touch() { cur().updated = Date.now(); save(); }
  function bindIntake() {
    const on = (sel, fn) => $(sel).addEventListener('input', fn);
    on('#i-name', e => { cur().name = e.target.value; touch(); });
    on('#i-site', e => { cur().site = e.target.value; touch(); });
    on('#i-date', e => { cur().date = e.target.value; touch(); });
    $('#counts').addEventListener('input', e => { if (e.target.dataset.count) { cur().intake.counts[e.target.dataset.count] = e.target.value; touch(); } });
    $('#reqs').addEventListener('change', e => { if (e.target.dataset.req) { cur().intake.req[e.target.dataset.req] = e.target.checked; touch(); } });
    on('#i-wan', e => { cur().intake.wanNote = e.target.value; touch(); });
    on('#i-existing', e => { // live: re-pick an auto parent so the plan always avoids existing ranges
      const c = cur(); c.intake.existing = e.target.value;
      if (c.parentAuto) { const p = Intake.pickParent(Intake.parseExisting(c.intake.existing)); c.parent = p ? p.cidr : ''; }
      touch();
    });
    $('#expansion').addEventListener('click', e => {
      const b = e.target.closest('.opt'); if (!b) return;
      const c = cur(); c.intake.expansion = b.dataset.exp; c.opts.growth = Intake.GROWTH[b.dataset.exp];
      touch(); renderIntake();
    });
    $('#v6-on').addEventListener('change', e => {
      const c = cur(); c.v6 = c.v6 || { enabled: false, prefix: '' }; c.v6.enabled = e.target.checked;
      if (c.v6.enabled && !String(c.v6.prefix).trim()) c.v6.prefix = Calc6.generateUla();
      touch(); renderIntake(); recalc();
    });
    on('#v6-prefix', e => { const c = cur(); c.v6 = c.v6 || { enabled: true, prefix: '' }; c.v6.prefix = e.target.value; touch(); recalc(); });
    $('#v6-new').addEventListener('click', () => { const c = cur(); c.v6.prefix = Calc6.generateUla(); touch(); renderIntake(); recalc(); });
    $('#btnGenerate').addEventListener('click', () => generate());
  }
  function generate() {
    const c = cur();
    if (c.planEdited && c.networks.length && !confirm('This replaces the networks you edited on the Plan screen. Continue?')) return;
    Intake.applyIntake(c); touch(); show('plan');
  }

  // ---------- 3. plan ----------
  function renderPlanInputs() {
    const c = cur();
    $('#parent').value = c.parent;
    $('#parentAutoTag').textContent = c.parentAuto ? '(auto-picked)' : '(manual)';
    $('#o-gwPos').value = c.opts.gwPos; $('#o-growth').value = c.opts.growth;
    $('#o-staticReserve').value = c.opts.staticReserve; $('#o-dhcpOffset').value = c.opts.dhcpOffset;
    renderRows();
  }
  function rowHtml(n, i, total) {
    const roles = '<option value="">(none)</option>' + Calc.ROLES.map(r => `<option${n.role === r ? ' selected' : ''}>${r}</option>`).join('');
    return `<div class="row" data-i="${i}">
      <div class="rowhead"><span class="swatch" data-sw="${i}"></span><strong>Network ${i + 1}</strong>
        <button class="ibtn" data-act="up" aria-label="Move up"${i === 0 ? ' disabled' : ''}>↑</button>
        <button class="ibtn" data-act="down" aria-label="Move down"${i === total - 1 ? ' disabled' : ''}>↓</button>
        <button class="ibtn del" data-act="del" aria-label="Remove network">✕</button></div>
      <label class="fld name">Name<input data-f="name" value="${esc(n.name)}" autocomplete="off" placeholder="e.g. Staff"></label>
      <label class="fld">Hosts needed<input data-f="hosts" value="${esc(n.hosts)}" inputmode="numeric" autocomplete="off"></label>
      <label class="fld">VLAN ID<input data-f="vlan" value="${esc(n.vlan)}" inputmode="numeric" autocomplete="off"></label>
      <label class="fld">Role<select data-f="role">${roles}</select></label>
    </div>`;
  }
  function renderRows() {
    const nets = cur().networks;
    $('#rows').innerHTML = nets.length ? nets.map((n, i) => rowHtml(n, i, nets.length)).join('') : '<p class="hint">No networks yet. Add one below, or go to Intake and generate a plan.</p>';
  }

  const rng = Fmt.rng;
  function renderStatus() {
    const el = $('#status');
    const list = (arr, cls) => arr.length ? `<ul>${arr.map(m => `<li class="${cls}">${esc(m)}</li>`).join('')}</ul>` : '';
    let html = '';
    if (result.conflicts && result.conflicts.length) html += `<div class="redbox"><b>⚠ Overlap with existing ranges</b>${list(result.conflicts, 'e')}</div>`;
    if (!result.ok) html += `<b class="e">Cannot build the plan</b>${list(result.errors.map(e => e.msg), 'e')}${list(result.warnings, 'w')}`;
    else {
      const s = result.summary;
      html += `<b>${esc(result.parent.cidr)}</b>: ${s.used.toLocaleString()} of ${s.parentSize.toLocaleString()} addresses used (${s.percentUsed}%).<br>` +
        `Space left: <b>${s.free.toLocaleString()}</b> addresses${s.largestFree ? `, largest free block <b>${esc(s.largestFree.cidr)}</b> (${s.largestFree.size.toLocaleString()})` : ''}.` +
        (s.reserved ? `<br><span class="dim">${s.reserved.toLocaleString()} addresses are existing ranges and were skipped.</span>` : '') +
        list(result.warnings, 'w');
    }
    el.className = 'status ' + (!result.ok || (result.conflicts && result.conflicts.length) ? 'bad' : 'good');
    el.innerHTML = html;
    const gn = cur().genNotes || [];
    $('#notes').innerHTML = gn.length ? `<div class="status"><b>Generated from intake</b>${list(gn, 'w')}</div>` : '';
    $$('.invalid').forEach(x => x.classList.remove('invalid'));
    result.errors.forEach(e => {
      let t = null;
      if (e.row >= 0 && e.field) t = $(`.row[data-i="${e.row}"] [data-f="${e.field}"]`);
      else if (e.field === 'parent') t = $('#parent');
      else if (e.field === 'growth') t = $('#o-growth');
      else if (e.field === 'staticReserve') t = $('#o-staticReserve');
      else if (e.field === 'dhcpOffset') t = $('#o-dhcpOffset');
      else if (e.field === 'existing' && view === 'intake') t = $('#i-existing');
      if (t) t.classList.add('invalid');
    });
    $$('.swatch[data-sw]').forEach(s => { s.style.background = color(Number(s.dataset.sw)); });
  }

  function renderResults() {
    const box = $('#results'), gapBox = $('#gaps');
    if (!result.allocations.length) { box.innerHTML = '<p class="hint">Nothing to show yet. Fix the problems above.</p>'; gapBox.innerHTML = ''; return; }
    const names = cur().networks.map(n => String(n.name).trim());
    const rows = result.allocations.map(a => {
      const ci = Math.max(0, names.indexOf(a.name));
      return `<tr>
        <td class="title" data-label="Name"><span class="nm"><span class="swatch" style="background:${color(ci)}"></span>${esc(a.name)}</span></td>
        <td data-label="VLAN">${esc(a.vlan === '' ? '-' : a.vlan)}</td>
        <td data-label="Role">${esc(a.role || '-')}</td>
        <td class="mono" data-label="CIDR"><b>${esc(a.cidr)}</b></td>
        <td class="mono" data-label="Netmask">${esc(a.netmask)}</td>
        <td class="mono" data-label="Wildcard">${esc(a.wildcard)}</td>
        <td class="mono" data-label="Network">${esc(a.network)}</td>
        <td class="mono" data-label="Gateway">${esc(a.gateway || '-')}</td>
        <td class="mono" data-label="Usable range">${esc(Fmt.usable(a))}</td>
        <td class="mono" data-label="Broadcast">${esc(a.broadcast || '-')}</td>
        <td data-label="Total / usable">${a.totalAddresses.toLocaleString()} / ${a.usableHosts.toLocaleString()}</td>
        <td class="mono" data-label="Static">${esc(rng(a.staticStart, a.staticEnd) || '-')}</td>
        <td class="mono" data-label="DHCP">${esc(rng(a.dhcpStart, a.dhcpEnd) || '-')}</td>${result.v6 ? `
        <td class="mono" data-label="IPv6 subnet">${esc(a.v6 ? a.v6.cidr : '-')}</td>
        <td class="mono" data-label="IPv6 gateway">${esc(a.v6 ? a.v6.address : '-')}</td>` : ''}</tr>`;
    }).join('');
    box.innerHTML = `<div class="tablewrap"><table class="cards"><thead><tr><th>Name</th><th>VLAN</th><th>Role</th><th>CIDR</th><th>Netmask</th><th>Wildcard</th><th>Network</th><th>Gateway</th><th>Usable range</th><th>Broadcast</th><th>Total / usable</th><th>Static</th><th>DHCP</th>${result.v6 ? '<th>IPv6 subnet</th><th>IPv6 gateway</th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div>`;
    gapBox.innerHTML = `<div class="card"><h2>Unused space</h2>${result.gaps.length ? result.gaps.map(g =>
      `<p class="mono">${esc(Calc.intToIp(g.start))} - ${esc(Calc.intToIp(g.end))} · ${g.size.toLocaleString()} addresses · ${esc(g.cidrs.map(c => c.cidr).join(', '))}${g.between ? ' · <b>gap between allocations</b>' : ' · free at end of block'}</p>`).join('')
      : '<p class="hint">None. The parent block is completely allocated.</p>'}</div>`;
  }

  function renderMap() {
    const map = $('#map'), legend = $('#legend');
    if (!result.parent || !result.allocations.length) { map.innerHTML = '<p class="hint">Nothing to draw yet.</p>'; legend.innerHTML = ''; return; }
    const par = result.parent, fit = $('#fitUsed').checked;
    const names = cur().networks.map(n => String(n.name).trim());
    const project_ = project();
    const ex = result.conflicts && result.conflicts.length ? Calc.mergeRanges(project_.existing.map(Calc.parseCidr).filter(e => !e.error && e.start <= par.end && e.end >= par.start).map(e => ({ start: Math.max(e.start, par.start), end: Math.min(e.end, par.end) }))) : [];
    let span = par.size;
    if (fit) { const maxEnd = Math.max.apply(null, result.allocations.map(a => a.end).concat(ex.map(e => e.end))); span = maxEnd + 1 - par.start; }
    const segs = result.allocations.map(a => {
      const ci = Math.max(0, names.indexOf(a.name));
      const left = (a.start - par.start) / span * 100, w = a.size / span * 100;
      return `<div class="seg" style="left:${left}%;width:${w}%;background:${color(ci)}" title="${esc(a.name)} ${esc(a.cidr)}">${w > 9 ? `<span>${esc(a.name)}</span>` : ''}</div>`;
    }).join('') + ex.map(e => `<div class="seg existing" style="left:${(e.start - par.start) / span * 100}%;width:${(e.end - e.start + 1) / span * 100}%" title="Existing range"></div>`).join('');
    map.innerHTML = `<div class="bar" role="img" aria-label="Address map of ${esc(par.cidr)}">${segs}</div>
      <div class="axis"><span class="mono">${esc(par.network)}</span><span class="mono">${esc(Calc.intToIp(par.start + span - 1))}</span></div>`;
    legend.innerHTML = result.allocations.map(a => {
      const ci = Math.max(0, names.indexOf(a.name));
      return `<div><span class="swatch" style="background:${color(ci)}"></span><span><b>${esc(a.name)}</b> <span class="mono dim">${esc(a.cidr)}</span></span></div>`;
    }).join('') + (ex.length ? '<div><span class="swatch existing"></span><span>Existing range (in use)</span></div>' : '') +
      (result.gaps.length ? '<div><span class="swatch hatch"></span><span>Free space (hatched)</span></div>' : '');
  }

  function recalc() {
    if (!cur()) return;
    result = Calc.plan(project());
    Calc6.annotate(result, cur().v6).forEach(w => result.warnings.push(w));
    renderV6Msg();
    renderStatus(); renderResults(); renderMap(); renderTopo(); renderOutputs();
    save();
  }

  function bindPlan() {
    $('#parent').addEventListener('input', e => { const c = cur(); c.parent = e.target.value; c.parentAuto = false; $('#parentAutoTag').textContent = '(manual)'; recalc(); });
    $$('[data-o]').forEach(el => el.addEventListener('input', () => { cur().opts[el.dataset.o] = el.value; recalc(); }));
    $('#fitUsed').addEventListener('change', renderMap);
    $('#btnAutoParent').addEventListener('click', () => {
      const c = cur(), p = Intake.pickParent(Intake.parseExisting(c.intake.existing));
      c.parent = p ? p.cidr : c.parent; c.parentAuto = true; renderPlanInputs(); recalc();
    });
    $('#btnRegen').addEventListener('click', generate);
    $('#rows').addEventListener('input', e => {
      const row = e.target.closest('.row'); if (!row || !e.target.dataset.f) return;
      const c = cur(); c.networks[Number(row.dataset.i)][e.target.dataset.f] = e.target.value; c.planEdited = true; recalc();
    });
    $('#rows').addEventListener('click', e => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const i = Number(b.closest('.row').dataset.i), nets = cur().networks;
      if (b.dataset.act === 'del') nets.splice(i, 1);
      else if (b.dataset.act === 'up' && i > 0) nets.splice(i - 1, 0, nets.splice(i, 1)[0]);
      else if (b.dataset.act === 'down' && i < nets.length - 1) nets.splice(i + 1, 0, nets.splice(i, 1)[0]);
      cur().planEdited = true; renderRows(); recalc();
    });
    $('#btnAdd').addEventListener('click', () => {
      cur().networks.push({ name: '', hosts: '', vlan: '', role: 'LAN' }); cur().planEdited = true;
      renderRows(); recalc();
      const last = $$('#rows .row').pop(); if (last) last.querySelector('[data-f="name"]').focus();
    });
  }

  // ---------- 4. outputs ----------
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
  function renderOutputs() {
    $$('.subtabs button').forEach(b => b.classList.toggle('on', b.dataset.out === outView));
    ['handover', 'forti', 'csv', 'text'].forEach(k => { $('#out-' + k).hidden = k !== outView; });
    $('#ifName').value = cur().ifName || '';
    $('#fortinote').textContent = Fmt.FORTI_NOTE;
    const none = 'Fix the problems on the Plan screen to enable this output.';
    $('#docbox').innerHTML = result.ok ? text('html') : `<p class="hint">${none}</p>`;
    ['forti', 'csv', 'text'].forEach(k => { $('#pre-' + k).textContent = text(k) || none; });
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
    $('.subtabs').addEventListener('click', e => { const b = e.target.closest('button[data-out]'); if (!b) return; outView = b.dataset.out; renderOutputs(); });
    $$('[data-copy]').forEach(b => b.addEventListener('click', async () => {
      const t = text(b.dataset.copy), msg = $('#exmsg');
      if (!t) { msg.textContent = 'Nothing to copy: fix the problems on the Plan screen first.'; return; }
      const ok = await copy(t);
      msg.textContent = ok ? 'Copied to the clipboard.' : 'Copy was blocked. Press and hold the text, choose Select All, then Copy.';
      const old = b.textContent; b.textContent = ok ? 'Copied!' : 'Copy failed'; setTimeout(() => { b.textContent = old; }, 1500);
    }));
    $('#ifName').addEventListener('input', e => { cur().ifName = e.target.value; recalc(); });
    $('#btnPrint').addEventListener('click', () => window.print());
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
  buildIntakeForm();
  $$('nav.tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
  bindClients(); bindIntake(); bindPlan(); bindTopo(); bindOutputs();
  window.addEventListener('scroll', spy, { passive: true });
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
  show('clients');
  registerSW();
  window.SubnetPal = { get state() { return store; }, get result() { return result; }, show, recalc };
}());
