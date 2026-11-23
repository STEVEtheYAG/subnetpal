(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const KEY = 'subnetpal.v2';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const color = i => `hsl(${(i * 47 + 205) % 360} 62% 58%)`;
  const rng = Fmt.rng;
  const SECTIONS = ['plan', 'diagram', 'policies', 'remote', 'export'];
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
  let openSec = 'plan';
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
    // Demo clients (made-up): a whole intake in one tap. Each adds a new client, so nothing you have is overwritten.
    $('#btnDemo').addEventListener('click', () => { addClient(Intake.demoClient('accountancy')); toast(Intake.DEMOS.accountancy.blurb); });
    $('#btnDemo2').addEventListener('click', () => { addClient(Intake.demoClient('clinic')); toast(Intake.DEMOS.clinic.blurb); });
    $('#samples').addEventListener('click', e => { const b = e.target.closest('[data-sample]'); if (b) addClient(Intake.sampleClient(b.dataset.sample)); });
  }

  // ---------- intake (left panel) ----------
  function buildReqs() {
    $('#reqs').innerHTML = Intake.OPTIONAL.map(o => `<div class="reqrow" data-row="${o.key}">
      <label class="check"><input type="checkbox" data-req="${o.key}"> ${esc(o.label)}</label>
      <input class="cnt" data-count="${o.key}" inputmode="numeric" autocomplete="off" placeholder="How many?" aria-label="Number of ${esc(o.unit)}" hidden>
    </div>`).join('');
  }
  // Custom "Other" pools: rebuilt only on add / remove / client switch so typing keeps focus.
  function renderOthers() {
    const list = cur().intake.others || [];
    $('#others').innerHTML = list.map((o, i) => `<div class="otherrow" data-oi="${i}">
      <input class="oname" data-oname maxlength="20" autocomplete="off" placeholder="Name, e.g. Printers" aria-label="Pool name" value="${esc(o.name)}">
      <input class="cnt ocount" data-ocount inputmode="numeric" autocomplete="off" placeholder="How many?" aria-label="Number of devices" value="${esc(o.count || '')}">
      <button type="button" class="btn sm" data-oremove aria-label="Remove this pool">×</button>
    </div>`).join('');
    $('#addOther').disabled = list.length >= Intake.MAX_OTHERS;
  }
  function renderIntake() {
    const c = cur(), it = c.intake;
    renderOthers();
    $('#i-name').value = c.name || ''; $('#i-site').value = c.site || '';
    $('#c-staff').value = it.counts.staff || '';
    Intake.OPTIONAL.forEach(o => {
      const on = !!it.req[o.key];
      $(`[data-req="${o.key}"]`).checked = on;
      const cnt = $(`[data-count="${o.key}"]`); cnt.hidden = !on; cnt.value = it.counts[o.key] || '';
    });
    const rm = it.remote || {};
    $('#rem-on').checked = !!rm.on; $('#rem-count').hidden = !rm.on; $('#rem-count').value = rm.count || '';
    $('#i-industry').value = it.industry || ''; $('#i-serverswhere').value = it.serversWhere || ''; $('#i-wifi').value = it.wifi || ''; $('#i-voip').value = it.voip || '';
    $('#i-dualwan').checked = !!it.dualWan; $('#i-sitevpn').checked = !!it.siteVpn; $('#i-webfilter').checked = !!it.webFilter;
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
    else if (t.id === 'i-industry') it.industry = t.value;
    else if (t.id === 'i-serverswhere') it.serversWhere = t.value;
    else if (t.id === 'i-wifi') it.wifi = t.value;
    else if (t.id === 'i-voip') it.voip = t.value;
    else if (t.id === 'i-dualwan') it.dualWan = t.checked;
    else if (t.id === 'i-sitevpn') it.siteVpn = t.checked;
    else if (t.id === 'i-webfilter') it.webFilter = t.checked;
    else if (t.id === 'rem-on') {
      it.remote = it.remote || { on: false, count: '', reach: null }; it.remote.on = t.checked;
      $('#rem-count').hidden = !t.checked; if (t.checked) $('#rem-count').focus();
    }
    else if (t.id === 'rem-count') { it.remote = it.remote || { on: true, count: '', reach: null }; it.remote.count = t.value; }
    else if (t.dataset.oname !== undefined || t.dataset.ocount !== undefined) {
      const o = (it.others || [])[Number(t.closest('.otherrow').dataset.oi)]; if (!o) return;
      if (t.dataset.oname !== undefined) o.name = t.value; else o.count = t.value;
      replan = true;
    }
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
    $('#addOther').addEventListener('click', () => {
      const it = cur().intake; it.others = it.others || [];
      if (it.others.length >= Intake.MAX_OTHERS) return;
      it.others.push({ name: '', count: '' });
      Intake.applyIntake(cur()); renderOthers(); touch(); recalc();
      const n = $$('[data-oname]'); n[n.length - 1].focus();
    });
    $('#others').addEventListener('click', e => {
      const b = e.target.closest('[data-oremove]'); if (!b) return;
      cur().intake.others.splice(Number(b.closest('.otherrow').dataset.oi), 1);
      Intake.applyIntake(cur()); renderOthers(); touch(); recalc();
    });
    $('#expansion').addEventListener('click', e => {
      const b = e.target.closest('.opt'); if (!b) return;
      cur().intake.expansion = b.dataset.exp; Intake.applyIntake(cur()); renderExpansion(); touch(); recalc();
    });
    $('#v6-new').addEventListener('click', () => { const c = cur(); c.v6.prefix = Calc6.generateUla(); $('#v6-prefix').value = c.v6.prefix; touch(); recalc(); });
    $('#sumBtn').addEventListener('click', () => { setSideCollapsed(!$('#side').classList.contains('collapsed')); if (!$('#side').classList.contains('collapsed')) window.scrollTo(0, 0); });
    $('#btnDone').addEventListener('click', () => { setSideCollapsed(true); window.scrollTo(0, 0); });
  }
  // ---------- import from contract (text stays on this device: nothing here is saved, uploaded or logged) ----------
  const CONF_LABEL = { high: 'High confidence', medium: 'Check this', low: 'Low confidence' };
  const markHit = (snip, hit) => { const i = hit ? snip.indexOf(hit) : -1; return i < 0 ? esc(snip) : esc(snip.slice(0, i)) + '<mark>' + esc(hit) + '</mark>' + esc(snip.slice(i + hit.length)); };
  let contractFound = null;                                  // the last scan (field values and short snippets only, never the whole text)
  const cmsg = (t, bad) => { const m = $('#contract-msg'); m.textContent = t; m.classList.toggle('warnbox', !!bad); };
  function contractControl(f) {
    const o = (v, l, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(l)}</option>`;
    if (f.type === 'bool') return `<select data-cv="${f.key}" aria-label="${esc(f.label)}">${o('true', f.yes || 'Yes', f.value === true)}${o('false', f.no || 'No', f.value === false)}</select>`;
    if (f.type === 'enum') return `<select data-cv="${f.key}" aria-label="${esc(f.label)}">${f.options.map(([v, l]) => o(v, l, f.value === v)).join('')}</select>`;
    return `<input data-cv="${f.key}" aria-label="${esc(f.label)}" autocomplete="off"${f.type === 'number' ? ' inputmode="numeric"' : ''} value="${esc(f.value)}">`;
  }
  function renderContractReview() {
    const box = $('#contract-review'), res = contractFound;
    if (!res || !res.ok) { box.innerHTML = ''; return; }
    const c = cur();
    box.innerHTML = (res.fields.length ? `<p class="hint">Tick what to use, correct any value, then apply. Nothing changes until you press Apply. Low-confidence rows are unticked.</p>` : '<p class="hint">No intake fields were found in that text. Nothing is guessed, so the intake is unchanged.</p>') +
      res.fields.map(f => { const now = Contract.current(c, f.key);
        return `<div class="crow conf-${f.conf}"><div class="crowhead"><label class="check"><input type="checkbox" data-cf="${f.key}"${f.checked ? ' checked' : ''}> <b>${esc(f.label)}</b></label>${badge('cbadge-' + f.conf, CONF_LABEL[f.conf])}</div>
          <div class="cval">${contractControl(f)}${now ? `<span class="cnow">Now: ${esc(now)}</span>` : ''}</div>
          ${f.snippet ? `<blockquote class="csnip">${markHit(f.snippet, f.hit)}</blockquote>` : ''}
          ${f.note ? `<p class="cnote">${esc(f.note)}${f.alts.length ? ' Also found: ' + esc(f.alts.join(' | ')) : ''}</p>` : ''}</div>`; }).join('') +
      (res.fields.length ? '<div class="btnrow"><button id="btnContractApply" class="btn sm primary" type="button">Apply selected to the intake</button><button id="btnContractCancel" class="btn sm" type="button">Cancel</button></div>' : '') +
      (res.missing.length ? `<details class="more2"><summary>Not found, left blank (${res.missing.length})</summary><p class="hint">${esc(res.missing.map(m => m.label).join(', '))}</p></details>` : '');
  }
  function contractReset(keepMsg) { contractFound = null; $('#contract-text').value = ''; $('#contract-file').value = ''; $('#contract-review').innerHTML = ''; if (!keepMsg) cmsg(''); }
  function bindContract() {
    $('#btnContractScan').addEventListener('click', () => {
      const res = Contract.extract($('#contract-text').value);
      if (!res.ok) { contractFound = null; renderContractReview(); cmsg(res.error, true); return; }
      contractFound = res; renderContractReview();
      cmsg(res.fields.length ? `Found ${res.fields.length} field${res.fields.length === 1 ? '' : 's'}. Review them below.` : 'Nothing found.', !res.fields.length);
    });
    $('#btnContractClear').addEventListener('click', () => contractReset());
    $('#contract-file').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      if (/\.(pdf|docx?|rtf|odt)$/i.test(f.name) || /pdf|word|officedocument|rtf/i.test(f.type)) { e.target.value = ''; cmsg('PDF and Word files are not supported yet. Copy the text out of the file and paste it into the box.', true); return; }
      if (f.size > 2 * 1024 * 1024) { e.target.value = ''; cmsg('That file is over 2 MB. Paste just the relevant parts.', true); return; }
      const rd = new FileReader();
      rd.onload = () => { $('#contract-text').value = String(rd.result || ''); cmsg('File read on this device. Press Find intake fields.'); };
      rd.onerror = () => cmsg('The file could not be read. Paste the text instead.', true);
      rd.readAsText(f);
    });
    $('#contract-review').addEventListener('click', e => {
      if (e.target.closest('#btnContractCancel')) { contractReset(); return; }
      if (!e.target.closest('#btnContractApply')) return;
      const items = [], bad = [];
      $$('#contract-review .crow').forEach(row => {
        const cf = row.querySelector('[data-cf]'); if (!cf || !cf.checked) return;
        const key = cf.dataset.cf, v = Contract.clean(key, row.querySelector('[data-cv]').value);
        if (v === null) bad.push(Contract.BY_KEY[key].label); else items.push({ key, value: v });
      });
      if (bad.length) { cmsg('Fix these values first: ' + bad.join(', ') + '.', true); return; }
      if (!items.length) { cmsg('Nothing is ticked, so nothing was applied.', true); return; }
      const done = Contract.apply(cur(), items);
      Intake.applyIntake(cur()); touch(); renderIntake(); renderClientSel(); recalc();
      contractReset(true); cmsg(`Applied ${done.length} field${done.length === 1 ? '' : 's'} to the intake. The contract text has been cleared from this page.`);
    });
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
    items.push(...Remote.warnings(result, project()));
    const vp = Remote.plan(result, project()); if (vp && !vp.ok) items.push('Remote access: ' + vp.error);
    $('#warn').innerHTML = items.length ? `<div class="banner"><b>⚠ Check this</b><ul>${items.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>` : '';
  }
  function renderSummaries() {
    const c = cur(), ok = result.ok, n = ok ? result.allocations.length : 0;
    $('#sum-plan').textContent = ok ? `${n} networks · ${result.parent.cidr} · ${result.style === 'vlan24' ? 'one /24 per VLAN' : 'packed'}` : 'Cannot build the plan yet';
    $('#sum-diagram').textContent = ok ? `Internet, firewall and ${n} networks` : 'Waiting for a valid plan';
    const nPol = ok ? Policy.effective(project(), result.allocations).length : 0;
    $('#sum-policies').textContent = ok ? `${nPol} policies, then deny everything else · ${c.pol && c.pol.edited ? 'edited' : 'defaults that follow the plan'}` : 'Waiting for a valid plan';
    const vp = Remote.plan(result, project());
    $('#sum-remote').textContent = !vp ? 'Not planned. Tick Remote staff in the intake.' : vp.ok ? `${vp.staff} remote staff · VPN pool ${vp.cidr} · reaches ${vp.reach.length} network${vp.reach.length === 1 ? '' : 's'}` : 'No space for the VPN pool';
    $('#sum-export').textContent = 'Client report · FortiOS CLI · CSV · text';
    renderHello(c, ok, n, nPol);
  }
  // Greeting + KPI tiles above the tabs. Client name is set with textContent/esc only.
  function renderHello(c, ok, n, nPol) {
    const h = $('#hello'); h.textContent = Theme.greeting(new Date().getHours());
    if (c.name && c.name !== 'New client') { h.appendChild(document.createTextNode(', ')); const i = document.createElement('i'); i.textContent = c.name; h.appendChild(i); }
    $('#hellosub').textContent = ok ? `${result.parent.cidr} · ${result.style === 'vlan24' ? 'one /24 per VLAN' : 'packed'}` : 'Fill in the intake to build the plan.';
    const vp = ok ? Remote.plan(result, project()) : null;
    const addr = ok ? result.allocations.reduce((t, a) => t + (Number(a.totalAddresses) || 0), 0) : 0;
    const tiles = [
      ['Networks', ok ? n : '-', ok ? 'in the plan' : 'waiting', 'hero'],
      ['Addresses', ok ? Theme.compact(addr) : '-', 'allocated', ''],
      ['Policies', ok ? nPol : '-', 'then deny all', ''],
      ['Remote staff', vp && vp.ok ? vp.staff : '-', vp && vp.ok ? 'on the VPN' : 'not planned', ''],
    ];
    $('#kpis').innerHTML = tiles.map(t => `<div class="kpi ${t[3]}"><span class="kl">${esc(t[0])}</span><b class="kv">${esc(String(t[1]))}</b><span class="ks">${esc(t[2])}</span></div>`).join('');
  }
  function themeNow() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  function paintThemeBtn() {
    const t = themeNow(), nx = Theme.other(t);
    $('#themeBtn').setAttribute('aria-label', `Switch to ${nx} mode`);
    $('#themeIco').textContent = nx === 'dark' ? '☾' : '☀'; $('#themeTxt').textContent = nx === 'dark' ? 'Dark' : 'Light';
  }
  function bindTheme() {
    paintThemeBtn();
    $('#themeBtn').addEventListener('click', () => { Theme.apply(Theme.other(themeNow())); paintThemeBtn(); if (openSec === 'diagram') renderTopo(); });
    // Follow the system only while the person has not picked a side.
    const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (mq && mq.addEventListener) mq.addEventListener('change', e => { let st = null; try { st = localStorage.getItem(Theme.KEY); } catch (x) { /* ignore */ } if (st !== 'dark' && st !== 'light') { document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light'); paintThemeBtn(); if (openSec === 'diagram') renderTopo(); } });
    // Printing is always light: swap the diagram for its light version while the print dialog is open.
    window.addEventListener('beforeprint', () => { if (result && result.ok && $('#topo').firstChild) $('#topo').innerHTML = topoSvg('light'); });
    window.addEventListener('afterprint', () => { if (openSec === 'diagram') renderTopo(); });
  }

  const typeOf = a => (a.role === 'Transit' ? 'Transit' : a.role === 'Loopback' ? 'Loopback' : a.vlan !== '' ? `VLAN ${a.vlan}` : 'Port');
  // Tap-to-copy: every IP on a card is a button that copies itself.
  const ipHtml = v => (/^\d+\.\d+\.\d+\.\d+$/.test(v) ? `<span class="ip" role="button" tabindex="0" data-ip="${esc(v)}" title="Tap to copy">${esc(v)}</span>` : esc(v));
  const rangeHtml = a => (a.prefix === 32 || !a.firstUsable || !a.lastUsable ? ipHtml(a.firstUsable || '-') : `${ipHtml(a.firstUsable)} - ${ipHtml(a.lastUsable)}`);
  async function copyIp(el) {
    const v = el.dataset.ip, ok = await copy(v);
    toast(ok ? `Copied ${v}` : 'Copy was blocked. Press and hold the address to copy it.');
  }
  function bindCopyIps() {
    document.addEventListener('click', e => { const el = e.target.closest('.ip'); if (!el) return; e.preventDefault(); e.stopPropagation(); copyIp(el); }, true);
    document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('ip')) { e.preventDefault(); copyIp(e.target); } });
  }
  function vpnCard() {
    const p = Remote.plan(result, project()); if (!p || !p.ok) return '';
    return `<details class="ncard" data-name="__vpn"${openCards.has('__vpn') ? ' open' : ''}>
        <summary>
          <span class="nt"><span class="swatch" style="background:#37c2a0"></span><b>Remote staff (VPN)</b><span class="ntype">IPsec pool</span><span class="chev" aria-hidden="true">▾</span></span>
          <dl class="nf">
            <div><dt>Usable range</dt><dd class="mono">${ipHtml(p.first)} - ${ipHtml(p.last)}</dd></div>
            <div><dt>Pool</dt><dd class="mono">${esc(p.cidr)}</dd></div>
            <div><dt>Netmask</dt><dd class="mono">${ipHtml(p.netmask)} /${esc(String(p.cidr).split('/')[1])}</dd></div>
          </dl>
        </summary>
        <dl class="nf extra"><div><dt>Remote staff planned</dt><dd class="mono">${p.staff} + ${p.growth}% buffer</dd></div><div><dt>Pool size</dt><dd class="mono">${p.size.toLocaleString()} (${p.usable.toLocaleString()} usable)</dd></div><div><dt>Placement</dt><dd class="mono">${p.where === 'inside' ? 'office block, outside every network' : 'separate block'}</dd></div></dl>
      </details>`;
  }
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
            <div><dt>Usable range</dt><dd class="mono">${rangeHtml(a)}</dd></div>
            <div><dt>Port / gateway IP</dt><dd class="mono">${ipHtml(a.gateway || a.firstUsable || '-')}</dd></div>
            <div><dt>Netmask</dt><dd class="mono">${ipHtml(a.netmask)} /${esc(a.prefix)}</dd></div>
          </dl>
        </summary>
        <dl class="nf extra">${extra.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="mono">${esc(v)}</dd></div>`).join('')}</dl>
      </details>`;
    }).join('') + vpnCard();
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
  function topoSvg(theme, standalone) { return Topology.build(result, project(), { cols: topoCols(), theme, color, standalone: !!standalone, vpn: Remote.plan(result, project()) }); }
  function renderTopo() {
    $('#topomsg').textContent = '';
    $('#topo').innerHTML = result && result.ok ? topoSvg(themeNow()) : '<p class="hint">Fix the problem at the top to draw the diagram.</p>';
    $('#btnSvg').disabled = $('#btnSvgCopy').disabled = !(result && result.ok);
  }
  function bindTopo() {
    $('#btnSvg').addEventListener('click', () => {
      const blob = new Blob([topoSvg('light', true)], { type: 'image/svg+xml' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = (cur().name || 'network').replace(/[^\w-]+/g, '_') + '-network-map.svg';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      $('#topomsg').textContent = 'SVG downloaded (light theme, for documents).';
    });
    $('#btnSvgCopy').addEventListener('click', async () => { $('#topomsg').textContent = (await copy(topoSvg('light', true))) ? 'SVG copied.' : 'Copy was blocked. Use Download SVG instead.'; });
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
      case 'polcli': return Fmt.toPolicyFortiOS(result, p, p.ifName);
      case 'remote': return Fmt.toRemoteFortiOS(result, p, p.ifName);
    }
    return '';
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
    $('#btnReport').addEventListener('click', () => {
      if (!result || !result.ok) { toast('Fix the problem at the top first, then generate the report.'); return; }
      const html = ClientReport.build(result, project(), Topology.build(result, project(), { cols: 2, theme: 'light', color, standalone: true, plain: true, vpn: Remote.plan(result, project()) }));
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      const w = window.open(url, '_blank');
      if (!w) { toast('The report was blocked as a pop-up. Allow pop-ups for this site and try again.'); URL.revokeObjectURL(url); return; }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
  }

  // ---------- accordion + jump bar ----------
  function renderSection(name) {
    if (!result) return;
    if (name === 'plan') { renderMap(); renderCards(); renderGaps(); }
    else if (name === 'diagram') renderTopo();
    else if (name === 'policies') renderPolicies();
    else if (name === 'remote') renderRemote();
    else if (name === 'export') renderExport();
  }

  // ---------- policies ----------
  const polMsg = (t, bad) => { const m = $('#parsemsg'); m.textContent = t; m.classList.toggle('warnbox', !!bad); };
  function materialize() {
    const c = cur();
    if (!c.pol || !Array.isArray(c.pol.list)) c.pol = { edited: false, list: [], toggles: {} };
    if (!c.pol.edited) { c.pol.list = Policy.defaults(result.allocations, Policy.cardCtx(project(), result.allocations)); c.pol.edited = true; }
    return c.pol.list;
  }
  const TIER_LABEL = { baseline: 'Baseline', recommended: 'Recommended', optional: 'Optional' };
  const RISK_LABEL = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' };
  const badge = (cls, label) => `<span class="badge ${cls}">${esc(label)}</span>`;
  // Tier, risk and the client need for a policy that came from a library card. Policies the engineer made have no card.
  function polCardHtml(p, libMap) {
    const card = p.card && Cards.byId(p.card); if (!card) return '';
    const st = libMap.get(card.id) || { tier: card.tier, because: '' };
    return `<div class="polcard">${badge('tier-' + st.tier, TIER_LABEL[st.tier])}${badge('risk-' + card.risk, RISK_LABEL[card.risk])}
      <span class="polwhy">${esc(card.why)}${st.because ? ` <i>Because: ${esc(st.because)}.</i>` : ''}</span></div>`;
  }
  // The web filter profile on a policy, in one line (accept policies only).
  const polWebLine = p => (p.webf && p.webf.groups && p.action !== 'deny'
    ? `<div class="polweb">Web filter: <b>${esc(Webcat.label(p.webf.preset))}</b> · ${esc(Webcat.summary(p.webf.groups))}</div>` : '');
  function cardListHtml(lib, edited) {
    const groups = [['baseline', 'Baseline'], ['recommended', 'Recommended'], ['optional', 'Optional']];
    return groups.map(([t, label]) => {
      const rows = lib.filter(e => e.tier === t);
      if (!rows.length) return '';
      return `<h3 class="cardgrp">${label}</h3>` + rows.map(e => {
        const c = e.card, isP = c.type === 'policy';
        const ctl = isP
          ? `<input type="checkbox" data-card="${esc(c.id)}"${e.on ? ' checked' : ''}${t === 'baseline' && !edited ? ' disabled' : ''} aria-label="${esc(c.name)}">`
          : '<span class="badge advice">Advice</span>';
        return `<label class="cardrow${e.on || !isP ? '' : ' off'}">${ctl}<span><b>${esc(c.name)}</b> ${badge('risk-' + c.risk, RISK_LABEL[c.risk])}
          <span class="polwhy">${esc(c.why)}${e.because ? ` <i>Because: ${esc(e.because)}.</i>` : ''}${isP ? '' : ' ' + esc(c.text)}</span></span></label>`;
      }).join('');
    }).join('');
  }
  function polRowHtml(p, i, n, nets, libMap) {
    const o = (v, l, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(l)}</option>`;
    const miss = x => (nets.indexOf(x) < 0 && x !== 'internet' && x !== 'internal');
    const netOpts = sel => nets.map(x => o(x, x, sel === x)).join('');
    const svc = Policy.SERVICES.some(s => s.v === p.service) ? '' : o(p.service, p.service, true);
    const web = p.web || { mode: '', sites: '', cats: [] }, app = p.app || { mode: '', cats: [] };
    const cat = (kind, list, sel) => list.map(c => `<label class="check small"><input type="checkbox" data-pcat="${kind}" value="${c.id}"${sel.indexOf(c.id) >= 0 || sel.indexOf(String(c.id)) >= 0 ? ' checked' : ''}> ${esc(c.l)}</label>`).join('');
    const mode = (sel, a, b) => `<option value=""${sel === '' ? ' selected' : ''}>Off</option><option value="allow"${sel === 'allow' ? ' selected' : ''}>${a}</option><option value="block"${sel === 'block' ? ' selected' : ''}>${b}</option>`;
    return `<div class="polrow${miss(p.src) || miss(p.dst) ? ' bad' : ''}${p.action === 'deny' ? ' deny' : ''}" data-pi="${i}">
      <div class="polhead"><b>${i + 1}. ${esc(Policy.policyName(p))}</b>
        <span class="polbtns"><button type="button" class="btn sm" data-pact="up" aria-label="Move up"${i === 0 ? ' disabled' : ''}>↑</button><button type="button" class="btn sm" data-pact="down" aria-label="Move down"${i === n - 1 ? ' disabled' : ''}>↓</button><button type="button" class="btn sm" data-pact="del" aria-label="Delete policy">×</button></span></div>
      ${polCardHtml(p, libMap)}${polWebLine(p)}
      <div class="polgrid">
        <label>Source<select data-pf="src">${miss(p.src) ? o(p.src, '(not in plan) ' + p.src, true) : ''}${netOpts(p.src)}</select></label>
        <label>Destination<select data-pf="dst">${o('internet', 'Internet', p.dst === 'internet')}${o('internal', 'All internal networks', p.dst === 'internal')}${miss(p.dst) ? o(p.dst, '(not in plan) ' + p.dst, true) : ''}${netOpts(p.dst)}</select></label>
        <label>Service<select data-pf="service">${svc}${Policy.SERVICES.map(s => o(s.v, s.l, s.v === p.service)).join('')}</select></label>
        <label>Action<select data-pf="action">${o('accept', 'Accept', p.action !== 'deny')}${o('deny', 'Deny', p.action === 'deny')}</select></label>
        <label class="check"><input type="checkbox" data-pf="nat"${p.nat ? ' checked' : ''}${p.action === 'deny' ? ' disabled' : ''}> NAT</label>
        <label class="check"><input type="checkbox" data-pf="log"${p.log !== false ? ' checked' : ''}> Log</label>
      </div>
      <details class="polmore"${web.mode || app.mode || p.webf ? ' open' : ''}><summary>Websites and applications (optional)</summary>
        <div class="webf"><label>Web filter profile (FortiGuard categories)<select data-wpreset>${o('', 'Off', !p.webf)}${Webcat.PRESET_IDS.map(id => o(id, Webcat.label(id), p.webf && p.webf.preset === id)).join('')}${p.webf && p.webf.preset === 'custom' ? o('custom', 'Custom', true) : ''}</select></label>
          <div class="wgrid">${Webcat.GROUPS.map(g => `<label>${esc(g.label)}<select data-wg="${g.id}"${p.webf ? '' : ' disabled'}>${Webcat.ACTIONS.map(a => o(a.v, a.l, p.webf && Webcat.normGroups(p.webf.groups)[g.id] === a.v)).join('')}</select></label>`).join('')}</div></div>
        <label>Websites<select data-pf="web.mode">${mode(web.mode, 'Allow-list (only these sites)', 'Block-list (block these sites)')}</select></label>
        <textarea data-pf="web.sites" rows="2" spellcheck="false" autocapitalize="off" placeholder="Sites, e.g. example.com, news.example.com">${esc(web.sites || '')}</textarea>
        <div class="catbox">${cat('web', Policy.WEB_CATS, web.cats || [])}</div>
        <label>Application control<select data-pf="app.mode">${mode(app.mode, 'Allow only these categories', 'Block these categories')}</select></label>
        <div class="catbox">${cat('app', Policy.APP_CATS, app.cats || [])}</div>
        <p class="hint">Profiles apply to Accept policies only. Category IDs are unverified: check them on the lab VM.</p>
      </details>
    </div>`;
  }
  function renderPolicyCli() { const t = text('polcli'); $('#pre-polcli').textContent = t || 'Fix the problem at the top to enable this output.'; }
  function renderPolicies() {
    const c = cur();
    if ($('#tagline') !== document.activeElement && $('#tagline').value !== (c.tagline || '')) $('#tagline').value = c.tagline || '';
    $('#polnote').textContent = Policy.NOTE;
    if (!result || !result.ok) { $('#pollist').innerHTML = '<p class="hint">Fix the problem above to edit policies.</p>'; $('#cardlist').innerHTML = ''; $('#pre-polcli').textContent = ''; return; }
    const list = Policy.effective(project(), result.allocations), nets = Policy.policyNets(result.allocations);
    const lib = Policy.cardView(project(), result.allocations), libMap = new Map(lib.map(e => [e.card.id, e]));
    const offCount = lib.filter(e => e.card.type === 'policy' && !e.on).length;
    $('#cardlibsum').textContent = `Policy library (${lib.length} cards${offCount ? `, ${offCount} off` : ''})`;
    const sg = Suggest.run(result.allocations, c.intake), indL = (Suggest.INDUSTRIES.find(x => x.v === sg.industry) || {}).l || 'Office';
    $('#sugline').textContent = `Suggested for a ${sg.size} ${indL.toLowerCase()} site (${sg.staff} staff, ${sg.facts.ifaces} networks). Suggestions only seed the list: editing a policy keeps your own list.${c.intake.webFilter && Webcat.INDUSTRY_WHY[sg.industry] ? ' Web filtering: ' + Webcat.INDUSTRY_WHY[sg.industry] : ''}`;
    $('#sugnotes').innerHTML = sg.notes.map(n => `<li>${esc(n)}</li>`).join('');
    $('#cardlist').innerHTML = cardListHtml(lib, !!(c.pol && c.pol.edited));
    $('#pollist').innerHTML = (c.pol && c.pol.edited ? '' : '<p class="hint">These are the default rules for this plan and follow it when the plan changes. Editing anything below keeps your own list.</p>') +
      (list.length ? list.map((p, i) => polRowHtml(p, i, list.length, nets, libMap)).join('') : '<p class="hint">No policies. Everything is denied. Add one or reset to defaults.</p>');
    renderPolicyCli();
  }
  function setPath(p, path, v) {
    if (path === 'web.mode' || path === 'web.sites') { p.web = p.web || { mode: '', sites: '', cats: [] }; p.web[path.split('.')[1]] = v; }
    else if (path === 'app.mode') { p.app = p.app || { mode: '', cats: [] }; p.app.mode = v; }
    else p[path] = v;
    if (path === 'src' || path === 'dst' || path === 'action') p.name = '';
    if (path === 'action' && v === 'deny') p.nat = false;
    if (path === 'dst' && v === 'internet' && p.action === 'accept') p.nat = true;
  }
  function bindPolicies() {
    const box = $('#pollist');
    const edit = fn => { const list = materialize(); fn(list); touch(); };
    box.addEventListener('change', e => {
      const t = e.target, row = t.closest('.polrow'); if (!row) return;
      const i = Number(row.dataset.pi);
      edit(list => {
        const p = list[i]; if (!p) return;
        if (t.dataset.pf) setPath(p, t.dataset.pf, t.type === 'checkbox' ? t.checked : t.value);
        else if (t.dataset.wpreset !== undefined) { if (t.value !== 'custom') Policy.setWebPreset(p, t.value, cur().intake.industry); }
        else if (t.dataset.wg) Policy.setWebGroup(p, t.dataset.wg, t.value);
        else if (t.dataset.pcat) {
          const k = t.dataset.pcat, o = k === 'web' ? (p.web = p.web || { mode: '', sites: '', cats: [] }) : (p.app = p.app || { mode: '', cats: [] });
          const id = Number(t.value); o.cats = (o.cats || []).map(Number).filter(x => x !== id); if (t.checked) o.cats.push(id);
        }
      });
      renderPolicies(); renderSummaries();
    });
    box.addEventListener('input', e => {
      const t = e.target; if (t.dataset.pf !== 'web.sites') return;
      const i = Number(t.closest('.polrow').dataset.pi);
      edit(list => { if (list[i]) setPath(list[i], 'web.sites', t.value); }); renderPolicyCli();
    });
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-pact]'); if (!b) return;
      const i = Number(b.closest('.polrow').dataset.pi), a = b.dataset.pact;
      edit(list => {
        if (a === 'del') list.splice(i, 1);
        else { const j = a === 'up' ? i - 1 : i + 1; if (j >= 0 && j < list.length) { const x = list[i]; list[i] = list[j]; list[j] = x; } }
      });
      renderPolicies(); renderSummaries();
    });
    // Library cards: before the first edit this only records the switch (the list keeps following the plan); after it, the card's rules are added or removed.
    $('#cardlist').addEventListener('change', e => {
      const t = e.target; if (!t.dataset.card || !result.ok) return;
      const c = cur();
      if (c.pol && c.pol.edited) c.pol.list = Policy.setCardInList(c.pol.list, t.dataset.card, t.checked, result.allocations, Policy.cardCtx(project(), result.allocations));
      else { c.pol = c.pol || { edited: false, list: [] }; c.pol.toggles = c.pol.toggles || {}; c.pol.toggles[t.dataset.card] = t.checked; }
      touch(); renderPolicies(); renderSummaries();
    });
    $('#tagline').addEventListener('input', e => { cur().tagline = e.target.value; touch(); });
    $('#btnAddPol').addEventListener('click', () => {
      if (!result.ok) return;
      const nets = Policy.policyNets(result.allocations); if (!nets.length) return;
      edit(list => list.push(Policy.mkPolicy({ src: nets[0], dst: 'internet', service: 'ALL', action: 'accept', nat: true })));
      renderPolicies(); renderSummaries(); polMsg('Added a policy at the bottom (above the final deny). Set it with the dropdowns.');
    });
    $('#btnResetPol').addEventListener('click', () => { cur().pol = { edited: false, list: [], toggles: {} }; touch(); renderPolicies(); renderSummaries(); polMsg('Back to the default policies for this plan.'); });
    $('#btnParse').addEventListener('click', () => {
      const txt = $('#tagline').value.trim(); cur().tagline = txt; touch();
      if (!txt) { polMsg('Type a sentence first, or use + Add policy.', true); return; }
      if (!result.ok) { polMsg('Fix the problem at the top first.', true); return; }
      const parsed = Policy.parse(txt, result.allocations);
      const bad = parsed.unparsed.map(u => `"${u.text}" (${u.why})`).join('; ');
      if (!parsed.policies.length) {
        polMsg(`I didn't understand that${bad ? ': ' + bad : ''}. Networks in this plan: ${Policy.policyNets(result.allocations).join(', ')}. Build the policy yourself with + Add policy and the dropdowns.`, true);
        return;
      }
      edit(list => { cur().pol.list = Policy.apply(list, parsed); });
      renderPolicies(); renderSummaries();
      polMsg(`Added ${parsed.policies.length} polic${parsed.policies.length === 1 ? 'y' : 'ies'} at the top. Check them below.${bad ? ' Not understood: ' + bad + '.' : ''}`, !!bad);
    });
  }

  // ---------- remote access ----------
  function renderRemote() {
    const p = project(), r = Remote.norm(p), on = r.on && result && result.ok;
    $('#remoteoff').hidden = !!on; $('#remoteon').hidden = !on;
    if (!on) return;
    const pool = Remote.plan(result, p);
    $('#vpnpool').innerHTML = !pool.ok ? `<p class="hint warnbox">${esc(pool.error)}</p>` :
      `<dl class="nf extra"><div><dt>VPN address pool</dt><dd class="mono">${esc(pool.cidr)}</dd></div>
        <div><dt>Usable range</dt><dd class="mono">${ipHtml(pool.first)} - ${ipHtml(pool.last)}</dd></div>
        <div><dt>Netmask</dt><dd class="mono">${ipHtml(pool.netmask)} /${esc(String(pool.cidr).split('/')[1])}</dd></div>
        <div><dt>Sized for</dt><dd class="mono">${pool.staff} staff + ${pool.growth}% buffer = ${pool.need} (pool holds ${pool.usable.toLocaleString()})</dd></div>
        <div><dt>Placement</dt><dd class="mono">${pool.where === 'inside' ? 'inside the office block, outside every network' : 'separate block (the office block is full)'}</dd></div></dl>` +
      pool.notes.map(n => `<p class="hint">${esc(n)}</p>`).join('');
    const sel = new Set(Remote.reachList(result, p).map(a => a.name));
    $('#reachlist').innerHTML = Remote.reachable(result).map(a => `<label class="check"><input type="checkbox" data-reach="${esc(a.name)}"${sel.has(a.name) ? ' checked' : ''}> ${esc(a.name)} <span class="dim mono">${esc(a.cidr)}</span></label>`).join('') || '<p class="hint">No internal networks.</p>';
    $('#homelist').textContent = Remote.HOME_RANGES.join('  ');
    $('#fortinote2').textContent = Fmt.FORTI_NOTE + ' ' + Policy.NOTE;
    $('#pre-remote').textContent = text('remote') || '';
  }
  function bindRemote() {
    $('#reachlist').addEventListener('change', e => {
      const t = e.target; if (!t.dataset.reach) return;
      const it = cur().intake; it.remote = it.remote || { on: true, count: '', reach: null };
      if (!it.remote.reach) { const defaults = Remote.reachList(result, project()); it.remote.reach = {}; defaults.forEach(a => { it.remote.reach[a.name] = true; }); }
      it.remote.reach[t.dataset.reach] = t.checked;
      touch(); recalc();
    });
  }
  // Tabs at the top of the results: exactly one section is shown at a time.
  function setOpen(name, scroll) {
    if (SECTIONS.indexOf(name) < 0) name = 'plan';
    openSec = name;
    SECTIONS.forEach(s => {
      const on = s === name;
      $('#sec-' + s).classList.toggle('open', on);
      $('#body-' + s).hidden = !on;
    });
    $$('.rtabs button').forEach(b => { const on = b.dataset.tab === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    renderSection(name);
    if (scroll) jump();
  }
  // Bring the tab bar into view (top of the results).
  function jump() {
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    if (isPhone()) window.scrollTo({ top: Math.max(0, $('.rtabs').getBoundingClientRect().top + window.scrollY - 60), behavior });
    else $('#right').scrollTo({ top: 0, behavior });
  }
  function bindAccordion() {
    $$('.rtabs button').forEach(b => b.addEventListener('click', () => setOpen(b.dataset.tab, false)));
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
  bindTheme(); bindClients(); bindIntake(); bindContract(); bindTopo(); bindOutputs(); bindAccordion(); bindPolicies(); bindRemote(); bindCopyIps();
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
  setOpen('plan', false);
  registerSW();
  const legacy = { clients: 'plan', intake: 'plan', plan: 'plan', map: 'diagram', outputs: 'export' };
  window.SubnetPal = {
    get state() { return store; }, get result() { return result; }, recalc, setOpen,
    show: v => { if (SECTIONS.indexOf(v) >= 0) setOpen(v, true); else if (legacy[v]) setOpen(legacy[v], true); },
  };
}());
