/* Bob's offline checks for the Lab: reads FortiOS config text (the mock's "show full-configuration",
   or SubnetPal's own CLI) and reviews one area at a time like a senior engineer would.
   Rule-based, no AI, no DOM, no storage. Each finding: { sev: High|Medium|Low, title, why, fix (CLI or ''), at }. */
(function (root) {
  'use strict';

  // ---------- parser ----------
  // Split a "set" value into tokens, honouring "quoted strings".
  function tokens(s) {
    const out = []; let cur = '', q = false, had = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\' && q && i + 1 < s.length) { cur += s[++i]; continue; }
      if (ch === '"') { q = !q; had = true; continue; }
      if (!q && /\s/.test(ch)) { if (cur || had) out.push(cur); cur = ''; had = false; continue; }
      cur += ch;
    }
    if (cur || had) out.push(cur);
    return out;
  }
  // Tree: tables keyed by path ("firewall policy"); a table has .set (no-edit settings) and .list (entries in order).
  // An entry: { id, set: {key: [tokens]}, sub: {path: table} }. "move" lines reorder; delete/purge/unset apply.
  function parse(text) {
    const tables = {};
    const mk = () => ({ set: {}, list: [] });
    const stack = [];                                    // frames: { table, entry }
    const lines = String(text || '').split(/\r\n|\r|\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line[0] === '#') continue;
      const t = tokens(line), cmd = t[0], top = stack[stack.length - 1];
      if (cmd === 'config') {
        const path = t.slice(1).join(' ');
        let tbl;
        if (top && top.entry) { tbl = top.entry.sub[path] || (top.entry.sub[path] = mk()); }
        else if (top) { tbl = top.table.sub && top.table.sub[path]; if (!tbl) { top.table.sub = top.table.sub || {}; tbl = top.table.sub[path] = mk(); } }
        else tbl = tables[path] || (tables[path] = mk());
        stack.push({ table: tbl, entry: null });
      } else if (cmd === 'edit' && top) {
        const id = t[1] || '';
        let e = top.table.list.find(x => x.id === id);
        if (!e) { e = { id, set: {}, sub: {} }; top.table.list.push(e); }
        top.entry = e;
      } else if (cmd === 'next' && top) top.entry = null;
      else if (cmd === 'end') stack.pop();
      else if (cmd === 'set' && top && t[1]) (top.entry ? top.entry.set : top.table.set)[t[1]] = t.slice(2);
      else if (cmd === 'unset' && top && t[1]) delete (top.entry ? top.entry.set : top.table.set)[t[1]];
      else if (cmd === 'delete' && top && !top.entry) top.table.list = top.table.list.filter(x => x.id !== t[1]);
      else if (cmd === 'purge' && top && !top.entry) top.table.list = [];
      else if (cmd === 'move' && top && !top.entry && (t[2] === 'before' || t[2] === 'after')) {
        const L = top.table.list, a = L.findIndex(x => x.id === t[1]);
        if (a < 0 || !L.some(x => x.id === t[3])) continue;
        const [e] = L.splice(a, 1), b = L.findIndex(x => x.id === t[3]);
        L.splice(t[2] === 'before' ? b : b + 1, 0, e);
      }
    }
    return tables;
  }

  // ---------- helpers ----------
  const ip2n = s => { const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s || ''); if (!m) return null; const o = m.slice(1).map(Number); if (o.some(x => x > 255)) return null; return ((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3]; };
  const n2ip = n => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  const maskLen = m => { const n = ip2n(m); if (n === null) return null; let c = 0, seen0 = false; for (let i = 31; i >= 0; i--) { if ((n >>> i) & 1) { if (seen0) return null; c++; } else seen0 = true; } return c; };
  const lenMask = l => n2ip(l ? (0xffffffff << (32 - l)) >>> 0 : 0);
  // "10.0.0.1 255.255.255.0" or "10.0.0.1/24" -> { ip, len, net, start, end }
  function cidr(v) {
    if (!v || !v.length) return null;
    let ip, len;
    if (v.length >= 2) { ip = ip2n(v[0]); len = maskLen(v[1]); }
    else { const p = String(v[0]).split('/'); ip = ip2n(p[0]); len = p.length > 1 ? Number(p[1]) : 32; }
    if (ip === null || len === null || !(len >= 0 && len <= 32)) return null;
    const mask = len ? (0xffffffff << (32 - len)) >>> 0 : 0, net = (ip & mask) >>> 0;
    return { ip, len, net, start: net, end: (net | (~mask >>> 0)) >>> 0 };
  }
  const fmt = c => n2ip(c.net) + '/' + c.len;
  const one = (e, k) => (e && e.set[k] ? e.set[k].join(' ') : '');
  const list = (tree, p) => (tree[p] ? tree[p].list : []);
  const glob = (tree, p, k) => (tree[p] && tree[p].set[k] ? tree[p].set[k].join(' ') : '');
  const q = s => (/^[A-Za-z0-9_.:\/-]+$/.test(s) ? s : '"' + String(s).replace(/"/g, '\\"') + '"');
  const qq = s => '"' + String(s).replace(/"/g, '\\"') + '"';

  const MOCK_ADDR = ['FABRIC_DEVICE', 'FIREWALL_AUTH_PORTAL_ADDRESS', 'SSLVPN_TUNNEL_ADDR1', 'all', 'none', 'gmail.com', 'login.microsoft.com', 'login.microsoftonline.com', 'login.windows.net', 'wildcard.dropbox.com', 'wildcard.google.com'];
  const PROFILES = [['ssl-ssh-profile', 'SSL inspection'], ['av-profile', 'antivirus'], ['webfilter-profile', 'web filter'], ['ips-sensor', 'IPS'], ['dnsfilter-profile', 'DNS filter'], ['application-list', 'application control']];

  // Interfaces with their subnet and role, WAN names, the management subnet.
  function ctx(tree) {
    const ifs = list(tree, 'system interface').map(e => ({ e, name: e.id, role: one(e, 'role'), type: one(e, 'type'), c: cidr(e.set.ip), mode: one(e, 'mode'), access: e.set.allowaccess || [] }));
    ifs.forEach(i => { if (i.c && i.c.ip === 0 && i.c.len === 0) i.c = null; });
    const tunnels = list(tree, 'vpn ipsec phase1-interface').map(e => e.id);
    const wans = ifs.filter(i => i.role === 'wan').map(i => i.name);
    const admins = list(tree, 'system admin');
    const trust = [];
    admins.forEach(a => { for (let n = 1; n <= 10; n++) { const c = cidr(a.set['trusthost' + n]); if (c && c.len > 0) trust.push(c); } });
    const isMgmt = i => /mgmt|manage/i.test(i.name + ' ' + one(i.e, 'alias')) || (i.c && trust.some(t => t.net === i.c.net && t.len === i.c.len));
    const addr = {};
    list(tree, 'firewall address').forEach(e => { addr[e.id] = e; });
    const grp = {};
    list(tree, 'firewall addrgrp').forEach(e => { grp[e.id] = e.set.member || []; });
    const addr6 = {}; list(tree, 'firewall address6').forEach(e => { addr6[e.id] = e; });
    const grp6 = {}; list(tree, 'firewall addrgrp6').forEach(e => { grp6[e.id] = e.set.member || []; });
    const svc = {}; list(tree, 'firewall service custom').forEach(e => { svc[e.id] = e; });
    const sgrp = {}; list(tree, 'firewall service group').forEach(e => { sgrp[e.id] = e.set.member || []; });
    const zones = {}; list(tree, 'system zone').forEach(e => { zones[e.id] = e.set.interface || []; });
    return { ifs, wans, tunnels, admins, trust, isMgmt, addr, grp, addr6, grp6, svc, sgrp, zones, byIf: n => ifs.find(i => i.name === n) };
  }
  // Ranges an address (or group) covers; null = unknown (fqdn, geo, missing).
  function ranges(x, name, seen) {
    if (name === 'all') return [{ start: 0, end: 0xffffffff }];
    if (x.grp[name]) { seen = seen || {}; if (seen[name]) return null; seen[name] = 1; let out = []; for (const m of x.grp[name]) { const r = ranges(x, m, seen); if (!r) return null; out = out.concat(r); } return out; }
    const a = x.addr[name]; if (!a) return null;
    const t = one(a, 'type') || 'ipmask';
    if (t === 'ipmask') { const c = cidr(a.set.subnet); return c ? [{ start: c.start, end: c.end }] : null; }
    if (t === 'iprange') { const s = ip2n(one(a, 'start-ip')), e = ip2n(one(a, 'end-ip')); return s !== null && e !== null ? [{ start: s, end: e }] : null; }
    return null;
  }
  const inside = (inner, outer) => inner.every(r => outer.some(o => o.start <= r.start && r.end <= o.end));
  // Does field set A cover B? (names, with "any"/"all"/"ALL" as wildcards; addresses by range when known)
  function covers(x, field, A, B) {
    if (!B.length) return !A.length;
    if (field === 'srcintf' || field === 'dstintf') return A.indexOf('any') >= 0 || B.every(b => A.indexOf(b) >= 0 || Object.keys(x.zones).some(z => A.indexOf(z) >= 0 && x.zones[z].indexOf(b) >= 0));
    if (field === 'service') return A.indexOf('ALL') >= 0 || B.every(b => A.indexOf(b) >= 0);
    if (field === 'srcaddr6' || field === 'dstaddr6') return A.indexOf('all') >= 0 || B.every(b => A.indexOf(b) >= 0);
    if (A.indexOf('all') >= 0) return true;
    const ra = [].concat(...A.map(a => ranges(x, a) || [null])), rb = [].concat(...B.map(b => ranges(x, b) || [null]));
    if (ra.indexOf(null) < 0 && rb.indexOf(null) < 0) return inside(rb, ra);
    return B.every(b => A.indexOf(b) >= 0);
  }
  const fam = p => (p.set.srcaddr || p.set.dstaddr ? '4' : '') + (p.set.srcaddr6 || p.set.dstaddr6 ? '6' : '');
  function policyCovers(x, a, b) {
    if (one(a, 'status') === 'disable' || one(a, 'schedule') === 'none') return false;
    const fa = fam(a), fb = fam(b);
    if (!fb.split('').every(f => fa.indexOf(f) >= 0)) return false;
    const keys = ['srcintf', 'dstintf', 'service'];
    if (fb.indexOf('4') >= 0) keys.push('srcaddr', 'dstaddr');
    if (fb.indexOf('6') >= 0) keys.push('srcaddr6', 'dstaddr6');
    return keys.every(k => covers(x, k, a.set[k] || [], b.set[k] || []));
  }
  const pname = p => (one(p, 'name') ? `${p.id} "${one(p, 'name')}"` : String(p.id));
  const isAllowAll = (p, f) => one(p, 'action') === 'deny' && (p.set.srcintf || []).indexOf('any') >= 0 && (p.set.dstintf || []).indexOf('any') >= 0 && (p.set.service || []).indexOf('ALL') >= 0 &&
    (f === '6' ? (p.set.srcaddr6 || []).indexOf('all') >= 0 && (p.set.dstaddr6 || []).indexOf('all') >= 0 : (p.set.srcaddr || []).indexOf('all') >= 0 && (p.set.dstaddr || []).indexOf('all') >= 0);

  // ---------- sections ----------
  const SECTIONS = [
    { id: 'interfaces', label: 'Check my interfaces', short: 'Interfaces', paths: ['system interface', 'system zone', 'system dhcp server'] },
    { id: 'objects', label: 'Check my objects/addresses', short: 'Objects and addresses', paths: ['firewall address', 'firewall addrgrp', 'firewall address6', 'firewall addrgrp6', 'firewall service custom', 'firewall service group'] },
    { id: 'policies', label: 'Check my policies', short: 'Firewall policies', paths: ['firewall policy'] },
    { id: 'routes', label: 'Check my routes', short: 'Static routes', paths: ['router static'] },
    { id: 'vpn', label: 'Check my VPN', short: 'IPsec VPN', paths: ['vpn ipsec phase1-interface', 'vpn ipsec phase2-interface'] },
    { id: 'admin', label: 'Check my admin/hardening', short: 'Admin access and hardening', paths: ['system global', 'system admin'] },
  ];

  const RULES = {};

  RULES.interfaces = (tree, x, add, pass) => {
    const vlans = x.ifs.filter(i => i.type === 'vlan');
    const longN = x.ifs.filter(i => i.name.length > 15 && i.name.indexOf('.') < 0);               // built-ins like fortinet.mesh.root are exempt
    longN.forEach(i => add('High', `Interface name "${i.name}" is ${i.name.length} characters`, 'FortiOS interface names are 15 characters at most, so this line fails on a real FortiGate.', `config system interface\n    rename ${qq(i.name)} to ${qq(i.name.slice(0, 15))}\nend`, i.name));
    if (!longN.length) pass('Interface names are 15 characters or less');
    vlans.forEach(i => {
      if (!one(i.e, 'vlanid')) add('High', `VLAN "${i.name}" has no VLAN ID`, 'A VLAN interface needs a VLAN ID that matches the switch.', `config system interface\n    edit ${qq(i.name)}\n        set vlanid <id>\n    next\nend`, i.name);
      const par = one(i.e, 'interface');
      if (!par || !x.byIf(par)) add('High', `VLAN "${i.name}" has no parent port`, par ? `Its parent "${par}" does not exist.` : 'A VLAN rides on a physical (trunk) port.', `config system interface\n    edit ${qq(i.name)}\n        set interface "port<n>"\n    next\nend`, i.name);
    });
    // Same VLAN ID twice on one parent
    const seenV = {};
    vlans.forEach(i => { const k = one(i.e, 'interface') + '/' + one(i.e, 'vlanid'); if (one(i.e, 'vlanid')) { if (seenV[k]) add('High', `VLAN ID ${one(i.e, 'vlanid')} is used twice on ${one(i.e, 'interface')}`, `"${seenV[k]}" and "${i.name}" clash, and FortiOS refuses the second one.`, '', i.name); else seenV[k] = i.name; } });
    // Overlapping subnets
    const withIp = x.ifs.filter(i => i.c);
    let overlap = false;
    for (let a = 0; a < withIp.length; a++) for (let b = a + 1; b < withIp.length; b++) {
      const A = withIp[a].c, B = withIp[b].c;
      if (A.start <= B.end && B.start <= A.end) { overlap = true; add('High', `"${withIp[a].name}" and "${withIp[b].name}" overlap`, `${fmt(A)} and ${fmt(B)} share addresses, so routing between them breaks.`, '', withIp[b].name); }
    }
    if (!overlap && withIp.length) pass('No overlapping interface subnets');
    // WAN
    if (!x.wans.length) add('Medium', 'No interface has role WAN', 'Bob expects the internet port to be marked role wan so the GUI, NAT checks and SD-WAN treat it right.', 'config system interface\n    edit "port1"\n        set role wan\n    next\nend', '');
    else pass('WAN interface marked (' + x.wans.join(', ') + ')');
    // Admin access per interface
    let accessOk = true;
    x.ifs.forEach(i => {
      const a = i.access, bad = a.filter(s => s === 'http' || s === 'telnet');
      if (bad.length) { accessOk = false; add('High', `${bad.join(' and ')} admin access on "${i.name}"`, 'Clear-text admin protocols send the password unencrypted. Use https and ssh only.', `config system interface\n    edit ${qq(i.name)}\n        set allowaccess ${i.role === 'wan' ? 'ping' : a.filter(s => bad.indexOf(s) < 0).join(' ') || 'ping'}\n    next\nend`, i.name); }
      const mgmt = a.filter(s => ['https', 'ssh', 'snmp', 'fgfm'].indexOf(s) >= 0 && (s !== 'fgfm' || i.role === 'wan'));
      if (i.role === 'wan' && mgmt.length) { accessOk = false; add('High', `Admin access (${mgmt.join(', ')}) open on WAN "${i.name}"`, 'The login page is exposed to the internet. Manage from the Management network or a VPN instead.', `config system interface\n    edit ${qq(i.name)}\n        set allowaccess ping\n    next\nend`, i.name); }
      else if (i.role !== 'wan' && i.c && !x.isMgmt(i) && a.some(s => s === 'https' || s === 'ssh')) { accessOk = false; add('Medium', `Admin GUI/SSH open on "${i.name}"`, 'Only the Management network should reach the firewall login. Other networks get ping at most.', `config system interface\n    edit ${qq(i.name)}\n        set allowaccess ping\n    next\nend`, i.name); }
    });
    if (accessOk) pass('Admin access only where it should be');
    // DHCP
    const dhcp = list(tree, 'system dhcp server');
    dhcp.forEach(d => {
      const ifn = one(d, 'interface'), i = x.byIf(ifn);
      if (!i) { add('High', `DHCP server ${d.id} points at missing interface "${ifn}"`, 'The scope is attached to nothing, so clients get no address.', '', 'dhcp ' + d.id); return; }
      if (!i.c) return;
      const gw = ip2n(one(d, 'default-gateway'));
      if (gw !== null && gw !== i.c.ip) add('Medium', `DHCP on "${ifn}" hands out gateway ${one(d, 'default-gateway')}`, `The interface IP is ${n2ip(i.c.ip)}, so clients would send traffic to the wrong gateway.`, `config system dhcp server\n    edit ${d.id}\n        set default-gateway ${n2ip(i.c.ip)}\n    next\nend`, 'dhcp ' + d.id);
      const nm = maskLen(one(d, 'netmask'));
      if (nm !== null && nm !== i.c.len) add('Medium', `DHCP netmask on "${ifn}" is /${nm}`, `The interface is /${i.c.len}.`, `config system dhcp server\n    edit ${d.id}\n        set netmask ${lenMask(i.c.len)}\n    next\nend`, 'dhcp ' + d.id);
      const rg = d.sub['ip-range'] ? d.sub['ip-range'].list : [];
      if (!rg.length) add('High', `DHCP on "${ifn}" has no address range`, 'Without an ip-range the server hands out nothing.', `config system dhcp server\n    edit ${d.id}\n        config ip-range\n            edit 1\n                set start-ip ${n2ip(i.c.start + 10)}\n                set end-ip ${n2ip(i.c.end - 1)}\n            next\n        end\n    next\nend`, 'dhcp ' + d.id);
      rg.forEach(r => {
        const s = ip2n(one(r, 'start-ip')), e = ip2n(one(r, 'end-ip'));
        if (s === null || e === null) return;
        if (s < i.c.start || e > i.c.end) add('High', `DHCP range on "${ifn}" is outside ${fmt(i.c)}`, `${one(r, 'start-ip')} to ${one(r, 'end-ip')} does not fit the interface subnet.`, '', 'dhcp ' + d.id);
        else if (i.c.ip >= s && i.c.ip <= e) add('High', `DHCP range on "${ifn}" includes the gateway ${n2ip(i.c.ip)}`, 'A client could be given the firewall\'s own address.', '', 'dhcp ' + d.id);
      });
    });
    const served = dhcp.map(d => one(d, 'interface'));
    const noDhcp = x.ifs.filter(i => i.c && i.role !== 'wan' && i.type !== 'loopback' && !x.isMgmt(i) && !/server|dmz|transit|loop/i.test(i.name) && served.indexOf(i.name) < 0);
    noDhcp.forEach(i => add('Low', `No DHCP server on "${i.name}"`, 'Fine if every device there is static; otherwise clients get no address.', `config system dhcp server\n    edit 0\n        set interface ${qq(i.name)}\n        set default-gateway ${n2ip(i.c.ip)}\n        set netmask ${lenMask(i.c.len)}\n        set dns-service default\n        config ip-range\n            edit 1\n                set start-ip ${n2ip(i.c.start + 10)}\n                set end-ip ${n2ip(i.c.end - 1)}\n            next\n        end\n    next\nend`, i.name));
    if (dhcp.length && !noDhcp.length) pass('DHCP on every client network');
    // LAN interfaces without an alias are hard to read in the GUI
    const noAlias = x.ifs.filter(i => i.c && !one(i.e, 'alias') && i.type !== 'loopback');
    if (noAlias.length) add('Low', `${noAlias.length} interface${noAlias.length > 1 ? 's have' : ' has'} no alias`, 'An alias shows a friendly name in the GUI and FortiView: ' + noAlias.map(i => i.name).join(', ') + '.', noAlias.map(i => `config system interface\n    edit ${qq(i.name)}\n        set alias "<friendly name>"\n    next\nend`).join('\n'), '');
  };

  RULES.objects = (tree, x, add, pass) => {
    const pol = list(tree, 'firewall policy');
    const used = {};
    const mark = n => { used[n] = 1; };
    pol.forEach(p => ['srcaddr', 'dstaddr', 'srcaddr6', 'dstaddr6', 'service'].forEach(k => (p.set[k] || []).forEach(mark)));
    Object.keys(x.grp).forEach(g => x.grp[g].forEach(mark));
    Object.keys(x.grp6).forEach(g => x.grp6[g].forEach(mark));
    Object.keys(x.sgrp).forEach(g => x.sgrp[g].forEach(mark));
    list(tree, 'vpn ipsec phase2-interface').forEach(e => ['src-name', 'dst-name'].forEach(k => (e.set[k] || []).forEach(mark)));
    list(tree, 'vpn ipsec phase1-interface').forEach(e => (e.set['ipv4-split-include'] || []).forEach(mark));
    const own = Object.keys(x.addr).filter(n => MOCK_ADDR.indexOf(n) < 0);
    // Host bits set / catch-all objects / duplicates
    const bySub = {};
    let tidy = true;
    own.forEach(n => {
      const a = x.addr[n], t = one(a, 'type') || 'ipmask';
      if (t === 'ipmask') {
        const c = cidr(a.set.subnet); if (!c) return;
        if (c.len < 32 && c.ip !== c.net) { tidy = false; add('Medium', `Address "${n}" has host bits set`, `${n2ip(c.ip)}/${c.len} should be the network address ${fmt(c)}.`, `config firewall address\n    edit ${qq(n)}\n        set subnet ${n2ip(c.net)} ${lenMask(c.len)}\n    next\nend`, n); }
        if (c.len === 0) { tidy = false; add('Medium', `Address "${n}" is 0.0.0.0/0`, 'It matches the whole internet. Use the built-in "all" so readers see that straight away, or narrow it.', '', n); }
        const k = fmt(c); if (bySub[k]) { tidy = false; add('Low', `"${n}" and "${bySub[k]}" are the same subnet`, `Both are ${k}. Two names for one thing makes policies harder to read.`, '', n); } else bySub[k] = n;
      }
    });
    if (tidy && own.length) pass('Address objects are clean network addresses, no duplicates');
    // Unused
    const unused = own.filter(n => !used[n]);
    if (unused.length) add('Low', `${unused.length} address object${unused.length > 1 ? 's are' : ' is'} not used`, 'Not in any policy or group: ' + unused.join(', ') + '. Delete it if it is not planned, so the list stays readable.', `config firewall address\n${unused.map(n => '    delete ' + qq(n)).join('\n')}\nend`, '');
    else if (own.length) pass('Every address object is used');
    // Groups
    let groupsOk = true;
    const allAddr = Object.assign({}, x.addr, x.grp);
    Object.keys(x.grp).forEach(g => {
      const m = x.grp[g];
      if (!m.length || (m.length === 1 && m[0] === 'none')) { groupsOk = false; add('Medium', `Group "${g}" is empty`, 'A policy using it matches nothing.', '', g); }
      m.filter(n => n !== 'none' && !allAddr[n] && n !== 'all').forEach(n => { groupsOk = false; add('High', `Group "${g}" lists missing object "${n}"`, 'FortiOS refuses the group until the member exists.', `config firewall address\n    edit ${qq(n)}\n        set subnet <network> <mask>\n    next\nend`, g); });
    });
    // Internal group covers every LAN subnet
    const internalG = Object.keys(x.grp).find(g => /internal/i.test(g));
    if (internalG) {
      const r = ranges(x, internalG) || [];
      const miss = x.ifs.filter(i => i.c && i.role !== 'wan' && i.type !== 'loopback' && !/loop|guest/i.test(i.name) && !inside([{ start: i.c.start, end: i.c.end }], r));   // guest stays out on purpose
      const objFor = i => Object.keys(x.addr).find(n => { const c = cidr(x.addr[n].set.subnet); return c && c.net === i.c.net && c.len === i.c.len; });
      if (miss.length) { groupsOk = false; add('Medium', `"${internalG}" misses ${miss.map(i => i.name).join(', ')}`, 'Block rules that use the internal group will not protect these networks.', `config firewall addrgrp\n    edit ${qq(internalG)}\n        append member ${miss.map(i => qq(objFor(i) || '<address for ' + i.name + '>')).join(' ')}\n    next\nend`, internalG); }
    }
    if (groupsOk && Object.keys(x.grp).length) pass('Address groups complete');
    // IPv6 objects
    Object.keys(x.grp6).forEach(g => (x.grp6[g] || []).filter(n => n !== 'all' && n !== 'none' && !x.addr6[n] && !x.grp6[n]).forEach(n => add('High', `IPv6 group "${g}" lists missing object "${n}"`, 'FortiOS refuses the group until the member exists.', '', g)));
    // Services
    Object.keys(x.svc).forEach(n => {
      const s = x.svc[n], ports = ['tcp-portrange', 'udp-portrange', 'sctp-portrange'].some(k => one(s, k));
      const proto = one(s, 'protocol') || 'TCP/UDP/SCTP';
      if (proto === 'TCP/UDP/SCTP' && !ports && used[n]) add('High', `Service "${n}" has no ports`, 'A TCP/UDP service with no port range matches nothing (or fails to save).', `config firewall service custom\n    edit ${qq(n)}\n        set tcp-portrange <port>\n    next\nend`, n);
    });
    Object.keys(x.sgrp).forEach(g => x.sgrp[g].filter(n => !x.svc[n] && !x.sgrp[n]).forEach(n => add('High', `Service group "${g}" lists missing service "${n}"`, 'FortiOS refuses the group until the service exists.', '', g)));
    // Names that policies need but do not exist
    const missing = {};
    pol.forEach(p => ['srcaddr', 'dstaddr'].forEach(k => (p.set[k] || []).forEach(n => { if (n !== 'all' && n !== 'none' && !allAddr[n]) (missing[n] = missing[n] || []).push(p.id); })));
    Object.keys(missing).forEach(n => add('High', `Policies use address "${n}" that does not exist`, `Policy ${missing[n].join(', ')} cannot be saved until it exists.`, `config firewall address\n    edit ${qq(n)}\n        set subnet <network> <mask>\n    next\nend`, n));
  };

  RULES.policies = (tree, x, add, pass) => {
    const pol = list(tree, 'firewall policy');
    if (!pol.length) { add('High', 'No firewall policies', 'With no policies the FortiGate passes nothing between networks or to the internet.', '', ''); return; }
    const isWan = n => x.wans.indexOf(n) >= 0;
    const ids = {}, names = {};
    pol.forEach(p => { if (ids[p.id]) add('High', `Policy ID ${p.id} is used twice`, '', '', p.id); ids[p.id] = 1; const nm = one(p, 'name'); if (nm) { if (names[nm]) add('Medium', `Two policies are called "${nm}"`, `IDs ${names[nm]} and ${p.id}. Unique names make logs readable.`, '', p.id); else names[nm] = p.id; } });
    // Final deny last (per family)
    ['4', '6'].forEach(f => {
      const fp = pol.filter(p => fam(p).indexOf(f) >= 0);
      if (!fp.length) return;
      const lbl = f === '6' ? 'IPv6 ' : '';
      const di = fp.findIndex(p => isAllowAll(p, f));
      if (di < 0) add('Medium', `No ${lbl}final deny policy`, 'FortiOS has an implicit deny, but it does not log. An explicit "deny all, log all" at the bottom shows you what is being blocked.', `config firewall policy\n    edit 0\n        set name "${f === '6' ? 'SP6' : 'SP'}_Final_deny"\n        set srcintf "any"\n        set dstintf "any"\n        set action deny\n        set ${f === '6' ? 'srcaddr6' : 'srcaddr'} "all"\n        set ${f === '6' ? 'dstaddr6' : 'dstaddr'} "all"\n        set schedule "always"\n        set service "ALL"\n        set logtraffic all\n    next\nend`, '');
      else if (di < fp.length - 1) { const after = fp.slice(di + 1); add('High', `${lbl}Final deny ${pname(fp[di])} is not last`, `FortiOS works top-down by sequence, not ID. ${after.length} polic${after.length > 1 ? 'ies' : 'y'} below it never match: ${after.map(pname).join(', ')}.`, `config firewall policy\n    move ${fp[di].id} after ${after[after.length - 1].id}\nend`, fp[di].id); }
      else pass(`${lbl}Final deny is last`);
    });
    // Shadowed policies
    let shadow = false;
    for (let b = 1; b < pol.length; b++) {
      const B = pol[b];
      if (isAllowAll(B, '4') || isAllowAll(B, '6')) continue;
      for (let a = 0; a < b; a++) {
        const A = pol[a];
        if (isAllowAll(A, '4') || isAllowAll(A, '6')) continue;               // reported as "not last" already
        if (!policyCovers(x, A, B)) continue;
        shadow = true;
        if (one(A, 'action') !== one(B, 'action')) add('High', `${pname(B)} is hidden by ${pname(A)}`, `${pname(A)} sits above and matches everything ${pname(B)} does, so the ${one(B, 'action') || 'accept'} never happens.`, `config firewall policy\n    move ${B.id} before ${A.id}\nend`, B.id);
        else add('Low', `${pname(B)} is redundant`, `${pname(A)} above already ${one(A, 'action') === 'deny' ? 'blocks' : 'allows'} the same traffic.`, `config firewall policy\n    delete ${B.id}\nend`, B.id);
        break;
      }
    }
    if (!shadow) pass('No hidden or redundant policies');
    // Per-policy checks
    let nat = true, svcAll = true, prof = true, logs = true;
    pol.forEach(p => {
      const acc = one(p, 'action') === 'accept', dst = p.set.dstintf || [], src = p.set.srcintf || [];
      const toWan = dst.some(isWan), fromWan = src.some(isWan), v6only = fam(p) === '6';
      if (one(p, 'status') === 'disable') add('Low', `${pname(p)} is disabled`, 'Delete it if it is not needed, so nobody turns it back on by mistake.', '', p.id);
      if (!acc) { if (one(p, 'logtraffic') !== 'all') { logs = false; add('Low', `${pname(p)} denies without logging`, 'Log blocked traffic so you can see what the rule stops.', `config firewall policy\n    edit ${p.id}\n        set logtraffic all\n    next\nend`, p.id); } return; }
      if ((p.set.service || []).indexOf('ALL') >= 0) { svcAll = false; add('Medium', `${pname(p)} allows service ALL`, 'Allow only the services the flow needs (Bob\'s rule: no ALL on allows).', `config firewall policy\n    edit ${p.id}\n        set service "HTTPS" "DNS"\n    next\nend`, p.id); }
      if (one(p, 'nat') === 'enable' && !toWan) { nat = false; add('High', `${pname(p)} has NAT on an internal flow`, 'NAT is for traffic to the internet only. Internal NAT hides the real source from logs and the other side.', `config firewall policy\n    edit ${p.id}\n        set nat disable\n    next\nend`, p.id); }
      if (toWan && !v6only && one(p, 'nat') !== 'enable') { nat = false; add('High', `${pname(p)} goes to the internet without NAT`, 'Private addresses cannot be routed on the internet, so this traffic will not come back.', `config firewall policy\n    edit ${p.id}\n        set nat enable\n    next\nend`, p.id); }
      if (fromWan) add('High', `${pname(p)} allows traffic in from the internet`, 'Inbound allows should use a VIP, a narrow source and only the published service. Check this is intended.', '', p.id);
      if (toWan) {
        const miss = PROFILES.filter(([k]) => !one(p, k)).map(([, l]) => l);
        if (miss.length) { prof = false; add('Medium', `${pname(p)} has no ${miss.join(', ')}`, 'Internet-bound allows should carry the security profiles.', `config firewall policy\n    edit ${p.id}\n        set utm-status enable\n${PROFILES.filter(([k]) => !one(p, k)).map(([k]) => `        set ${k} ${k === 'ssl-ssh-profile' ? '"certificate-inspection"' : '"default"'}`).join('\n')}\n    next\nend`, p.id); }
      }
      if (one(p, 'logtraffic') === 'disable') { logs = false; add('Low', `${pname(p)} does not log`, 'Log allowed traffic (at least security events) so issues can be traced.', `config firewall policy\n    edit ${p.id}\n        set logtraffic all\n    next\nend`, p.id); }
      if (!toWan && ((p.set.dstaddr || []).indexOf('all') >= 0) && (p.set.dstintf || []).indexOf('any') < 0) add('Medium', `${pname(p)} allows to destination "all"`, 'Internal allows should name the destination network object.', '', p.id);
    });
    if (nat) pass('NAT only on internet policies');
    if (svcAll) pass('No ALL service on allow policies');
    if (prof) pass('Security profiles on every internet policy');
    if (logs) pass('Logging on');
    // References
    pol.forEach(p => ['srcintf', 'dstintf'].forEach(k => (p.set[k] || []).forEach(n => { if (n !== 'any' && !x.byIf(n) && !x.zones[n] && x.tunnels.indexOf(n) < 0) add('High', `${pname(p)} uses interface "${n}" that does not exist`, 'The policy cannot be saved.', '', p.id); })));
  };

  RULES.routes = (tree, x, add, pass) => {
    const rt = list(tree, 'router static');
    const dflt = rt.filter(r => { const c = cidr(r.set.dst); return !r.set.dst || (c && c.len === 0); });
    const dhcpWan = x.ifs.filter(i => i.role === 'wan' && (i.mode === 'dhcp' || i.mode === 'pppoe') && one(i.e, 'defaultgw') !== 'disable');
    if (!dflt.length && !dhcpWan.length) add('High', 'No default route', 'Nothing tells the FortiGate where the internet is, so internet traffic is dropped.', `config router static\n    edit 0\n        set gateway <ISP gateway>\n        set device ${qq(x.wans[0] || 'port1')}\n    next\nend`, '');
    else pass(dflt.length ? 'Default route present' : 'Default route learned from DHCP on ' + dhcpWan.map(i => i.name).join(', '));
    dflt.forEach(r => { const d = one(r, 'device'); if (d && x.wans.length && x.wans.indexOf(d) < 0 && x.tunnels.indexOf(d) < 0) add('Medium', `Default route ${r.id} goes out "${d}"`, 'That interface is not marked WAN.', '', r.id); });
    const seen = {};
    let refs = true;
    rt.forEach(r => {
      const bh = one(r, 'blackhole') === 'enable', d = one(r, 'device'), gw = ip2n(one(r, 'gateway'));
      if (!bh && d && !x.byIf(d) && x.tunnels.indexOf(d) < 0) { refs = false; add('High', `Route ${r.id} uses interface "${d}" that does not exist`, '', '', r.id); }
      if (!bh && !d) { refs = false; add('High', `Route ${r.id} has no interface`, 'A static route needs a device (and a gateway unless it is a tunnel).', '', r.id); }
      if (!bh && d && (gw === null || gw === 0) && x.tunnels.indexOf(d) < 0 && !(x.byIf(d) && x.byIf(d).mode === 'dhcp')) { refs = false; add('Medium', `Route ${r.id} has no gateway`, 'Only tunnel and point-to-point routes work without a next hop.', `config router static\n    edit ${r.id}\n        set gateway <next hop>\n    next\nend`, r.id); }
      if (bh && one(r, 'distance') && Number(one(r, 'distance')) < 200) add('Low', `Blackhole ${r.id} has distance ${one(r, 'distance')}`, 'Keep blackholes at 254 so a real route always wins.', `config router static\n    edit ${r.id}\n        set distance 254\n    next\nend`, r.id);
      const c = cidr(r.set.dst);
      if (c && c.len > 0 && !bh) { const conn = x.ifs.find(i => i.c && i.c.net === c.net && i.c.len === c.len); if (conn) add('Medium', `Route ${r.id} duplicates connected network ${conn.name}`, `${fmt(c)} is already on ${conn.name}. The static route can send it the wrong way.`, `config router static\n    delete ${r.id}\nend`, r.id); }
      const k = (c ? fmt(c) : '0.0.0.0/0') + '|' + (one(r, 'distance') || '10') + '|' + (one(r, 'priority') || '');
      if (seen[k] && !bh) add('Medium', `Routes ${seen[k]} and ${r.id} are the same`, 'Same destination, distance and priority: traffic is split between them (ECMP). Fine for two ISPs on purpose, otherwise set different distances.', '', r.id); else seen[k] = r.id;
    });
    if (refs && rt.length) pass('Every route has a valid interface');
    const lan = x.ifs.filter(i => i.c && i.role !== 'wan');
    if (lan.length && !rt.some(r => one(r, 'blackhole') === 'enable')) add('Low', 'No blackhole route for the internal range', 'If a VPN or internal network goes down, its traffic follows the default route to the ISP. A blackhole at distance 254 stops that leak.', `config router static\n    edit 0\n        set dst <internal supernet> <mask>\n        set blackhole enable\n        set distance 254\n    next\nend`, '');
    else if (lan.length) pass('Blackhole route for the internal range');
  };

  RULES.vpn = (tree, x, add, pass) => {
    const p1 = list(tree, 'vpn ipsec phase1-interface'), p2 = list(tree, 'vpn ipsec phase2-interface'), pol = list(tree, 'firewall policy');
    if (!p1.length) { pass('No IPsec VPN configured (nothing to check)'); return; }
    let crypto = true;
    p1.forEach(t => {
      const n = t.id, prop = (t.set.proposal || []).join(' '), dh = t.set.dhgrp || [];
      const psk = one(t, 'psksecret');
      if (/CHANGE_ME|password|123456|^$/i.test(psk) && one(t, 'authmethod') !== 'signature') add('High', `Tunnel "${n}" still has a placeholder pre-shared key`, 'Set a long random key (20+ characters) before going live.', `config vpn ipsec phase1-interface\n    edit ${qq(n)}\n        set psksecret <long random key>\n    next\nend`, n);
      if (/\b(des|3des|md5)\b/i.test(prop) || /-md5|^des|3des/i.test(prop)) { crypto = false; add('High', `Tunnel "${n}" offers weak encryption`, `Proposal "${prop}" includes DES/3DES/MD5.`, `config vpn ipsec phase1-interface\n    edit ${qq(n)}\n        set proposal aes256-sha256 aes256gcm-prfsha384\n    next\nend`, n); }
      else if (/sha1\b|-sha1/i.test(prop)) { crypto = false; add('Medium', `Tunnel "${n}" offers SHA1`, `Proposal "${prop}". Prefer SHA256 or better.`, `config vpn ipsec phase1-interface\n    edit ${qq(n)}\n        set proposal aes256-sha256\n    next\nend`, n); }
      const weak = dh.filter(g => ['1', '2', '5'].indexOf(g) >= 0);
      if (weak.length) { crypto = false; add('High', `Tunnel "${n}" allows DH group ${weak.join(', ')}`, 'Groups 1, 2 and 5 are broken. Use 19, 20 or 21 (14 at least).', `config vpn ipsec phase1-interface\n    edit ${qq(n)}\n        set dhgrp 20 21\n    next\nend`, n); }
      if (one(t, 'ike-version') === '1') add('Low', `Tunnel "${n}" uses IKEv1`, 'IKEv2 is faster to set up and more robust. Check the client supports it before switching (FortiClient IKE mode is still unverified here).', `config vpn ipsec phase1-interface\n    edit ${qq(n)}\n        set ike-version 2\n    next\nend`, n);
      const ifn = one(t, 'interface');
      if (ifn && x.wans.length && x.wans.indexOf(ifn) < 0) add('Medium', `Tunnel "${n}" listens on "${ifn}"`, 'That interface is not marked WAN.', '', n);
      if (!ifn) add('High', `Tunnel "${n}" has no interface`, 'Phase 1 must be bound to the internet port.', '', n);
      if (one(t, 'type') === 'dynamic' && one(t, 'mode-cfg') === 'enable' && !one(t, 'ipv4-start-ip')) add('Medium', `Tunnel "${n}" has no client address pool`, 'Dial-up clients need ipv4-start-ip / ipv4-end-ip.', '', n);
      if (one(t, 'dpd') === 'disable') add('Low', `Tunnel "${n}" has dead peer detection off`, 'DPD clears dead tunnels so they can come back up.', `config vpn ipsec phase1-interface\n    edit ${qq(n)}\n        set dpd on-idle\n    next\nend`, n);
      if (!p2.some(e => one(e, 'phase1name') === n)) add('High', `Tunnel "${n}" has no phase 2`, 'Without a phase 2 no traffic passes.', `config vpn ipsec phase2-interface\n    edit ${qq(n + '_p2')}\n        set phase1name ${qq(n)}\n        set proposal aes256-sha256\n    next\nend`, n);
      const pols = pol.filter(p => (p.set.srcintf || []).indexOf(n) >= 0 || (p.set.dstintf || []).indexOf(n) >= 0);
      if (!pols.length) add('High', `No policy uses tunnel "${n}"`, 'The tunnel can come up but no traffic is allowed through it.', '', n);
      pols.filter(p => one(p, 'action') === 'accept' && (p.set.srcintf || []).indexOf(n) >= 0 && (p.set.dstaddr || []).indexOf('all') >= 0).forEach(p => add('Medium', `${pname(p)} lets VPN users reach "all"`, 'Name the networks remote staff need (split tunnel) instead of everything.', '', p.id));
    });
    p2.forEach(e => { const p = one(e, 'phase1name'); if (!p1.some(t => t.id === p)) add('High', `Phase 2 "${e.id}" points at missing phase 1 "${p}"`, '', '', e.id); });
    if (crypto) pass('Strong IPsec proposals and DH groups');
  };

  RULES.admin = (tree, x, add, pass) => {
    const g = k => glob(tree, 'system global', k);
    const supers = x.admins.filter(a => one(a, 'accprofile') === 'super_admin');
    if (!x.admins.length) add('Medium', 'No admin accounts in the config', 'Bob can not check trusted hosts or MFA without config system admin.', '', '');
    let trustOk = true;
    x.admins.forEach(a => {
      const th = []; for (let n = 1; n <= 10; n++) if (a.set['trusthost' + n]) th.push(cidr(a.set['trusthost' + n]));
      if (!th.length) { trustOk = false; add('High', `Admin "${a.id}" has no trusted hosts`, 'Anyone who reaches an admin interface can try to log in. Limit it to the Management subnet (check you are on it first, or you lock yourself out).', `config system admin\n    edit ${qq(a.id)}\n        set trusthost1 <management network> <mask>\n    next\nend`, a.id); }
      else if (th.some(c => c && c.len === 0)) { trustOk = false; add('High', `Admin "${a.id}" trusts 0.0.0.0/0`, 'That is the same as no trusted host.', '', a.id); }
      if (one(a, 'two-factor') === 'disable' || !one(a, 'two-factor')) add('Medium', `Admin "${a.id}" has no MFA`, 'Hand step on the SubnetPal checklist: assign a FortiToken (needs the token serial, so it is not in the CLI).', `config system admin\n    edit ${qq(a.id)}\n        set two-factor fortitoken\n        set fortitoken <serial>\n        set email-to <email>\n    next\nend`, a.id);
    });
    if (trustOk && x.admins.length) pass('Trusted hosts set on every admin');
    if (supers.length === 1) add('Medium', 'Only one super_admin account', 'Hand step on the SubnetPal checklist: add a named break-glass super_admin before retiring the default "admin".', `config system admin\n    edit "<name>_breakglass"\n        set accprofile "super_admin"\n        set password <strong password>\n        set trusthost1 <management network> <mask>\n    next\nend`, '');
    if (x.admins.some(a => a.id === 'admin')) add('Low', 'The default "admin" account is still in use', 'Attackers try "admin" first. Log in with a named account, then delete or rename it.', '', 'admin');
    const lt = Number(g('admin-lockout-threshold') || 3), ld = Number(g('admin-lockout-duration') || 60);
    if (lt > 5) add('Medium', `Admin lockout after ${lt} tries`, 'Lock out after 3 failed logins.', 'config system global\n    set admin-lockout-threshold 3\nend', '');
    if (ld < 300) add('Low', `Admin lockout lasts ${ld} seconds`, 'Five minutes (300) slows password guessing a lot more.', 'config system global\n    set admin-lockout-duration 300\nend', '');
    if (lt <= 5 && ld >= 300) pass('Admin lockout ' + lt + ' tries / ' + ld + ' s');
    const to = Number(g('admintimeout') || 5);
    if (to > 15) add('Medium', `Admin idle timeout is ${to} minutes`, 'An unattended session stays logged in. 5 to 15 minutes is usual.', 'config system global\n    set admintimeout 10\nend', ''); else pass('Admin idle timeout ' + to + ' min');
    if (g('strong-crypto') === 'disable') add('Medium', 'strong-crypto is disabled', 'Old TLS/SSH ciphers are allowed for admin access.', 'config system global\n    set strong-crypto enable\nend', '');
    if (g('admin-telnet') === 'enable') add('High', 'Telnet admin is enabled globally', '', 'config system global\n    set admin-telnet disable\nend', '');
    const hn = g('hostname');
    if (!hn || /^FGT|^FortiGate/i.test(hn)) add('Low', `Hostname is "${hn || 'not set'}"`, 'Name the box after the client and site so logs, FortiCloud and alerts make sense.', 'config system global\n    set hostname "<client>-<site>-FW01"\nend', '');
    if (!g('timezone')) add('Low', 'No time zone set', 'Logs and schedules use the wrong time.', 'config system global\n    set timezone <zone>\nend', '');
    const wanAdmin = x.ifs.filter(i => i.role === 'wan' && i.access.some(s => ['https', 'ssh', 'http', 'telnet'].indexOf(s) >= 0));
    if (wanAdmin.length) add('High', 'Admin login reachable from the internet', `On ${wanAdmin.map(i => i.name).join(', ')}. See Check my interfaces for the fix.`, '', '');
    else if (x.wans.length) pass('No admin access on WAN');
  };

  // ---------- run ----------
  const SEV = { High: 0, Medium: 1, Low: 2 };
  function check(text, id) {
    const tree = typeof text === 'string' ? parse(text) : text, x = ctx(tree);
    const ids = id && id !== 'all' ? [id] : SECTIONS.map(s => s.id);
    const out = { findings: [], passed: [], counts: { High: 0, Medium: 0, Low: 0 } };
    ids.forEach(sid => {
      const add = (sev, title, why, fix, at) => { out.findings.push({ section: sid, sev, title, why: why || '', fix: fix || '', at: at === undefined ? '' : String(at) }); out.counts[sev]++; };
      const pass = t => out.passed.push({ section: sid, title: t });
      if (RULES[sid]) RULES[sid](tree, x, add, pass);
    });
    out.findings.sort((a, b) => SEV[a.sev] - SEV[b.sev]);
    return out;
  }

  // ---------- "Ask real Bob": only the section's config, plus a short context ----------
  function block(text, path) {
    const lines = String(text || '').split(/\r\n|\r|\n/), out = [];
    let on = false;
    for (const l of lines) {
      if (!on && l === 'config ' + path) on = true;
      if (on) { out.push(l); if (l === 'end') break; }
    }
    return out.join('\n');
  }
  function ifSummary(x) {
    return x.ifs.filter(i => i.c || i.role === 'wan' || i.type === 'vlan').map(i => `${i.name}  role ${i.role || '-'}  ${i.c ? fmt(i.c) + ' (gw ' + n2ip(i.c.ip) + ')' : i.mode || '-'}  access ${i.access.join(' ') || '-'}`).join('\n');
  }
  const ASK = {
    interfaces: 'interfaces, VLANs (names 15 chars max, IDs, parent port), zones, DHCP scopes and admin access per interface',
    objects: 'address objects, groups (is every internal subnet in the internal group?), IPv6 objects and custom services',
    policies: 'firewall policy order (FortiOS matches top-down by sequence, final deny last), shadowed or redundant rules, NAT (internet only), no ALL service on allows, security profiles on internet policies and logging',
    routes: 'static routes: default route, blackhole for the internal range at distance 254, gateways and devices',
    vpn: 'IPsec VPN: phase 1/2 proposals and DH groups, IKE version, PSK, client pool, split tunnel and the policies using the tunnel',
    admin: 'admin hardening: trusted hosts, MFA, break-glass super_admin, lockout, idle timeout, strong-crypto, hostname and admin access on WAN',
  };
  function prompt(text, id, client) {
    const s = SECTIONS.find(z => z.id === id); if (!s) return '';
    const tree = parse(text), x = ctx(tree), r = check(tree, id);
    let cfg = s.paths.map(p => block(text, p)).filter(Boolean);
    if (id === 'objects') {                                     // custom services: only the ones in use (the factory list is long)
      const used = {}; list(tree, 'firewall policy').forEach(p => (p.set.service || []).forEach(n => { used[n] = 1; }));
      Object.keys(x.sgrp).forEach(g => x.sgrp[g].forEach(n => { used[n] = 1; }));
      const sv = list(tree, 'firewall service custom').filter(e => used[e.id]);
      cfg = cfg.filter(b => b.indexOf('config firewall service custom') !== 0);
      if (sv.length) cfg.push('config firewall service custom\n' + sv.map(e => `    edit ${qq(e.id)}\n` + Object.keys(e.set).map(k => `        set ${k} ${e.set[k].map(q).join(' ')}`).join('\n') + '\n    next').join('\n') + '\nend');
      cfg = cfg.map(b => b.indexOf('config firewall address\n') === 0 ? b.split('\n    next').filter(e => !MOCK_ADDR.some(n => e.indexOf('edit "' + n + '"') >= 0)).join('\n    next') : b);
    }
    if (id === 'vpn') {
      const tn = list(tree, 'vpn ipsec phase1-interface').map(e => e.id);
      const pols = list(tree, 'firewall policy').filter(p => tn.some(n => (p.set.srcintf || []).indexOf(n) >= 0 || (p.set.dstintf || []).indexOf(n) >= 0));
      if (pols.length) cfg.push('config firewall policy\n' + pols.map(p => `    edit ${p.id}\n` + Object.keys(p.set).map(k => `        set ${k} ${p.set[k].map(q).join(' ')}`).join('\n') + '\n    next').join('\n') + '\nend');
    }
    const found = r.findings.length ? r.findings.map(f => `- [${f.sev}] ${f.title}`).join('\n') : '- nothing flagged';
    return `Bob, check my ${s.short.toLowerCase()} only, from a FortiGate built with SubnetPal${client ? ` for client "${client}"` : ''} (FortiOS 8.0.2 practice mock, SubnetPal Lab). Look at ${ASK[id]}. List issues by severity (High, Medium, Low), each with the fix as FortiOS CLI. Tell me if any of SubnetPal's offline findings below are wrong.\n\nSubnetPal offline checks found:\n${found}\n\nInterfaces for context (name, role, subnet, admin access):\n${ifSummary(x)}\n\n${cfg.join('\n') || '(this section is empty in the config)'}\n`;
  }

  const BobCheck = { parse, check, prompt, block, SECTIONS, tokens, cidr };
  if (typeof module !== 'undefined' && module.exports) module.exports = BobCheck; else root.BobCheck = BobCheck;
})(this);
