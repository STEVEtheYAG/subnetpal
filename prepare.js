/* SubnetPal - Prepare tab: client notes read by rules (nouns, networks, flows), the 8-step reading order, and flows (who, what, how) turned into a draft policy. Pure, no DOM. window.Prep / Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./policy.js'));
  else root.Prep = factory(root.Policy);
}(typeof self !== 'undefined' ? self : this, function (Policy) {
  'use strict';

  // tab: the results tab where the step is done (opened by its Go button), '' when it happens on paper or on this tab.
  const STEPS = [
    { id: 'nouns', title: 'Underline the nouns', text: 'Read the brief and underline every person, place, device and service. These become your networks, objects and flows.', tab: '' },
    { id: 'map', title: 'Draw the map', text: 'Sketch the internet, the firewall and each group of people or devices on the drawing board below.', tab: '' },
    { id: 'base', title: 'Base build', text: 'Interfaces, VLANs, addresses, DHCP, DNS and routes. Fill in the client info, then check the Plan tab.', tab: 'plan' },
    { id: 'flows', title: 'List the flows', text: 'Who needs to reach what, and how. One row per flow in the flows table below.', tab: '' },
    { id: 'pols', title: 'Policies', text: 'One policy per flow, most specific first, deny everything else last. Use Make policy on each flow.', tab: 'policies' },
    { id: 'admin', title: 'Admin', text: 'Admin access from Management only (trusted hosts), MFA, a backup admin, and a config backup. See the pre-flight checklist.', tab: 'export' },
    { id: 'vpn', title: 'VPN', text: 'Remote staff and site-to-site tunnels, and what each can reach.', tab: 'remote' },
    { id: 'prove', title: 'Prove it', text: 'Test every flow (allowed and blocked), check the logs, then hand over the report.', tab: 'export' },
  ];
  const MAX_FLOWS = 60;
  const DENY_WORDS = /\b(?:block|blocked|deny|denied|no|not|never|none|nothing)\b/;

  // Stored prep data is untrusted: keep only known fields and sane sizes.
  // text: the one free-type notes page. Older saves had notes per step (v54) and a brief box (v53): both fold into text, nothing lost.
  const MAX_TEXT = 40000;
  const DETAIL_KEYS = ['contact', 'phone', 'email', 'address', 'date', 'engineer'];
  function normalize(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const steps = {};
    STEPS.forEach(s => { if (r.steps && r.steps[s.id] === true) steps[s.id] = true; });
    const s = v => String(v == null ? '' : v).slice(0, 200);
    const flows = (Array.isArray(r.flows) ? r.flows : []).slice(0, MAX_FLOWS).filter(f => f && typeof f === 'object').map(f => ({ who: s(f.who), what: s(f.what), how: s(f.how) }));
    const nt = v => String(v == null ? '' : v).slice(0, 20000);
    let text = typeof r.text === 'string' ? r.text : '';
    const parts = [];
    STEPS.forEach(st => {
      const v = r.notes && typeof r.notes === 'object' ? nt(r.notes[st.id]) : '';
      if (v.trim()) parts.push(st.id === 'nouns' ? v : `${st.title}:\n${v}`);
    });
    const old = nt(r.brief);
    if (old.trim()) parts.push(old);
    if (parts.length) text = (text.trim() ? text + '\n\n' : '') + parts.join('\n\n');
    return { steps, text: text.slice(0, MAX_TEXT), flows, board: r.board && typeof r.board === 'object' ? r.board : null };
  }
  // Client details typed on the Prepare tab (name and site live on the client itself, shared with the Client info panel).
  function normDetails(raw) {
    const r = raw && typeof raw === 'object' ? raw : {}, d = {};
    DETAIL_KEYS.forEach(k => { d[k] = String(r[k] == null ? '' : r[k]).slice(0, 200); });
    return d;
  }
  const progress = steps => STEPS.filter(s => steps && steps[s.id]).length;

  // One flow -> a draft policy for the policy popup, plus what could not be worked out (the engineer fixes it in the popup).
  // who: a network from the plan. what: a network, "internet" or "all internal". how: services ("https, rdp"), or "block".
  function flowToPolicy(flow, allocs) {
    const f = flow || {}, why = [];
    const table = Policy.aliasTable(allocs), nets = Policy.policyNets(allocs);
    const low = v => String(v || '').toLowerCase().replace(/[‘’`]/g, "'").trim();
    const who = low(f.who), what = low(f.what), how = low(f.how);
    let src = Policy.mentions(who, table).filter(t => t !== 'internet')[0];
    if (!src) { src = nets[0] || ''; why.push(who ? `"${f.who}" is not a network in the plan: pick the source` : 'no "who": pick the source'); }
    let dst = /\b(?:all internal|internal|everything inside|all networks|lan)\b/.test(what) && !Policy.mentions(what, table).filter(t => t !== 'internet').length ? 'internal' : Policy.mentions(what, table)[0];
    if (!dst) { dst = 'internet'; why.push(what ? `"${f.what}" is not a network in the plan: pick the destination` : 'no "what": pick the destination'); }
    const deny = DENY_WORDS.test(how);
    const words = how.replace(new RegExp(DENY_WORDS.source, 'g'), ' ').replace(/\b(?:access|access to|to|only|allowed|allow|from)\b/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[,/+&\s]+|[,/+&\s]+$/g, '');
    let service = '';
    if (words) { const sv = Policy.serviceOf('on ' + words); if (sv.error) why.push(sv.error + ': pick the services'); else service = sv.service; }
    if (!service) service = deny ? 'ALL' : dst === 'internet' ? 'DNS,HTTP,HTTPS,NTP,PING,SP_QUIC' : 'PING';
    if (!deny && service === 'ALL') why.push('ALL services on an allow is wide open: narrow it down');
    if (!deny && !words && dst !== 'internet') why.push('no "how": pick the services');
    const p = Policy.mkPolicy({ src, dst, service, action: deny ? 'deny' : 'accept', nat: !deny && dst === 'internet',
      comments: `From the brief: ${[f.who, f.what, f.how].map(x => String(x || '').trim() || '?').join(' / ')}`.slice(0, 1023) });
    return { policy: p, why };
  }

  // ---------- reading the notes: rule-based, offline, no AI ----------
  // Network kinds SubnetPal plans, and the name each gets in the build (matches intake.js).
  const KIND_NAME = { mgmt: 'Management', staff: 'Staff LAN', servers: 'Servers', guest: 'Guest', dmz: 'DMZ', voice: 'Voice', cameras: 'Cameras', iot: 'IoT', printers: 'Printers', pos: 'POS' };
  // Order matters: the first match wins (guest before staff, payments before servers).
  const KIND_WORDS = [
    ['guest', /\b(?:guests?|visitors?|patients?|waiting room|public wi-?fi|customers?|byod)\b/],
    ['pos', /\b(?:pos|eftpos|payments?|card (?:terminals?|machines?|readers?)|tills?|pci)\b/],
    ['mgmt', /\b(?:mgmt|management|admin network|switch(?:es)?|access points?|aps|fortiaps?|fortiswitch(?:es)?)\b/],
    ['dmz', /\b(?:dmz|public servers?|web servers?)\b/],
    ['servers', /\b(?:servers?|nas|file shares?|domain controllers?)\b/],
    ['printers', /\b(?:printers?|copiers?|mfds?|scanners?)\b/],
    ['voice', /\b(?:voice|voip|desk phones?|handsets?|pbx)\b/],
    ['cameras', /\b(?:cameras?|cctv|nvr)\b/],
    ['iot', /\b(?:iot|smart (?:tvs?|devices?)|sensors?|tvs?)\b/],
    ['staff', /\b(?:staff|employees?|users?|office|pcs?|laptops?|desktops?|workstations?|tablets?|corporate|lan|physios?|doctors?|nurses?|reception|teachers?|admins?|owners?|managers?)\b/],
  ];
  const kindOf = t => { const l = String(t || '').toLowerCase(); const k = KIND_WORDS.find(([, re]) => re.test(l)); return k ? k[0] : ''; };
  const PEOPLE = /\b(?:staff|people|persons?|users?|employees?|physios?|doctors?|nurses?|dentists?|reception(?:ists?)?|billing|admins?|teachers?|students?|visitors?|guests?|patients?|contractors?|managers?|owners?|accountants?|team|workers?)\b/;
  const DEVICES = /\b(?:pcs?|laptops?|desktops?|computers?|tablets?|ipads?|phones?|handsets?|printers?|copiers?|scanners?|terminals?|cameras?|access points?|aps|switch(?:es)?|tvs?|devices?|tills?|sensors?|nvr)\b/;
  const SERVERS = /\b(?:servers?|nas|apps?|application|database|domain controller)\b/;
  const SECTION_WORDS = [
    ['networks', /network|vlan|subnet/], ['flows', /flow|rule|access|traffic|polic/], ['admin', /admin/], ['vpn', /vpn|remote/],
    ['prove', /done|prove|test|accept|success|sign.?off/], ['servers', /server|app/], ['devices', /device|hardware|equipment/], ['people', /people|user|group|staff|who/],
  ];
  const SVC = [
    [/\bhttps\b/, 'https'], [/\bhttp\b/, 'http'], [/\bweb\b|\bbrows(?:e|ing)\b/, 'web'], [/\bdns\b/, 'dns'], [/\bntp\b/, 'ntp'],
    [/\brdp\b|remote desktop/, 'rdp'], [/\bssh\b/, 'ssh'], [/\bsmb\b|file shar|scan-to-folder|scan to folder/, 'smb'], [/\bprint(?:ing)?\b|\bipp\b/, 'print'],
    [/\bping\b|\bicmp\b/, 'ping'], [/\bsmtp\b|\be-?mail\b/, 'smtp'], [/\bftp\b/, 'ftp'],
  ];
  const PORTS = { 443: 'https', 80: 'http', 53: 'dns', 123: 'ntp', 3389: 'rdp', 22: 'ssh', 445: 'smb', 9100: 'print', 631: 'print', 25: 'smtp', 21: 'ftp' };
  const STOP = new Set('the and for with from all only size two three four five one six this that their they into onto out per also some use used plus via'.split(' '));
  const words = t => String(t || '').toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOP.has(w)).map(w => w.replace(/s$/, ''));
  const clean = t => String(t || '').replace(/\s+/g, ' ').trim();
  const cap = (t, n) => clean(t).slice(0, n || 120);
  const firstNum = t => { const m = /\b(\d{1,5})\b/.exec(t); return m ? +m[1] : 0; };

  function headingOf(line) {
    let m = /^#{1,6}\s*(.+)$/.exec(line) || /^([A-Z][A-Z&/ -]{2,}[A-Z])(?=\s*(?:$|\(|:|\.))/.exec(line) || /^([A-Za-z][A-Za-z &/-]{2,30}):\s*$/.exec(line);
    if (!m) return '';
    const h = m[1].toLowerCase(), hit = SECTION_WORDS.find(([, re]) => re.test(h));
    return hit ? hit[0] : 'other';
  }

  // "Name: 6, rest" / "12 staff PCs, 4 tablets" -> [{ name, count }]
  function itemsOf(line, isServer) {
    const l = line.replace(/\([^)]*\)/g, ' ');
    let m = /^([^:]{2,40}):\s*(.*)$/.exec(l);
    if (m) return [{ name: cap(m[1], 40), count: isServer ? 0 : firstNum(m[2]) }];
    return l.split(/\s*[,;]\s*/).map(p => { const n = /^(\d{1,5})\s+(.+)$/.exec(p.trim()); return n ? { name: cap(n[2], 40), count: +n[1] } : (isServer && p.trim() ? { name: cap(p, 40), count: 0 } : null); }).filter(Boolean);
  }

  function howOf(text) {
    const h = String(text || '').toLowerCase();
    const allowWord = /\b(?:allow|allowed|permit|ok|yes|can)\b/.test(h);
    const deny = /^\s*(?:deny|denied|block|blocked|drop|no|never|refuse)\b/.test(h) || (!allowWord && DENY_WORDS.test(h));
    const svc = [], custom = [];
    SVC.forEach(([re, w]) => { if (re.test(h) && svc.indexOf(w) < 0) svc.push(w); });
    const re = /\b(tcp|udp|ports?)(?:\s+|\s*\/\s*)(\d{1,5})\b/g; let m;
    while ((m = re.exec(h))) {
      const w = PORTS[+m[2]];
      if (w) { if (svc.indexOf(w) < 0) svc.push(w); } else { const c = `${m[1] === 'udp' ? 'UDP' : 'TCP'} ${m[2]}`; if (custom.indexOf(c) < 0) custom.push(c); }
    }
    if (svc.indexOf('web') >= 0) ['http', 'https'].forEach(w => { const i = svc.indexOf(w); if (i >= 0 && !/\bhttps?\b|\b(?:80|443)\b/.test(h.replace(/web filter/g, ''))) svc.splice(i, 1); });
    const extras = [];
    if (/web ?filter/.test(h)) extras.push('web filter');
    if (/anti-?virus|\bav\b/.test(h)) extras.push('antivirus');
    if (/\bips\b/.test(h)) extras.push('IPS');
    return { deny, how: deny ? 'block' : svc.join(', '), custom, extras };
  }

  // Map one end of a flow to a network name (the build name), "internet", "all internal", "VPN users", or the text as written.
  function endOf(text, nets) {
    const raw = clean(text), l = raw.toLowerCase();
    if (/\b(?:all internal|internal|all vlans|all networks|everything inside|everything else|lan)\b/.test(l) && !/\bstaff lan\b/.test(l)) return 'all internal';
    if (/\b(?:vpn|forticlient|remote (?:users?|staff)|home users?|work(?:ing)? from home)\b/.test(l)) return 'VPN users';
    if (/\b(?:internet|outside|wan|cloud|provider|vendor|isp|bank|websites?|online|saas|microsoft|m365|office 365|google)\b/.test(l)) return 'internet';
    const paren = (/\(([^)]+)\)/.exec(raw) || [])[1];
    const pick = t => {
      const w = words(t), k = kindOf(t); let best = null, bs = 0;
      nets.forEach(n => {
        let sc = 0; const nw = words(n.name);
        if (nw.length && nw.every(x => w.indexOf(x) >= 0)) sc += 3;
        if (k && k === n.kind) sc += 2;
        words(n.members).forEach(x => { if (w.indexOf(x) >= 0) sc += 1; });
        if (sc > bs) { bs = sc; best = n; }
      });
      if (best) return best.build;
      if (k) return KIND_NAME[k];
      return '';
    };
    return (paren && pick(paren)) || pick(raw);
  }
  function endsOf(text, nets) {
    const whole = endOf(text, nets) || clean(text), pieces = String(text || '').replace(/\([^)]*\)/g, ' ').split(/\s*(?:,|&|\/|\band\b|\bplus\b)\s*/).map(clean).filter(Boolean);
    if (pieces.length > 1) {
      const t = pieces.map(p => endOf(p, nets));
      if (t.every(Boolean)) return Array.from(new Set(t));
    }
    return [whole];
  }

  // Free-type notes -> what SubnetPal found. Everything is a suggestion the engineer accepts with a button.
  function readNotes(text) {
    const lines = String(text || '').slice(0, MAX_TEXT).split(/\r?\n/);
    const out = { client: '', wanPort: '', groups: [], devices: [], servers: [], networks: [], flows: [], remote: 0, admin: [], prove: [] };
    const seen = (list, name) => list.some(x => x.name.toLowerCase() === name.toLowerCase());
    const add = (list, it) => { if (it.name && !seen(list, it.name) && list.length < 30) list.push(it); };
    const flowLines = [];
    let sec = '';
    lines.forEach(line0 => {
      const line = line0.trim(); if (!line) return;
      const bullet = /^(?:[-*•]|\d{1,3}[.)])\s+/.test(line);
      const h = bullet ? '' : headingOf(line);
      if (h) {
        sec = h;
        const cm = /^(?:client(?: brief)?|customer|company|client name)\s*:\s*(.+)$/i.exec(line);
        if (cm && !out.client) out.client = cap(cm[1].replace(/\([^)]*\)/g, ''), 80);
        return;
      }
      const body = line.replace(/^(?:[-*•]|\d{1,3}[.)])\s+/, '');
      const low = body.toLowerCase();
      const cm = /^(?:client(?: brief)?|customer|company|client name)\s*:\s*(.+)$/i.exec(body);
      if (cm && !out.client) out.client = cap(cm[1].replace(/\([^)]*\)/g, ''), 80);
      if (!out.wanPort) { const w = /\b(port\d{1,2}|wan\d?)\s+is\s+(?:the\s+)?(?:wan|internet)\b/i.exec(body) || /\b(?:wan|internet)\s+(?:is\s+|on\s+|port\s*:?\s*)(port\d{1,2}|wan\d)\b/i.exec(body); if (w) out.wanPort = w[1].toLowerCase(); }
      // networks: "VLAN 10 Staff: members. Size for 40"
      const v = /\bvlan\s*(\d{1,4})\b\s*[:\-–]?\s*([A-Za-z][^:,(]*?)\s*(?::|,|\(|$)(.*)$/i.exec(body);
      if (v && out.networks.length < 20) {
        const name = cap(v[2], 20), rest = v[3] || '';
        const size = +((/\b(?:size for|sized for|room for|up to|for)\s+(\d{1,5})\b/i.exec(rest) || /\b(\d{1,5})\s+(?:devices|hosts|users|ips|addresses)\b/i.exec(rest) || [])[1] || 0);
        const members = cap(rest.split(/\.\s|\bsize\b/i)[0], 160);
        const kind = kindOf(name) || kindOf(members) || 'other';
        if (!out.networks.some(n => n.name.toLowerCase() === name.toLowerCase())) out.networks.push({ vlan: v[1], name, kind, size, members, build: KIND_NAME[kind] || name });
        return;
      }
      // flows: "Staff -> Servers: allow https", "Staff to Printers: print" (in a flows section), or a plain sentence
      const a = /^(.+?)\s*(?:->|→|=>|-->|—>)\s*(.+?)(?:\s*:\s*(.*))?$/.exec(body) || (sec === 'flows' ? /^(.+?)\s+to\s+(.+?)\s*:\s*(.*)$/i.exec(body) : null);
      if (a) { flowLines.push({ who: a[1], what: a[2], how: a[3] || '', raw: body }); return; }
      const sAllow = /^(.+?)\s+(?:needs?|wants?|must|should|can|has|have)\s+(?:to\s+)?(?:be able to\s+)?(?:only\s+)?(?:reach|access|get to|use|talk to|connect to|print to|see|open)\s+(?:the\s+)?(.+?)(?:\s+(?:on|via|over|using|with)\s+(.+?))?\.?$/i.exec(body);
      const sDeny = /^(.+?)\s+(?:can'?t|cannot|can not|must not|mustn'?t|should not|shouldn'?t|never|may not)\s+(?:be able to\s+)?(?:reach|access|get to|see|talk to|connect to|use)\s+(?:the\s+)?(.+?)(?:\s+(?:on|via|over)\s+(.+?))?\.?$/i.exec(body);
      if (sDeny && sec !== 'admin' && sec !== 'prove') { flowLines.push({ who: sDeny[1], what: sDeny[2], how: 'deny ' + (sDeny[3] || ''), raw: body }); return; }
      if (sAllow && sec !== 'admin' && sec !== 'prove') { flowLines.push({ who: sAllow[1], what: sAllow[2], how: 'allow ' + (sAllow[3] || ''), raw: body }); return; }
      // remote VPN users
      if (!out.remote) {
        const r = /\b(\d{1,4})\s+(?:remote\s+|vpn\s+|home\s+)?(?:users?|staff|people)\b[^.\n]*?\b(?:forticlient|vpn|remote|home)\b/i.exec(body) || /\b(?:vpn|remote|forticlient)\b[^.\n]*?\b(\d{1,4})\s+(?:remote\s+)?(?:users?|staff|people)\b/i.exec(body);
        if (r && (sec === 'vpn' || /\b(?:vpn|forticlient|remote)\b/i.test(body))) out.remote = Math.min(+r[1], 500);
      }
      if (sec === 'admin' || (/\b(?:mfa|2fa|fortitoken|super_admin|read-only|trusted hosts?|admin (?:login|access))\b/i.test(body) && sec !== 'vpn' && sec !== 'prove')) { if (out.admin.length < 10) out.admin.push(cap(body, 200)); return; }
      if (sec === 'prove' || /^(?:test|check|prove)\b/i.test(body)) { if (out.prove.length < 15) out.prove.push(cap(body, 200)); return; }
      // nouns
      if (sec === 'people') { itemsOf(body).forEach(it => add(out.groups, it)); return; }
      if (sec === 'devices') { itemsOf(body).forEach(it => add(out.devices, it)); return; }
      if (sec === 'servers') { itemsOf(body, true).forEach(it => add(out.servers, it)); return; }
      if (sec === 'networks' || sec === 'vpn' || sec === 'flows') return;
      // free notes: "12 staff", "30 phones", "the Xero server"
      const re = /\b(\d{1,5})\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2})/gi; let m;
      while ((m = re.exec(body))) {
        const n = m[2].toLowerCase().split(/\s+(?:and|with|on|in|at|for|who|that|to)\b/)[0];
        if (/\b(?:remote|vpn|home)\b/.test(n)) continue;
        const k = kindOf(n) || kindOf(body.slice(Math.max(0, m.index - 40), m.index));   // "guest wifi for about 20 phones" -> guest
        if (PEOPLE.test(n) && !DEVICES.test(n)) add(out.groups, { name: cap(n, 40), count: +m[1], kind: k });
        else if (SERVERS.test(n)) add(out.servers, { name: cap(n, 40), count: +m[1], kind: k });
        else if (DEVICES.test(n)) add(out.devices, { name: cap(n, 40), count: +m[1], kind: k });
      }
      const sv = /\b((?:[A-Z][\w-]*\s){0,2}(?:server|NAS))\b/.exec(body);
      if (sv && !/^(?:the|a|an|our|their)\s/i.test(sv[1])) add(out.servers, { name: cap(sv[1], 40), count: 0 });
    });
    // No VLAN lines: suggest networks from the nouns, one per kind.
    if (!out.networks.length) {
      const by = {};
      out.groups.concat(out.devices, out.servers).forEach(it => {
        const k = it.kind || kindOf(it.name) || (out.groups.indexOf(it) >= 0 ? 'staff' : ''); if (!k) return;
        const b = by[k] = by[k] || { people: 0, devices: 0, members: [] };
        if (out.groups.indexOf(it) >= 0) b.people += it.count; else b.devices += it.count || 1;
        b.members.push(it.name);
      });
      Object.keys(by).forEach(k => { const b = by[k]; out.networks.push({ vlan: '', name: KIND_NAME[k], kind: k, size: Math.max(b.people, b.devices), members: cap(b.members.join(', '), 160), build: KIND_NAME[k] }); });
    }
    // Flows, now the networks are known. One row per who/what pair.
    flowLines.forEach(f => {
      const h = howOf(f.how || f.raw);
      endsOf(f.who, out.networks).forEach(who => endsOf(f.what, out.networks).forEach(what => {
        if (out.flows.length >= MAX_FLOWS || who === what) return;
        out.flows.push({ who, what, how: h.how, custom: h.custom, extras: h.extras, vpn: who === 'VPN users', raw: cap(f.raw, 200) });
      }));
    });
    return out;
  }

  // Found networks -> a starting sketch: internet cloud, the FortiGate, one box per network, arrows between. Draw is passed in (draw.js).
  function sketch(found, Draw) {
    const b = Draw.empty(), nets = (found && found.networks || []).slice(0, 12);
    const inet = Draw.addItem(b, 'cloud', 420, 20, '#0e7490'); inet.label = 'Internet';
    const fw = Draw.addItem(b, 'fw', 455, 200, '#c2410c'); fw.label = 'FortiGate' + (found && found.wanPort ? ` (${found.wanPort} WAN)` : '');
    Draw.addLink(b, fw.id, inet.id, '#1f2937');
    const perRow = Math.min(6, Math.max(1, nets.length)), w = 140, gap = 1000 / perRow;
    nets.forEach((n, i) => {
      const row = Math.floor(i / perRow), col = i % perRow;
      const it = Draw.addItem(b, n.kind === 'servers' ? 'server' : 'box', gap * col + (gap - w) / 2, 360 + row * 120, n.kind === 'guest' ? '#15803d' : n.kind === 'pos' ? '#dc2626' : '#4f46e5');
      if (!it) return;
      it.label = (n.vlan ? `VLAN ${n.vlan} ` : '') + n.name + (n.size ? ` (${n.size})` : '');
      Draw.addLink(b, fw.id, it.id, '#1f2937');
    });
    return b;
  }

  return { STEPS, KIND_NAME, DETAIL_KEYS, normalize, normDetails, progress, flowToPolicy, readNotes, howOf, sketch };
}));
