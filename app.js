(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const KEY = 'subnetpal.v1';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 9);
  const color = i => `hsl(${(i * 47 + 205) % 360} 62% 58%)`;

  const PRESETS = {
    'Office 20 staff + guest': {
      parent: '192.168.10.0/24',
      networks: [
        { name: 'Staff', hosts: 20, vlan: 10, role: 'LAN' },
        { name: 'Guest', hosts: 20, vlan: 20, role: 'Guest' },
        { name: 'Mgmt', hosts: 5, vlan: 99, role: 'Mgmt' },
      ],
    },
    'Small branch with DMZ': {
      parent: '10.30.0.0/24',
      networks: [
        { name: 'Branch LAN', hosts: 40, vlan: 10, role: 'LAN' },
        { name: 'Guest', hosts: 15, vlan: 20, role: 'Guest' },
        { name: 'DMZ', hosts: 6, vlan: 30, role: 'DMZ' },
        { name: 'Mgmt', hosts: 4, vlan: 99, role: 'Mgmt' },
        { name: 'Transit to HQ', hosts: 2, vlan: '', role: 'Transit' },
        { name: 'Loopback', hosts: 1, vlan: '', role: 'Loopback' },
      ],
    },
    'HQ with 5 VLANs': {
      parent: '10.20.0.0/22',
      networks: [
        { name: 'Staff', hosts: 200, vlan: 10, role: 'LAN' },
        { name: 'Servers', hosts: 60, vlan: 20, role: 'LAN' },
        { name: 'Voice', hosts: 80, vlan: 30, role: 'LAN' },
        { name: 'Guest', hosts: 100, vlan: 40, role: 'Guest' },
        { name: 'Mgmt', hosts: 20, vlan: 99, role: 'Mgmt' },
        { name: 'DMZ', hosts: 12, vlan: 50, role: 'DMZ' },
        { name: 'Transit to ISP router', hosts: 2, vlan: '', role: 'Transit' },
      ],
    },
  };

  function newProject(name, preset) {
    const p = preset || {};
    return {
      id: uid(), name: name || 'New project', parent: p.parent || '10.20.0.0/16',
      networks: (p.networks || []).map(n => Object.assign({ id: uid() }, n)),
      opts: Object.assign({}, Calc.DEFAULT_OPTS), ifName: p.ifName || 'PORT_CHANGE_ME',
    };
  }

  // ---------- storage ----------
  let store = { current: null, projects: {} };
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (raw && raw.projects && Object.keys(raw.projects).length) {
        store = raw;
        if (!store.projects[store.current]) store.current = Object.keys(store.projects)[0];
        return;
      }
    } catch (e) { /* ignore */ }
    const p = newProject('Office 20 staff + guest', PRESETS['Office 20 staff + guest']);
    store = { current: p.id, projects: { [p.id]: p } };
  }
  let saveT;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(saveNow, 250);
  }
  function saveNow() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* private mode / full */ } }
  const proj = () => store.projects[store.current];

  // ---------- state ----------
  let result = null;
  let activeEx = 'forti';

  // ---------- rendering: project bar ----------
  function renderProjects() {
    const sel = $('#projSel');
    sel.innerHTML = Object.values(store.projects).map(p => `<option value="${esc(p.id)}"${p.id === store.current ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
    const ps = $('#presetSel');
    ps.innerHTML = '<option value="">Choose a preset…</option>' + Object.keys(PRESETS).map(k => `<option>${esc(k)}</option>`).join('');
  }

  // ---------- rendering: inputs ----------
  function rowHtml(n, i, total) {
    const roles = '<option value="">(none)</option>' + Calc.ROLES.map(r => `<option${n.role === r ? ' selected' : ''}>${r}</option>`).join('');
    return `<div class="row" data-i="${i}">
      <div class="rowhead"><span class="swatch" data-sw="${i}"></span><strong>Network ${i + 1}</strong>
        <button class="ibtn" data-act="up" aria-label="Move up"${i === 0 ? ' disabled' : ''}>↑</button>
        <button class="ibtn" data-act="down" aria-label="Move down"${i === total - 1 ? ' disabled' : ''}>↓</button>
        <button class="ibtn del" data-act="del" aria-label="Remove network">✕</button></div>
      <label class="fld name">Name<input data-f="name" value="${esc(n.name)}" autocomplete="off" placeholder="e.g. Staff"></label>
      <label class="fld">Hosts needed<input data-f="hosts" value="${esc(n.hosts)}" inputmode="numeric" autocomplete="off"></label>
      <label class="fld">VLAN ID (optional)<input data-f="vlan" value="${esc(n.vlan)}" inputmode="numeric" autocomplete="off"></label>
      <label class="fld">Role<select data-f="role">${roles}</select></label>
    </div>`;
  }
  function renderRows() {
    const p = proj();
    $('#rows').innerHTML = p.networks.length ? p.networks.map((n, i) => rowHtml(n, i, p.networks.length)).join('') : '<p class="hint">No networks yet. Add one below or pick a preset.</p>';
  }
  function renderInputs() {
    const p = proj();
    $('#parent').value = p.parent;
    $('#o-gwPos').value = p.opts.gwPos;
    $('#o-growth').value = p.opts.growth;
    $('#o-staticReserve').value = p.opts.staticReserve;
    $('#o-dhcpOffset').value = p.opts.dhcpOffset;
    $('#ifName').value = p.ifName || '';
    renderRows();
  }

  // ---------- outputs ----------
  const rng = Fmt.rng;
  function renderStatus() {
    const el = $('#status'), sum = $('#summary');
    const p = proj();
    const list = (arr, cls) => arr.length ? `<ul>${arr.map(m => `<li class="${cls}">${esc(m)}</li>`).join('')}</ul>` : '';
    let html;
    if (!result.ok) {
      html = `<b class="e">Cannot build the plan</b>${list(result.errors.map(e => e.msg), 'e')}${list(result.warnings, 'w')}`;
      el.className = 'status bad';
    } else {
      const s = result.summary;
      html = `<b>${esc(result.parent.cidr)}</b>: ${s.used.toLocaleString()} of ${s.parentSize.toLocaleString()} addresses used (${s.percentUsed}%).<br>` +
        `Free: <b>${s.free.toLocaleString()}</b> addresses${s.largestFree ? `, largest free block <b>${esc(s.largestFree.cidr)}</b> (${s.largestFree.size.toLocaleString()})` : ''}.` +
        list(result.warnings, 'w');
      el.className = 'status good';
    }
    el.innerHTML = html;
    sum.className = el.className;
    sum.innerHTML = html;
    // mark invalid inputs
    $$('.invalid').forEach(x => x.classList.remove('invalid'));
    result.errors.forEach(e => {
      let t = null;
      if (e.row >= 0 && e.field) t = $(`.row[data-i="${e.row}"] [data-f="${e.field}"]`);
      else if (e.field === 'parent') t = $('#parent');
      else if (e.field === 'growth') t = $('#o-growth');
      else if (e.field === 'staticReserve') t = $('#o-staticReserve');
      else if (e.field === 'dhcpOffset') t = $('#o-dhcpOffset');
      if (t) t.classList.add('invalid');
    });
    const idx = {};
    result.allocations.forEach(a => { idx[a.name] = a; });
    $$('.swatch').forEach(s => { const i = Number(s.dataset.sw); s.style.background = color(i); });
  }

  function renderResults() {
    const box = $('#results'), gapBox = $('#gaps');
    if (!result.allocations.length) { box.innerHTML = '<p class="hint">Nothing to show yet. Fix the problems on the Plan tab.</p>'; gapBox.innerHTML = ''; return; }
    const names = proj().networks.map(n => String(n.name).trim());
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
        <td class="mono" data-label="DHCP">${esc(rng(a.dhcpStart, a.dhcpEnd) || '-')}</td></tr>`;
    }).join('');
    box.innerHTML = `<div class="tablewrap"><table class="cards"><thead><tr><th>Name</th><th>VLAN</th><th>Role</th><th>CIDR</th><th>Netmask</th><th>Wildcard</th><th>Network</th><th>Gateway</th><th>Usable range</th><th>Broadcast</th><th>Total / usable</th><th>Static</th><th>DHCP</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    if (result.gaps.length) {
      gapBox.innerHTML = `<div class="card"><h2>Unused space</h2>${result.gaps.map(g =>
        `<p class="mono">${esc(Calc.intToIp(g.start))} - ${esc(Calc.intToIp(g.end))} · ${g.size.toLocaleString()} addresses · ${esc(g.cidrs.map(c => c.cidr).join(', '))}${g.between ? ' · <b>gap between allocations</b>' : ' · free at end of block'}</p>`).join('')}</div>`;
    } else gapBox.innerHTML = '<div class="card"><h2>Unused space</h2><p class="hint">None. The parent block is completely allocated.</p></div>';
  }

  function renderMap() {
    const map = $('#map'), legend = $('#legend');
    if (!result.parent || !result.allocations.length) { map.innerHTML = '<p class="hint">Nothing to draw yet.</p>'; legend.innerHTML = ''; return; }
    const par = result.parent;
    const fit = $('#fitUsed').checked;
    const names = proj().networks.map(n => String(n.name).trim());
    let span = par.size;
    if (fit) { const maxEnd = Math.max.apply(null, result.allocations.map(a => a.end)); span = maxEnd + 1 - par.start; }
    const segs = result.allocations.map(a => {
      const ci = Math.max(0, names.indexOf(a.name));
      const left = (a.start - par.start) / span * 100, w = a.size / span * 100;
      return `<div class="seg" style="left:${left}%;width:${w}%;background:${color(ci)}" title="${esc(a.name)} ${esc(a.cidr)}">${w > 9 ? `<span>${esc(a.name)}</span>` : ''}</div>`;
    }).join('');
    map.innerHTML = `<div class="bar" role="img" aria-label="Address map of ${esc(par.cidr)}">${segs}</div>
      <div class="axis"><span class="mono">${esc(par.network)}</span><span class="mono">${esc(Calc.intToIp(par.start + span - 1))}</span></div>`;
    legend.innerHTML = result.allocations.map(a => {
      const ci = Math.max(0, names.indexOf(a.name));
      return `<div><span class="swatch" style="background:${color(ci)}"></span><span><b>${esc(a.name)}</b> <span class="mono dim">${esc(a.cidr)}</span></span></div>`;
    }).join('') + (result.gaps.length ? '<div><span class="swatch hatch"></span><span>Free space (hatched)</span></div>' : '');
  }

  function renderExport() {
    $('#fortinote').textContent = Fmt.FORTI_NOTE;
    const out = exportText(activeEx);
    $('#expreview').textContent = out || 'Fix the problems on the Plan tab to enable exports.';
  }
  function exportText(kind) {
    if (!result.ok) return '';
    const p = proj();
    switch (kind) {
      case 'csv': return Fmt.toCSV(result);
      case 'md': return Fmt.toMarkdown(result, p);
      case 'forti': return Fmt.toFortiOS(result, p, p.ifName);
      case 'text': return Fmt.toText(result, p);
      case 'handover': return Fmt.toHandoverMarkdown(result, p);
    }
    return '';
  }

  function renderHandover() {
    const p = proj();
    $('#hoTitle').textContent = 'Network addressing: ' + p.name;
    if (!result.ok) { $('#hoMeta').textContent = ''; $('#handover').innerHTML = '<p class="hint">Fix the problems on the Plan tab first.</p>'; return; }
    $('#hoMeta').textContent = `Address block ${result.parent.cidr} · prepared ${new Date().toISOString().slice(0, 10)}`;
    const rows = Fmt.handoverRows(result).map(r => `<tr>${Fmt.handoverCells(r).map((c, i) => `<td class="${i >= 3 && i !== 2 ? 'mono' : ''}" data-label="${esc(Fmt.HANDOVER_HEAD[i])}">${esc(c || '-')}</td>`).join('')}</tr>`).join('');
    $('#handover').innerHTML = `<div class="tablewrap"><table class="cards"><thead><tr>${Fmt.HANDOVER_HEAD.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function recalc() {
    const p = proj();
    result = Calc.plan(p);
    renderStatus(); renderResults(); renderMap(); renderExport(); renderHandover();
    save();
  }

  // ---------- events ----------
  function bind() {
    // tabs
    $$('nav.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

    // parent / options
    $$('[data-o]').forEach(el => el.addEventListener('input', () => {
      const p = proj(), k = el.dataset.o;
      if (k === 'parent') p.parent = el.value; else p.opts[k] = el.value;
      recalc();
    }));
    $('#ifName').addEventListener('input', e => { proj().ifName = e.target.value; recalc(); });
    $('#fitUsed').addEventListener('change', renderMap);

    // network rows (delegated)
    $('#rows').addEventListener('input', e => {
      const row = e.target.closest('.row'); if (!row || !e.target.dataset.f) return;
      proj().networks[Number(row.dataset.i)][e.target.dataset.f] = e.target.value;
      recalc();
    });
    $('#rows').addEventListener('click', e => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const i = Number(b.closest('.row').dataset.i), nets = proj().networks;
      if (b.dataset.act === 'del') nets.splice(i, 1);
      else if (b.dataset.act === 'up' && i > 0) nets.splice(i - 1, 0, nets.splice(i, 1)[0]);
      else if (b.dataset.act === 'down' && i < nets.length - 1) nets.splice(i + 1, 0, nets.splice(i, 1)[0]);
      renderRows(); recalc();
    });
    $('#btnAdd').addEventListener('click', () => {
      proj().networks.push({ id: uid(), name: '', hosts: '', vlan: '', role: 'LAN' });
      renderRows(); recalc();
      const last = $$('#rows .row').pop(); if (last) last.querySelector('[data-f="name"]').focus();
    });

    // projects
    $('#projSel').addEventListener('change', e => { store.current = e.target.value; renderInputs(); recalc(); });
    $('#btnNew').addEventListener('click', () => {
      const name = prompt('Name for the new project:', 'New project'); if (!name || !name.trim()) return;
      const p = newProject(uniqueName(name.trim())); store.projects[p.id] = p; store.current = p.id;
      renderProjects(); renderInputs(); recalc();
    });
    $('#btnRename').addEventListener('click', () => {
      const name = prompt('Rename project:', proj().name); if (!name || !name.trim()) return;
      proj().name = name.trim(); renderProjects(); recalc();
    });
    $('#btnDup').addEventListener('click', () => {
      const c = JSON.parse(JSON.stringify(proj())); c.id = uid(); c.name = uniqueName(c.name + ' copy');
      c.networks.forEach(n => { n.id = uid(); });
      store.projects[c.id] = c; store.current = c.id; renderProjects(); renderInputs(); recalc();
    });
    $('#btnDel').addEventListener('click', () => {
      if (!confirm(`Delete project "${proj().name}"? This cannot be undone.`)) return;
      delete store.projects[store.current];
      if (!Object.keys(store.projects).length) { const p = newProject('New project'); store.projects[p.id] = p; }
      store.current = Object.keys(store.projects)[0];
      renderProjects(); renderInputs(); recalc();
    });
    $('#presetSel').addEventListener('change', e => {
      const k = e.target.value; if (!k) return;
      const p = newProject(uniqueName(k), PRESETS[k]); store.projects[p.id] = p; store.current = p.id;
      renderProjects(); renderInputs(); recalc(); e.target.value = '';
    });

    // export
    $$('[data-ex]').forEach(b => b.addEventListener('click', async () => {
      activeEx = b.dataset.ex;
      const text = exportText(activeEx);
      renderExport();
      const msg = $('#exmsg');
      if (!text) { msg.textContent = 'Nothing to copy: fix the problems on the Plan tab first.'; return; }
      msg.textContent = (await copy(text)) ? `Copied ${b.textContent.replace('Copy ', '')} to the clipboard.` : 'Copy was blocked. Press and hold the preview below and choose Select All, then Copy.';
    }));
    $('#hoCopy').addEventListener('click', async () => {
      const t = exportText('handover'); if (!t) return;
      const ok = await copy(t); $('#hoCopy').textContent = ok ? 'Copied!' : 'Copy failed';
      setTimeout(() => { $('#hoCopy').textContent = 'Copy Markdown'; }, 1500);
    });
    $('#hoPrint').addEventListener('click', () => window.print());

    window.addEventListener('pagehide', saveNow);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
  }

  function uniqueName(base) {
    const have = Object.values(store.projects).map(p => p.name.toLowerCase());
    let n = base, i = 2;
    while (have.indexOf(n.toLowerCase()) >= 0) n = `${base} ${i++}`;
    return n;
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall back */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (e) { return false; }
  }

  function showTab(t) {
    $$('nav.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    $$('.panel').forEach(p => { p.hidden = p.id !== 'tab-' + t; });
    window.scrollTo(0, 0);
  }

  // ---------- offline / service worker ----------
  function netState() {
    const pill = $('#netpill');
    const sw = pill.dataset.sw === '1';
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
  renderProjects(); renderInputs(); bind(); recalc(); registerSW();
  window.SubnetPal = { get state() { return store; }, get result() { return result; }, recalc, showTab };
}());
