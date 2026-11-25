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

  // ---------- toast ----------
  let toastT;
  function toast(msg) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1600);
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
    $('#btnDemo').addEventListener('click', () => { addClient(Intake.demoClient('accountancy')); setSideCollapsed(true, true); toast('Demo loaded'); });
    $('#btnDemo2').addEventListener('click', () => { addClient(Intake.demoClient('clinic')); setSideCollapsed(true, true); toast('Demo loaded'); });
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
    $('#i-ports').value = c.portCount || ''; $('#i-portprefix').value = c.portPrefix || '';
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
    else if (t.id === 'i-ports') { const n = Math.floor(Number(t.value)); c.portCount = n > 0 ? Math.min(48, n) : ''; }
    else if (t.id === 'i-portprefix') c.portPrefix = t.value.trim();
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
    $('#btnDone').addEventListener('click', () => { setSideCollapsed(true); window.scrollTo(0, 0); });
  }
  // ---------- import from contract (text stays on this device: nothing here is saved, uploaded or logged) ----------
  const CONF_LABEL = { high: 'High confidence', medium: 'Worth a look', low: 'Low confidence' };
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
  // PDF text via the vendored PDF.js (./vendor, cached for offline use). Loaded only when a PDF is chosen. Text only: nothing is rendered or sent anywhere.
  async function pdfText(bytes) {
    let lib;
    try { lib = await import('./vendor/pdf.min.mjs'); } catch (_) { throw new Error('The PDF reader could not load. Reload the page (Ctrl+Shift+R) or paste the text.'); }
    lib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';
    let doc;
    try { doc = await lib.getDocument({ data: bytes, isEvalSupported: false }).promise; }
    catch (err) { throw new Error(err && err.name === 'PasswordException' ? 'That PDF is password protected. Remove the password or paste the text.' : 'That PDF could not be read. Paste the text instead.'); }
    let out = '';
    for (let i = 1; i <= Math.min(doc.numPages, 200) && out.length < Contract.MAX_CHARS; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      out += tc.items.map(it => (it.str || '') + (it.hasEOL ? '\n' : ' ')).join('') + '\n';
    }
    try { doc.destroy(); } catch (_) {}
    out = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!out) throw new Error('No text found in that PDF. It may be a scan (pictures of pages). Paste the text instead.');
    return out;
  }
  function bindContract() {
    $('#btnContractScan').addEventListener('click', () => {
      const res = Contract.extract($('#contract-text').value);
      if (!res.ok) { contractFound = null; renderContractReview(); cmsg(res.error, true); return; }
      contractFound = res; renderContractReview();
      cmsg(res.fields.length ? `Found ${res.fields.length} field${res.fields.length === 1 ? '' : 's'}. Review them below.` : 'Nothing found.', !res.fields.length);
    });
    $('#btnContractClear').addEventListener('click', () => contractReset());
    $('#contract-file').addEventListener('change', async e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      const reset = () => { e.target.value = ''; };
      if (f.size > DocRead.MAX_BYTES) { reset(); cmsg('That file is over 25 MB. Paste just the relevant parts.', true); return; }
      try {
        const bytes = new Uint8Array(await f.arrayBuffer()), kind = DocRead.kind(bytes, f.name);
        let text;
        if (kind === 'doc') { reset(); cmsg(DocRead.OLD_DOC_MSG, true); return; }
        if (kind === 'unknown') { reset(); cmsg('That file type is not supported. Choose a .pdf, .docx or .txt file, or paste the text.', true); return; }
        if (kind === 'docx') { cmsg('Reading the Word file on this device...'); text = await DocRead.docxText(bytes); }
        else if (kind === 'pdf') { cmsg('Reading the PDF on this device...'); text = await pdfText(bytes); }
        else { if (f.size > 2 * 1024 * 1024) { reset(); cmsg('That file is over 2 MB. Paste just the relevant parts.', true); return; } text = new TextDecoder('utf-8').decode(bytes); }
        $('#contract-text').value = text; cmsg('File read on this device. Press Find intake fields.');
      } catch (err) { reset(); cmsg((err && err.message) || 'The file could not be read. Paste the text instead.', true); }
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
  // Client information: a panel that slides down from the top, toggled by the "Client info" button. The choice is remembered per layout.
  const sideKey = () => 'subnetpal-top-' + (isPhone() ? 'm' : 'd');
  function setSideCollapsed(v, noSave) {
    $('#side').classList.toggle('collapsed', v);
    $('#sideTab').setAttribute('aria-expanded', String(!v));
    if (!noSave) { try { localStorage.setItem(sideKey(), v ? '0' : '1'); } catch (e) { /* private mode: just not remembered */ } }
  }
  function initSide() {
    let v = null; try { v = localStorage.getItem(sideKey()); } catch (e) { /* ignore */ }
    setSideCollapsed(v === null ? isPhone() : v === '0', true); // first visit: open on desktop, closed on phones
  }
  function bindSide() {
    $('#sideTab').addEventListener('click', () => setSideCollapsed(!$('#side').classList.contains('collapsed')));
    $('#side').addEventListener('keydown', e => { if (e.key === 'Escape') { setSideCollapsed(true); $('#sideTab').focus(); } });
    matchMedia('(max-width: 899px)').addEventListener('change', initSide);
  }
  function renderV6Msg() {
    const el = $('#v6-msg'), c = cur(), r = result;
    el.textContent = !c.v6 || !c.v6.enabled ? 'IPv6 is off. Outputs stay IPv4 only.' : r && r.v6Error ? r.v6Error : r && r.v6 ? `${r.v6.kind === 'ULA' ? 'Private (ULA)' : 'Global'} site prefix. Each network gets a /64, numbered from its VLAN.` : '';
    el.className = 'hint' + (r && r.v6Error ? ' bad' : '');
  }

  // ---------- results (right panel) ----------
  // One warning banner, only when something is wrong.
  const phOf = () => (cur().ifName && String(cur().ifName).trim()) || 'PORT_CHANGE_ME';
  function renderWarn() {
    const items = [];
    if (result.conflicts && result.conflicts.length) items.push(...result.conflicts);
    if (!result.ok) items.push(...result.errors.map(e => e.msg));
    if (result.styleNote) items.push(result.styleNote);
    if (result.v6Error) items.push('IPv6: ' + result.v6Error);
    items.push(...Remote.warnings(result, project()));
    const vp = Remote.plan(result, project()); if (vp && !vp.ok) items.push('Remote access: ' + vp.error);
    const pp = result.ok ? Fmt.portPlan(result.allocations, phOf(), project()) : null;
    if (pp && pp.short.length) items.push(`Not enough ports: ${pp.pool.length} available, none left for ${pp.short.join(', ')}. Add ports, or give that network a VLAN ID so it shares the VLAN trunk port.`);
    $('#portsum').textContent = pp && pp.pool.length ? `Ports: ${pp.pool.length} available (${pp.pool[0]} to ${pp.pool[pp.pool.length - 1]}), ${pp.free.length} free${pp.vlans ? '. VLANs ride on ' + pp.parent : ''}.` : 'Optional. Leave empty and the CLI keeps a PORT_CHANGE_ME placeholder.';
    $('#warn').innerHTML = items.length ? `<div class="banner"><b>Things to review</b><ul>${items.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>` : '';
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
  // KPI tiles above the tabs.
  function renderHello(c, ok, n, nPol) {
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
  function paintPalette() {
    const cur = document.documentElement.getAttribute('data-palette') || 'indigo';
    const nm = (Theme.PALETTES.find(p => p[0] === cur) || Theme.PALETTES[0])[1];
    $('#tname').textContent = nm;
    $('#tpop').querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', b.dataset.p === cur ? 'true' : 'false'));
  }
  function bindPalette() {
    $('#tpop').innerHTML = Theme.PALETTES.map(p => `<button type="button" role="radio" data-p="${p[0]}"><span class="sw sw-${p[0]}" aria-hidden="true"></span>${esc(p[1])}</button>`).join('');
    paintPalette();
    $('#tpop').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      Theme.applyPalette(b.dataset.p); paintPalette(); $('#themes').open = false; if (openSec === 'diagram') renderTopo();
    });
    document.addEventListener('click', e => { const d = $('#themes'); if (d.open && !d.contains(e.target)) d.open = false; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#themes').open = false; });
  }
  function bindTheme() {
    bindPalette(); paintThemeBtn();
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
  // "Set it up on the FortiGate" panel: grouped like the FortiOS form, a plain-English why per field, and a copy button for the CLI.
  const apx = on => on ? ' <span class="apx" title="Not captured from the FortiOS VM; from the FortiOS docs">approximate</span>' : '';
  function guideRows(rows) {
    return rows.map(r => `<div class="fgr"><span class="fk">${esc(r.k)}${apx(r.approx)}</span><span class="fv">${r.chips ? r.chips.map(c => `<span class="chip${c.on ? ' on' : ''}${c.dis ? ' dis' : ''}">${c.on ? '✓ ' : ''}${esc(c.t)}</span>`).join('') + (r.v === 'None' ? ' <span class="dim">None</span>' : '') : `<span class="mono">${esc(r.v)}</span>`}</span>${r.why ? `<span class="fw">${esc(r.why)}</span>` : ''}</div>`).join('');
  }
  const guideList = (title, items) => `<h4 class="fgh">${esc(title)}</h4><ul class="fgl">${items.map(i => { const o = typeof i === 'string' ? { t: i, ok: true } : i; return `<li class="${o.ok ? '' : 'bad'}">${o.ok ? '' : '⚠ '}${esc(o.t)}</li>`; }).join('')}</ul>`;
  function guidePanel(g, key, title) {
    if (!g) return '';
    const head = x => `<h4 class="fgh">${esc(x.title)}${apx(x.approx)}</h4>`;
    const body = (g.computed ? head(g.computed) + guideRows(g.computed.rows) : '')
      + (g.groups ? g.groups.map(x => head(x) + guideRows(x.rows)).join('')
        : g.steps.map(s => `${head(s)}<p class="fgw"><span class="dim">${esc(s.where)}.</span> ${esc(s.why)}</p>${guideRows(s.rows)}`).join(''))
      + (g.table ? head(g.table) + guideRows(g.table.rows) : '')
      + (g.checks ? guideList('Checks', g.checks) : '')
      + (g.hints ? guideList('Common mistakes', g.hints) : g.mistakes ? guideList('Common mistakes', g.mistakes) : '')
      + (g.notes || []).map(n => `<p class="hint">${esc(n)}</p>`).join('');
    return `<div class="fg"><div class="fgtop"><b>${esc(title)}</b><button type="button" class="btn sm" data-opencli="${esc(key)}">Open CLI</button></div>${body}<p class="hint">${esc(g.note)}</p></div>`;
  }
  function guideFor(key) {
    if (!result || !result.ok) return null;
    if (key === '__vpn') return Guide.vpn(result, project());
    if (String(key).indexOf('pol:') === 0) { const i = Number(String(key).slice(4)), l = Policy.effective(project(), result.allocations); return l[i] ? { cli: polCli(i), alias: Policy.policyName(l[i]) } : null; }
    const i = result.allocations.findIndex(a => a.name === key);
    return i < 0 ? null : Guide.iface(result, project(), i);
  }
  // Network cards are tiles; clicking one opens a modal with the full detail (built fresh each time).
  const tile = (key, swatch, name, type, fields, off) => `<div class="ncard${off ? ' off' : ''}" role="button" tabindex="0" aria-haspopup="dialog" data-name="${esc(key)}">
        <div class="ncsum">
          <span class="nt"><span class="swatch" style="background:${swatch}"></span><b>${esc(name)}</b><span class="ntype">${esc(type)}</span><span class="chev" aria-hidden="true">›</span></span>
          <dl class="nf">${fields.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="mono">${v}</dd></div>`).join('')}</dl>
        </div>
      </div>`;
  const dlRows = rows => `<dl class="nf extra">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="mono">${esc(v)}</dd></div>`).join('')}</dl>`;
  function vpnRows(p) {
    return [['Remote staff planned', `${p.staff} + ${p.growth}% buffer`], ['Pool size', `${p.size.toLocaleString()} (${p.usable.toLocaleString()} usable)`], ['Placement', p.where === 'inside' ? 'office block, outside every network' : 'separate block']];
  }
  function netRows(a) {
    const rows = [['DHCP range', rng(a.dhcpStart, a.dhcpEnd) || 'None'], ['Static range', rng(a.staticStart, a.staticEnd) || 'None'], ['Broadcast', a.broadcast || 'None'], ['Wildcard', a.wildcard], ['Total / usable hosts', `${a.totalAddresses.toLocaleString()} / ${a.usableHosts.toLocaleString()}`]];
    if (a.v6) rows.push(['IPv6 subnet', a.v6.cidr], ['IPv6 gateway', a.v6.address]);
    return rows;
  }
  function vpnCard(off) {
    const p = Remote.plan(result, project()); if (!p || !p.ok) return '';
    return tile('__vpn', '#37c2a0', '👤 Remote staff (VPN)', 'IPsec pool', [['Usable range', `${ipHtml(p.first)} - ${ipHtml(p.last)}`], ['Pool', esc(p.cidr)], ['Netmask', `${ipHtml(p.netmask)} /${esc(String(p.cidr).split('/')[1])}`]], off);
  }
  // Folders: tap one to show only its cards. 'all' shows everything. Remembered per page load only.
  let grpSel = 'all';
  const grpOf = a => Groups.get(Groups.groupId(a));
  function renderCards() {
    const box = $('#cards'), fb = $('#folders');
    if (!result.ok) { box.innerHTML = '<p class="hint">Fix the problem above to see the networks.</p>'; fb.innerHTML = ''; return; }
    const names = cur().networks.map(n => String(n.name).trim());
    const list = result.allocations.slice().sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name));
    const vpn = Remote.plan(result, project()), vpnOk = !!(vpn && vpn.ok);
    const count = id => list.filter(a => Groups.groupId(a) === id).length + (vpnOk && id === 'users' ? 1 : 0);
    const shown = Groups.GROUPS.filter(g => count(g.id));
    if (grpSel !== 'all' && !shown.some(g => g.id === grpSel)) grpSel = 'all';
    fb.innerHTML = `<button type="button" class="folder${grpSel === 'all' ? ' on' : ''}" data-grp="all" aria-pressed="${grpSel === 'all'}"><span class="fe" aria-hidden="true">🗂️</span><b>Show all</b><span class="fc">${list.length + (vpnOk ? 1 : 0)}</span></button>` +
      shown.map(g => `<button type="button" class="folder${grpSel === g.id ? ' on' : ''}" data-grp="${g.id}" aria-pressed="${grpSel === g.id}"><span class="fe" aria-hidden="true">${g.emoji}</span><b>${esc(g.name)}</b><span class="fc">${count(g.id)}</span></button>`).join('');
    const dim = a => grpSel !== 'all' && Groups.groupId(a) !== grpSel;
    box.classList.toggle('sel', grpSel !== 'all');
    box.innerHTML = list.map(a => tile(a.name, color(Math.max(0, names.indexOf(a.name))), `${grpOf(a).emoji} ${a.name}`, typeOf(a),
      [['Usable range', rangeHtml(a)], ['Port / gateway IP', ipHtml(a.gateway || a.firstUsable || '-')], ['Netmask', `${ipHtml(a.netmask)} /${esc(a.prefix)}`]], dim(a))).join('') + (vpnOk ? vpnCard(grpSel !== 'all' && grpSel !== 'users') : '');
  }
  // Optional DHCP DNS for one network (default stays System DNS). Stored per client by network name: project().dhcpDns[name] = { server, domain }.
  function dnsBox(a) {
    if (!a.dhcpStart) return '';
    const d = (project().dhcpDns || {})[a.name] || {};
    return `<div class="dnsbox"><label class="fld">DHCP DNS server (optional)<input data-dns="server" value="${esc(d.server || '')}" placeholder="Same as System DNS" inputmode="decimal" autocomplete="off" spellcheck="false"></label>
      <label class="fld">DNS domain (optional)<input data-dns="domain" value="${esc(d.domain || '')}" placeholder="corp.example.com" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <p class="hint">Windows domain? Put the domain controller here. Empty keeps "Same as System DNS".</p></div>`;
  }
  // Port picker for one network: pick from the ports available; a port used by another network is shown but marked. Stored per client: portMap[network name] = port.
  function portBox(a) {
    const p = project(), pool = Fmt.portPool(p);
    if (!pool.length || a.role === 'Loopback' || a.role === 'WAN') return '';
    const pl = Fmt.portPlan(result.allocations, phOf(), p), mine = pl.names[result.allocations.indexOf(a)];
    if (a.vlan !== '') return `<div class="dnsbox portbox"><p class="hint">This network is a VLAN. It rides on <b class="mono">${esc(pl.parent)}</b> (the VLAN trunk port; change it with Parent port in the Export tab).</p></div>`;
    const use = {}; result.allocations.forEach((x, k) => { if (x !== a) use[pl.names[k]] = x.name; });
    const sel = (p.portMap || {})[a.name];
    return `<div class="dnsbox portbox"><label class="fld">Port<select data-portpick>
      <option value=""${!sel ? ' selected' : ''}>Auto (${esc(mine)})</option>${pool.map(x => `<option value="${esc(x)}"${sel === x ? ' selected' : ''}>${esc(x)}${use[x] ? ' (used by ' + esc(use[x]) + ')' : ''}</option>`).join('')}</select></label>
      <p class="hint">${pl.short.indexOf(a.name) >= 0 ? 'No free port left for this network. Add ports, or give it a VLAN ID.' : 'Pick the physical port this network is plugged into. The CLI, policies and setup steps use it.'}</p></div>`;
  }
  // The card popup: same detail the card used to drop down, over a darkened page.
  let cardOpener = null;
  function openCard(key, opener) {
    if (!result || !result.ok) return;
    const dlg = $('#carddlg'), names = cur().networks.map(n => String(n.name).trim());
    if (key === '__vpn') {
      const p = Remote.plan(result, project()); if (!p || !p.ok) return;
      $('#cardsw').style.background = '#37c2a0'; $('#cardtitle').textContent = 'Remote staff (VPN)'; $('#cardtype').textContent = 'IPsec pool';
      $('#cardbody').innerHTML = dlRows(vpnRows(p)) + guidePanel(Guide.vpn(result, project()), '__vpn', 'Set up the remote staff VPN on the FortiGate');
    } else {
      const i = result.allocations.findIndex(a => a.name === key); if (i < 0) return;
      const a = result.allocations[i];
      $('#cardsw').style.background = color(Math.max(0, names.indexOf(a.name))); $('#cardtitle').textContent = a.name; $('#cardtype').textContent = typeOf(a);
      $('#cardbody').innerHTML = dlRows([['Port / gateway IP', a.gateway || a.firstUsable || '-'], ['Netmask', `${a.netmask} /${a.prefix}`], ['Usable range', rng(a.firstUsable, a.lastUsable) || '-']]) + portBox(a) + dnsBox(a) + dlRows(netRows(a)) + guidePanel(Guide.iface(result, project(), i), a.name, 'Set it up on the FortiGate');
    }
    cardOpener = opener || null; $('#cardbody').scrollTop = 0; dlg.dataset.kind = 'net'; polOpen = -1;
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }
  function closeCard() { const d = $('#carddlg'); if (d.close) d.close(); else d.removeAttribute('open'); if (cardOpener && document.contains(cardOpener)) cardOpener.focus(); }
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
  // Website / application controls for one policy (Accept policies only). Edits go to the popup draft until Save.
  function polWebHtml(p) {
    if (p.action === 'deny') return '<p class="hint">Website and application profiles apply to Accept policies only.</p>';
    const o = (v, l, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(l)}</option>`;
    const web = p.web || { mode: '', sites: '', cats: [] }, app = p.app || { mode: '', cats: [] };
    const cat = (kind, list, sel) => list.map(c => `<label class="check small"><input type="checkbox" data-pcat="${kind}" value="${c.id}"${sel.indexOf(c.id) >= 0 || sel.indexOf(String(c.id)) >= 0 ? ' checked' : ''}> ${esc(c.l)}</label>`).join('');
    const mode = (sel, a, b) => `<option value=""${sel === '' ? ' selected' : ''}>Off</option><option value="allow"${sel === 'allow' ? ' selected' : ''}>${a}</option><option value="block"${sel === 'block' ? ' selected' : ''}>${b}</option>`;
    return `<details class="polmore"${web.mode || app.mode || p.webf ? ' open' : ''}><summary>Websites and applications (optional)</summary>
        <div class="webf"><label>Web filter profile (FortiGuard categories)<select data-wpreset>${o('', 'Off', !p.webf)}${Webcat.PRESET_IDS.map(id => o(id, Webcat.label(id), p.webf && p.webf.preset === id)).join('')}${p.webf && p.webf.preset === 'custom' ? o('custom', 'Custom', true) : ''}</select></label>
          <div class="wgrid">${Webcat.GROUPS.map(g => `<label>${esc(g.label)}<select data-wg="${g.id}"${p.webf ? '' : ' disabled'}>${Webcat.ACTIONS.map(a => o(a.v, a.l, p.webf && Webcat.normGroups(p.webf.groups)[g.id] === a.v)).join('')}</select></label>`).join('')}</div></div>
        <label>Websites<select data-pf="web.mode">${mode(web.mode, 'Allow-list (only these sites)', 'Block-list (block these sites)')}</select></label>
        <textarea data-pf="web.sites" rows="2" spellcheck="false" autocapitalize="off" placeholder="Sites, e.g. example.com, news.example.com">${esc(web.sites || '')}</textarea>
        <div class="catbox">${cat('web', Policy.WEB_CATS, web.cats || [])}</div>
        <label>Application control<select data-pf="app.mode">${mode(app.mode, 'Allow only these categories', 'Block these categories')}</select></label>
        <div class="catbox">${cat('app', Policy.APP_CATS, app.cats || [])}</div>
        <p class="hint">Category IDs are unverified: check them on the lab VM.</p>
      </details>`;
  }
  // ---- policy tiles and popup (same dialog as the network cards) ----
  const SVC_LEGEND = [['HTTPS', 'Secure web, TCP 443'], ['DNS', 'Name lookups, 53'], ['SMB', 'Windows file share, 445'], ['RDP', 'Remote desktop, 3389'], ['SSH', 'Secure command line, 22'], ['HTTP', 'Plain web traffic, 80'], ['PING', 'ICMP ("are you there")']];
  const SVC_EXTRA = { SMTP: 'Email sending, 25', FTP: 'File transfer, 21', NTP: 'Time sync, UDP 123', SP_PRINT: 'Printing, TCP 9100, 631, 515' };
  const polSvcs = p => String(p.service || 'ALL').split(',').map(s => s.trim()).filter(Boolean);
  const polBad = (p, nets) => [p.src, p.dst].some(x => nets.indexOf(x) < 0 && x !== 'internet' && x !== 'internal');
  // For a network name: its interface name (same rule as the CLI) and subnet, or null if it is not in the plan.
  function polEnd(name, ph) {
    if (name === 'internet') return { top: Fmt.WAN_IF, sub: 'the internet side', note: 'all' };
    if (name === 'internal') return { top: 'any', sub: 'All internal networks', note: 'SP_INTERNAL' };
    const al = result.allocations, i = al.findIndex(a => a.name === name);
    return i < 0 ? null : { top: Fmt.ifaceNames(al, ph, project())[i], sub: name, note: al[i].cidr };
  }
  // A stack of slender planks, one per row, joined by small down arrows. The numbers sit in a fixed left gutter: dragging moves the policy, not the number. Implicit deny is the last plank.
  function renderSnake() {
    const box = $('#snake'); if (!box || !result || !result.ok) return;
    const list = Policy.effective(project(), result.allocations), nets = Policy.policyNets(result.allocations), total = list.length + 1;
    const final = '<div class="ncard ptile deny final"><div class="plk"><span class="swatch" style="background:var(--bad)"></span><b class="ptitle">Implicit deny</b><span class="pflow">everything not matched above is blocked (SP_Final_deny)</span><span class="ntype pdeny">DENY</span></div></div>';
    box.innerHTML = list.map((p, i) => polTile(p, i, nets)).concat([final]).map((t, k) => {
      const sc = (1 - 0.18 * k / Math.max(1, total - 1)).toFixed(3);   // planks taper from 100% (rule 1) to 82% (Implicit deny), with the right edge straight and the left edge stepping in
      return `<div class="slot"><span class="snum">${k < total - 1 ? k + 1 : '\u2022'}</span><div class="snk" data-k="${k}" style="--s:${sc}">${t}</div></div>` + (k < total - 1 ? '<div class="sarrow" aria-hidden="true"><span>\u2193</span></div>' : '');
    }).join('');
  }
  function polTile(p, i, nets) {
    const deny = p.action === 'deny';
    const to = p.dst === 'internet' ? 'Internet' : p.dst === 'internal' ? 'All internal networks' : p.dst;
    return `<div class="ncard ptile${deny ? ' deny' : ''}${polBad(p, nets) ? ' bad' : ''}" role="button" tabindex="0" aria-haspopup="dialog" aria-label="Policy ${i + 1}: ${esc(Policy.policyName(p))}" data-pol="${i}">
      <div class="plk"><button type="button" class="phandle" data-phandle aria-label="Drag to reorder policy ${i + 1}" title="Drag to reorder">&#8942;&#8942;</button><span class="swatch" style="background:${deny ? 'var(--bad)' : 'var(--ok)'}"></span><b class="ptitle">${esc(Policy.policyName(p))}</b>
        <span class="pflow">${esc(p.src)} &rarr; ${esc(to)}</span><span class="pchipsm">${polSvcs(p).map(x => `<span class="schip">${esc(x)}</span>`).join('')}</span>
        <span class="ntype ${deny ? 'pdeny' : 'pallow'}">${deny ? 'DENY' : 'ACCEPT'}</span><button type="button" class="pdelx" data-pdel aria-label="Delete policy ${i + 1}" title="Delete">&times;</button></div>
      <div class="pconf" hidden><b>Delete this policy?</b><span><button type="button" class="btn sm danger" data-pdelgo>Delete</button><button type="button" class="btn sm" data-pdelno>Cancel</button></span></div></div>`;
  }
  // The popup body, laid out like the hand-drawn FortiGate policy table. Every cell edits the draft; nothing is stored until Save.
  const SVC_CHIPS = ['ALL', 'HTTPS', 'HTTP', 'DNS', 'SSH', 'RDP', 'SMB', 'SMTP', 'PING', 'FTP', 'NTP', 'SP_PRINT'];
  const polAutoName = p => Policy.policyName(Object.assign({}, p, { name: '' }));
  function polPopHtml(p, i, n, nets, libMap, isNew) {
    const ph = phOf();
    const f = polEnd(p.src, ph), t = polEnd(p.dst, ph), deny = p.action === 'deny', svcs = polSvcs(p);
    const o = (v, l, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(l)}</option>`;
    const miss = x => (nets.indexOf(x) < 0 && x !== 'internet' && x !== 'internal');
    const srcOpts = lab => (miss(p.src) ? o(p.src, '(not in plan) ' + p.src, true) : '') + nets.map(x => o(x, lab ? `${polEnd(x, ph).top} \u00b7 ${x}` : x, p.src === x)).join('');
    const dstOpts = lab => o('internet', lab ? `${Fmt.WAN_IF} \u00b7 Internet` : 'Internet (all)', p.dst === 'internet') + o('internal', lab ? 'any \u00b7 All internal networks' : 'All internal networks', p.dst === 'internal') + (miss(p.dst) ? o(p.dst, '(not in plan) ' + p.dst, true) : '') + nets.map(x => o(x, lab ? `${polEnd(x, ph).top} \u00b7 ${x}` : x, p.dst === x)).join('');
    const names = SVC_CHIPS.concat(svcs.filter(x => SVC_CHIPS.indexOf(x) < 0));
    const chips = names.map(x => `<button type="button" class="schip tog${svcs.indexOf(x) >= 0 ? ' on' : ''}" data-psvc="${esc(x)}" aria-pressed="${svcs.indexOf(x) >= 0}">${esc(x)}</button>`).join('');
    const used = svcs.filter(x => x !== 'ALL');
    const legend = SVC_LEGEND.map(([k, v]) => [k, v]).concat(used.filter(x => SVC_EXTRA[x]).map(x => [x, SVC_EXTRA[x]]));
    const natNote = deny ? 'Not used on a deny rule.' : p.nat ? 'Swaps the private address for a public one (the public address from your ISP).' : 'Off: private addresses stay as they are, normal between your own networks.';
    return `<div class="popol${deny ? ' deny' : ''}" data-pi="${i}">
      <div class="polhead"><span class="dim small">${isNew ? 'New policy, added above the Implicit deny when you Save' : `Policy ${i + 1} of ${n}`}${polBad(p, nets) ? ' \u00b7 a network in this policy is not in the plan' : ''}</span>
        ${isNew ? '' : `<span class="polbtns"><button type="button" class="btn sm" data-pact="up" aria-label="Move up"${i === 0 ? ' disabled' : ''}>\u2191</button><button type="button" class="btn sm" data-pact="down" aria-label="Move down"${i === n - 1 ? ' disabled' : ''}>\u2193</button><button type="button" class="btn sm" data-pact="del" aria-label="Delete policy">\u00d7</button></span>`}</div>
      ${polCardHtml(p, libMap)}
      <div class="ptable">
        <div class="pcell pname"><label class="plab" for="pf-name">Name</label><input id="pf-name" data-pf="name" value="${esc(p.name || '')}" placeholder="${esc(polAutoName(p))}" autocomplete="off" spellcheck="false"><span class="phint">label the rule; empty uses the automatic name</span></div>
        <div class="pcell"><span class="plab">Incoming interface</span><select data-pf="src" aria-label="Incoming interface">${srcOpts(true)}</select><span class="phint">where the traffic comes in</span></div>
        <div class="pcell"><span class="plab">Outgoing interface</span><select data-pf="dst" aria-label="Outgoing interface">${dstOpts(true)}</select><span class="phint">where the traffic goes out</span></div>
        <div class="pcell"><span class="plab">Source</span><select data-pf="src" aria-label="Source">${srcOpts(false)}</select><span class="psub mono">${esc(f && f.note ? f.note : '')}</span></div>
        <div class="pcell"><span class="plab">Destination</span><select data-pf="dst" aria-label="Destination">${dstOpts(false)}</select><span class="psub mono">${esc(t ? (p.dst === 'internet' ? 'all (the internet)' : t.note) : '')}</span></div>
        <div class="pcell"><span class="plab">Service</span><span class="phint">which kind of traffic? Tap to switch on or off</span><span class="pchips">${chips}</span></div>
        <div class="pcell pact ${deny ? 'deny' : 'allow'}"><span class="plab">Action</span><select data-pf="action" class="pactsel" aria-label="Action">${o('accept', 'ACCEPT (allow)', !deny)}${o('deny', 'DENY (block)', deny)}</select></div>
        <div class="pcell pnat"><span class="plab">NAT (network address translation)</span>
          <label class="check"><input type="checkbox" data-pf="nat"${p.nat && !deny ? ' checked' : ''}${deny ? ' disabled' : ''}> <b class="pmain">${p.nat && !deny ? 'ON' : 'OFF'}</b></label><span class="phint">${esc(natNote)}</span>
          <label class="check small"><input type="checkbox" data-pf="log"${p.log !== false ? ' checked' : ''}> Log traffic</label></div>
      </div>
      <div class="plegend"><span class="plab">Policy services</span>${legend.map(([k, v]) => `<span class="lg${svcs.indexOf(k) >= 0 ? ' used' : ''}"><span class="schip">${esc(k)}</span> ${esc(v)}</span>`).join('')}</div>
      <div class="polform">${polWebHtml(p)}</div>
      ${isNew ? '' : `<div class="fg"><div class="fgtop"><b>Set it up on the FortiGate</b><button type="button" class="btn sm" data-opencli="pol:${i}">Open CLI</button></div>
        <p class="hint">Policy &amp; Objects, then Firewall Policy, then Create new. Open CLI shows the saved version of this policy with its address objects. Policies use edit 0: pasting twice makes duplicates. ${esc(Policy.NOTE)}</p></div>`}
      <div class="pfoot"><span class="dirtymsg" role="status"></span><button type="button" class="btn" data-pcancel>Cancel</button><button type="button" class="btn primary" data-psave>Save</button></div>
    </div>`;
  }
  let polOpen = -1, polDraft = null, polOrig = '', polNew = false;
  const polDirty = () => !!polDraft && (polNew || JSON.stringify(polDraft) !== polOrig);
  function openAddPol(opener) {
    if (!result || !result.ok) return;
    const dlg = $('#carddlg'); dlg.dataset.kind = 'add'; polOpen = -1;
    $('#cardsw').style.background = 'var(--accent)'; $('#cardtitle').textContent = 'Add new policy'; $('#cardtype').textContent = 'New';
    $('#cardbody').innerHTML = `<div class="addpol"><label class="fld">Describe a policy in a sentence
        <textarea id="tagline" rows="2" autocomplete="off" spellcheck="false" placeholder="e.g. Guests can access the internet but nothing else">${esc(cur().tagline || '')}</textarea></label>
      <p class="hint">Understood: "X internet only", "X can't reach Y", "X blocked from Y", "X can reach Y on https". Use network names from the plan. Separate several with a full stop.</p>
      <div class="btnrow"><button type="button" class="btn sm primary" data-padd="parse">Build policies from this</button><button type="button" class="btn sm" data-padd="blank">Or add a blank policy</button></div>
      <p id="parsemsg" class="hint" role="status"></p></div>`;
    if (opener) cardOpener = opener;
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
    $('#tagline').focus();
  }
  // Open the popup on a draft copy of policy i (or a blank one). Changes stay in the draft until Save; Cancel, Esc and Close discard it.
  function openPol(i, opener, blank) {
    if (!result || !result.ok) return;
    const list = Policy.effective(project(), result.allocations);
    if (blank) { const nets = Policy.policyNets(result.allocations); if (!nets.length) return; polDraft = Policy.mkPolicy({ src: nets[0], dst: 'internet', service: 'ALL', action: 'accept', nat: true }); polNew = true; polOpen = list.length; }
    else { if (!list[i]) { closeCard(); return; } polDraft = JSON.parse(JSON.stringify(list[i])); polNew = false; polOpen = i; }
    polOrig = JSON.stringify(polDraft);
    if (opener) cardOpener = opener;
    renderPolPop();
    const dlg = $('#carddlg'); if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
  }
  function renderPolPop() {
    if (!polDraft || !result || !result.ok) return;
    const list = Policy.effective(project(), result.allocations), p = polDraft, i = polOpen, deny = p.action === 'deny', body = $('#cardbody'), keep = body.scrollTop;
    const nets = Policy.policyNets(result.allocations), lib = Policy.cardView(project(), result.allocations), libMap = new Map(lib.map(e => [e.card.id, e]));
    $('#carddlg').dataset.kind = 'pol';
    $('#cardsw').style.background = deny ? 'var(--bad)' : 'var(--ok)'; $('#cardtitle').textContent = polNew ? 'New policy' : `${i + 1}. ${Policy.policyName(p)}`; $('#cardtype').textContent = deny ? 'DENY' : 'ACCEPT';
    body.innerHTML = polPopHtml(p, i, list.length, nets, libMap, polNew);
    body.scrollTop = keep; polFoot();
  }
  function polFoot() { const m = $('#cardbody').querySelector('.dirtymsg'); if (m) m.textContent = polDirty() ? 'Unsaved changes' : ''; }
  // One policy as a standalone snippet: the full generator run with just this policy in the list.
  function polCli(i) {
    const p = project(), list = Policy.effective(p, result.allocations); if (!list[i]) return '';
    return Fmt.toPolicyFortiOS(result, Object.assign({}, p, { pol: { edited: true, list: [list[i]], toggles: {} } }), p.ifName);
  }
  function renderPolicyCli() { const t = text('polcli'); $('#pre-polcli').textContent = t || 'Fix the problem at the top to enable this output.'; }
  function renderPolicies() {
    const c = cur();
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
      '<p class="hint">Rule 1 is checked first, then each plank down the stack. Drag the dots to reorder. Traffic takes the first rule that matches, and the last tile catches everything else. Tap a policy to see and edit it.</p><div class="snake" id="snake"></div>';
    renderSnake();
    renderPolicyCli();
    if (polDraft && $('#carddlg').dataset.kind === 'pol' && $('#carddlg').open) renderPolPop();
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
    const box = $('#pollist'), pop = $('#cardbody');
    const edit = fn => { const list = materialize(); fn(list); touch(); };
    const rerender = () => { renderPolicies(); renderSummaries(); };
    pop.addEventListener('change', e => {
      const t = e.target; if (!polDraft || !t.closest('.popol')) return;
      const p = polDraft, wasAuto = !p.name || p.name === polAutoName(p), kept = p.name;
      if (t.dataset.pf) { if (t.dataset.pf === 'name') return; setPath(p, t.dataset.pf, t.type === 'checkbox' ? t.checked : t.value); if (!wasAuto) p.name = kept; }
      else if (t.dataset.wpreset !== undefined) { if (t.value !== 'custom') Policy.setWebPreset(p, t.value, cur().intake.industry); }
      else if (t.dataset.wg) Policy.setWebGroup(p, t.dataset.wg, t.value);
      else if (t.dataset.pcat) {
        const k = t.dataset.pcat, o = k === 'web' ? (p.web = p.web || { mode: '', sites: '', cats: [] }) : (p.app = p.app || { mode: '', cats: [] });
        const id = Number(t.value); o.cats = (o.cats || []).map(Number).filter(x => x !== id); if (t.checked) o.cats.push(id);
      } else return;
      renderPolPop();
    });
    pop.addEventListener('input', e => {
      const t = e.target; if (!polDraft || !t.dataset || (t.dataset.pf !== 'web.sites' && t.dataset.pf !== 'name')) return;
      if (t.dataset.pf === 'name') polDraft.name = t.value.trim(); else setPath(polDraft, 'web.sites', t.value);
      polFoot();
      if (t.dataset.pf === 'name') $('#cardtitle').textContent = polNew ? 'New policy' : `${polOpen + 1}. ${Policy.policyName(polDraft)}`;
    });
    pop.addEventListener('click', e => {
      const c = e.target.closest('[data-psvc]');
      if (c && polDraft) {
        const v = c.dataset.psvc; let cur2 = polSvcs(polDraft).filter(x => x !== 'ALL');
        if (v === 'ALL') cur2 = []; else cur2 = cur2.indexOf(v) >= 0 ? cur2.filter(x => x !== v) : cur2.concat(v);
        const order = SVC_CHIPS.concat(cur2.filter(x => SVC_CHIPS.indexOf(x) < 0));
        polDraft.service = cur2.length ? order.filter(x => cur2.indexOf(x) >= 0).join(',') : 'ALL';
        renderPolPop(); return;
      }
      if (e.target.closest('[data-pcancel]')) { closeCard(); return; }
      if (e.target.closest('[data-psave]') && polDraft) {
        const d = polDraft, i = polOpen, isNew = polNew; polDraft = null;
        edit(list => { if (isNew) list.push(d); else list[i] = d; });
        closeCard(); rerender(); toast(isNew ? 'Policy added' : 'Policy saved'); return;
      }
    });
    pop.addEventListener('click', e => {
      const b = e.target.closest('[data-pact]'); if (!b) return;
      const i = polOpen, a = b.dataset.pact; let j = i;
      if (a === 'del' && !b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Delete?'; b.classList.add('danger'); setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = '\u00d7'; b.classList.remove('danger'); } }, 3000); return; }
      edit(list => {
        if (a === 'del') list.splice(i, 1);
        else { j = a === 'up' ? i - 1 : i + 1; if (j >= 0 && j < list.length) { const x = list[i]; list[i] = list[j]; list[j] = x; } else j = i; }
      });
      if (a === 'del') { polDraft = null; rerender(); closeCard(); toast('Policy deleted'); return; }
      polOpen = j; rerender();
    });
    const delPol = i => { edit(list => { list.splice(i, 1); }); renderPolicies(); renderSummaries(); toast('Policy deleted'); };
    let justDragged = false;
    box.addEventListener('click', e => {
      if (justDragged) return;
      const t = e.target, tile = t.closest('[data-pol]'); if (!tile) return;
      const i = Number(tile.dataset.pol);
      if (t.closest('[data-phandle]')) return;
      if (t.closest('[data-pdel]')) { tile.querySelector('.pconf').hidden = false; tile.querySelector('[data-pdelno]').focus(); return; }
      if (t.closest('[data-pdelno]')) { tile.querySelector('.pconf').hidden = true; return; }
      if (t.closest('[data-pdelgo]')) { delPol(i); return; }
      if (t.closest('.pconf')) return;
      openPol(i, tile);
    });
    box.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset && e.target.dataset.pol !== undefined) { e.preventDefault(); openPol(Number(e.target.dataset.pol), e.target); } });
    // Drag to reorder with live feedback: the picked-up plank follows the pointer; the planks it passes slide up or down to open a gap where it will land (numbers stay put); letting go snaps it into the gap.
    let drag = null;
    const scrollParent = el => { for (let n = el.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n; } return null; };
    const clearDrag = () => { if (!drag) return; clearInterval(drag.timer); drag.snks.forEach(x => { x.style.transform = ''; x.classList.remove('dragging', 'shifted'); }); box.classList.remove('dragmode'); drag = null; };
    box.addEventListener('pointerdown', e => {
      const h = e.target.closest('[data-phandle]'); if (!h || (e.pointerType === 'mouse' && e.button !== 0) || drag) return;
      const tile = h.closest('[data-pol]'), snks = Array.from(box.querySelectorAll('.snk'));
      drag = { i: Number(tile.dataset.pol), id: e.pointerId, snks, x0: e.clientX, y0: e.clientY, on: false, to: Number(tile.dataset.pol), last: e };
      drag.snk = snks[drag.i]; drag.n = snks.length - 1;           // the last plank is Implicit deny: it never moves or takes a slot
      try { h.setPointerCapture(e.pointerId); } catch (x) { /* older browsers */ }
      e.preventDefault();
    });
    const slotsAt = () => { const top = box.getBoundingClientRect().top; return drag.snks.map(x => { const r = x.getBoundingClientRect(); return { top: r.top - top, mid: r.top - top + r.height / 2 }; }); };
    const dragAt = e => {
      const top = box.getBoundingClientRect().top, dy = e.clientY - drag.y0 - (top - drag.box0), dx = e.clientX - drag.x0, S = drag.slots, f = drag.i;
      drag.snk.style.transform = `translate(${dx}px, ${dy}px)`;
      const mid = S[f].mid + dy; let t = 0;
      for (let k = 1; k < drag.n; k++) if (Math.abs(S[k].mid - mid) < Math.abs(S[t].mid - mid)) t = k;
      drag.to = t;
      drag.snks.forEach((x, k) => {
        if (k === f || k >= drag.n) return;
        const j = t > f && k > f && k <= t ? k - 1 : t < f && k >= t && k < f ? k + 1 : k;   // the slot this plank slides into
        x.style.transform = j === k ? '' : `translateY(${S[j].top - S[k].top}px)`;
      });
    };
    const tick = () => {
      if (!drag || !drag.on) return;
      const e = drag.last, r = drag.sp ? drag.sp.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const d = e.clientY < r.top + 60 ? -12 : e.clientY > r.bottom - 60 ? 12 : 0;
      if (d) { if (drag.sp) drag.sp.scrollTop += d; else window.scrollBy(0, d); dragAt(e); }
    };
    box.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      drag.last = e;
      if (!drag.on) {
        if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
        drag.on = true; drag.slots = slotsAt(); drag.box0 = box.getBoundingClientRect().top; drag.sp = scrollParent(box);
        drag.snks.forEach((x, k) => x.classList.toggle('shifted', k !== drag.i)); drag.snk.classList.add('dragging'); box.classList.add('dragmode');
        drag.timer = setInterval(tick, 30);
      }
      dragAt(e);
    });
    box.addEventListener('pointerup', e => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.on) { clearDrag(); return; }
      const from = drag.i, to = drag.to, d = drag, S = d.slots;
      justDragged = true; setTimeout(() => { justDragged = false; }, 0);
      clearInterval(d.timer); d.snk.classList.add('shifted'); d.snk.classList.remove('dragging');     // glide into the gap, then commit
      const top = box.getBoundingClientRect().top;
      d.snk.style.transform = `translateY(${S[to].top - S[from].top - (top - d.box0)}px)`;
      drag = null;
      setTimeout(() => {
        d.snks.forEach(x => { x.style.transform = ''; x.classList.remove('shifted'); }); box.classList.remove('dragmode');
        if (to !== from) { edit(list => { const x = list.splice(from, 1)[0]; list.splice(to, 0, x); }); renderPolicies(); renderSummaries(); toast(`Moved to ${to + 1}`); }
      }, 170);
    });
    box.addEventListener('pointercancel', clearDrag);
    // Library cards: before the first edit this only records the switch (the list keeps following the plan); after it, the card's rules are added or removed.
    $('#cardlist').addEventListener('change', e => {
      const t = e.target; if (!t.dataset.card || !result.ok) return;
      const c = cur();
      if (c.pol && c.pol.edited) c.pol.list = Policy.setCardInList(c.pol.list, t.dataset.card, t.checked, result.allocations, Policy.cardCtx(project(), result.allocations));
      else { c.pol = c.pol || { edited: false, list: [] }; c.pol.toggles = c.pol.toggles || {}; c.pol.toggles[t.dataset.card] = t.checked; }
      touch(); renderPolicies(); renderSummaries();
    });
    $('#btnNewPol').addEventListener('click', e => openAddPol(e.currentTarget));
    $('#btnResetPol').addEventListener('click', () => { cur().pol = { edited: false, list: [], toggles: {} }; touch(); renderPolicies(); renderSummaries(); toast('Back to the default policies for this plan'); });
    pop.addEventListener('input', e => { if (e.target.id === 'tagline') { cur().tagline = e.target.value; touch(); } });
    pop.addEventListener('click', e => {
      const b = e.target.closest('[data-padd]'); if (!b || !result.ok) return;
      if (b.dataset.padd === 'blank') { openPol(0, null, true); return; }
      const txt = $('#tagline').value.trim(); cur().tagline = txt; touch();
      if (!txt) { polMsg('Type a sentence first, or add a blank policy.', true); return; }
      const parsed = Policy.parse(txt, result.allocations);
      const bad = parsed.unparsed.map(u => `"${u.text}" (${u.why})`).join('; ');
      if (!parsed.policies.length) { polMsg(`I didn't understand that${bad ? ': ' + bad : ''}. Networks in this plan: ${Policy.policyNets(result.allocations).join(', ')}. Or add a blank policy and use the dropdowns.`, true); return; }
      edit(list => { cur().pol.list = Policy.apply(list, parsed); });
      renderPolicies(); renderSummaries(); closeCard();
      toast(`Added ${parsed.policies.length} polic${parsed.policies.length === 1 ? 'y' : 'ies'} at the top. Check them.${bad ? ' Not understood: ' + bad + '.' : ''}`);
    });
    let rz = 0; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(renderSnake, 120); });
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
    const cardsBox = $('#cards');
    $('#folders').addEventListener('click', e => { const f = e.target.closest('.folder'); if (f) { grpSel = f.dataset.grp; renderCards(); const n = $('#folders').querySelector(`[data-grp="${grpSel}"]`); if (n) n.focus(); } });
    cardsBox.addEventListener('click', e => { const c = e.target.closest('.ncard'); if (c) openCard(c.dataset.name, c); });
    cardsBox.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('ncard')) { e.preventDefault(); openCard(e.target.dataset.name, e.target); } });
    $('#cardclose').addEventListener('click', closeCard);
    $('#carddlg').addEventListener('close', () => { polDraft = null; polNew = false; });
    // Per-network DHCP DNS (optional): saved on input, the CLI/guide rows refresh on change.
    const dnsSave = () => { const c = cur(), name = $('#cardtitle').textContent; c.dhcpDns = c.dhcpDns || {}; const d = c.dhcpDns[name] = c.dhcpDns[name] || {}; $('#cardbody').querySelectorAll('[data-dns]').forEach(i => { d[i.dataset.dns] = i.value.trim(); }); touch(); };
    $('#cardbody').addEventListener('input', e => { if (e.target.dataset && e.target.dataset.dns) { dnsSave(); renderExport(); } });
    $('#cardbody').addEventListener('change', e => {
      if (e.target.dataset && e.target.dataset.portpick !== undefined) {
        const c = cur(), name = $('#cardtitle').textContent; c.portMap = c.portMap || {};
        if (e.target.value) { Object.keys(c.portMap).forEach(k => { if (c.portMap[k] === e.target.value) delete c.portMap[k]; }); c.portMap[name] = e.target.value; } else delete c.portMap[name];
        touch(); recalc();
        const i = result.allocations.findIndex(a => a.name === name), g = guideFor(name), fg = $('#cardbody').querySelector('.fg');
        if (i >= 0) $('#cardbody').querySelector('.portbox').outerHTML = portBox(result.allocations[i]);
        if (g && fg) fg.outerHTML = guidePanel(g, name, 'Set it up on the FortiGate');
        return;
      }
      if (!(e.target.dataset && e.target.dataset.dns)) return;
      const name = $('#cardtitle').textContent, g = guideFor(name), fg = $('#cardbody').querySelector('.fg');
      if (g && fg) fg.outerHTML = guidePanel(g, name, 'Set it up on the FortiGate');
    });
    $('#carddlg').addEventListener('click', e => {
      if (e.target === $('#carddlg')) { if ($('#carddlg').dataset.kind === 'pol' && polDirty()) { toast('Unsaved changes: Save or Cancel'); return; } closeCard(); return; }                    // backdrop click (Esc is native)
      const b = e.target.closest('[data-opencli]'); if (!b) return;
      const g = guideFor(b.dataset.opencli); if (!g) return;
      const d = $('#clidlg');
      $('#clititle').textContent = 'FortiOS CLI: ' + (g.alias || 'Remote staff VPN');
      $('#clitext').value = g.cli; d.returnFocusTo = b;
      if (d.showModal) d.showModal(); else d.setAttribute('open', '');
      $('#clitext').focus(); $('#clitext').select();
    });
    const dlg = $('#clidlg'), closeDlg = () => { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); if (dlg.returnFocusTo) dlg.returnFocusTo.focus(); };
    $('#cliclose').addEventListener('click', closeDlg);
    dlg.addEventListener('click', e => { if (e.target === dlg) closeDlg(); });   // backdrop click (Esc is native)
    $('#clicopy').addEventListener('click', async () => toast((await copy($('#clitext').value)) ? 'Copied the FortiOS CLI' : 'Copy was blocked. Select the text and copy it.'));
  }

  function recalc() {
    if (!cur()) return;
    result = Calc.plan(project());
    Calc6.annotate(result, cur().v6).forEach(w => result.warnings.push(w));
    $('#i-parent').placeholder = cur().parentAuto === false ? 'auto' : `auto (${cur().parent || 'none free'})`;
    renderV6Msg(); renderWarn(); renderSummaries();
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
  bindTheme(); bindSide(); bindClients(); bindIntake(); bindContract(); bindTopo(); bindOutputs(); bindAccordion(); bindPolicies(); bindRemote(); bindCopyIps();
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
  if (!cur()) {
    const left = Object.values(store.clients).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    if (left.length) store.current = left[0].id; else { const c = Intake.newClient('New client'); c.updated = Date.now(); store.clients[c.id] = c; store.current = c.id; }
  }
  (function first() {
    const c = cur(); Intake.migrate(c); Intake.applyIntake(c);
    renderClientSel(); renderIntake(); recalc();
    initSide();
  }());
  setOpen('plan', false);
  registerSW();
  const legacy = { clients: 'plan', intake: 'plan', plan: 'plan', map: 'diagram', outputs: 'export' };
  window.SubnetPal = {
    get state() { return store; }, get result() { return result; }, recalc, setOpen,
    show: v => { if (SECTIONS.indexOf(v) >= 0) setOpen(v, true); else if (legacy[v]) setOpen(legacy[v], true); },
  };
}());
