/* SubnetPal - exporters (CSV, Markdown, text, FortiOS, client handover doc). Pure, no DOM. window.Fmt / Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./access.js'), require('./policy.js'), require('./remote.js'), require('./webcat.js'), require('./routes.js'));
  else root.Fmt = factory(root.Access, root.Policy, root.Remote, root.Webcat, root.Routes);
}(typeof self !== 'undefined' ? self : this, function (Access, Policy, Remote, Webcat, Routes) {
  'use strict';

  const FORTI_NOTE = 'Generated, untested. Verify against FortiOS 8.0 docs and the lab VM before applying. Starter policies are not production rules.';
  const WAN_IF = 'wan1';
  const FORTI_ROLE = { LAN: 'lan', Guest: 'lan', Mgmt: 'lan', DMZ: 'dmz', WAN: 'wan', Transit: 'undefined', Loopback: 'undefined', '': 'lan' };
  const EXP_LABEL = { none: 'None', soon: 'Soon', big: 'Big growth' };
  const COUNT_LABEL = { staff: 'staff', wired: 'wired devices', wifi: 'Wi-Fi devices', voice: 'phones', cameras: 'cameras', iot: 'IoT devices', servers: 'servers', guest: 'guest users', dmz: 'public servers (DMZ)', printers: 'printers', pos: 'card terminals' };
  const REQ_LABEL = { guest: 'Guest Wi-Fi separation', dmz: 'DMZ / public servers', voice: 'Voice VLAN', cameras: 'Cameras VLAN', iot: 'IoT VLAN', printers: 'Printers VLAN', pos: 'Card payments (POS) isolated' };

  const rng = (a, b) => (a && b ? `${a} - ${b}` : '');
  const usable = a => (a.prefix === 32 ? a.firstUsable : rng(a.firstUsable, a.lastUsable));
  const csvCell = v => { const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const mdCell = v => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- CSV / Markdown / text ----------
  function toCSV(result) {
    const head = ['Name', 'VLAN', 'Role', 'CIDR', 'Netmask', 'Wildcard', 'Network', 'Gateway', 'First usable', 'Last usable', 'Broadcast', 'Total addresses', 'Usable hosts', 'Static range', 'DHCP range'];
    if (result.v6) head.push('IPv6 subnet', 'IPv6 gateway');
    const lines = [head.map(csvCell).join(',')];
    result.allocations.forEach(a => lines.push([
      a.name, a.vlan, a.role, a.cidr, a.netmask, a.wildcard, a.network, a.gateway, a.firstUsable, a.lastUsable, a.broadcast,
      a.totalAddresses, a.usableHosts, rng(a.staticStart, a.staticEnd), rng(a.dhcpStart, a.dhcpEnd),
    ].concat(result.v6 ? [a.v6 ? a.v6.cidr : '', a.v6 ? a.v6.address : ''] : []).map(csvCell).join(',')));
    return lines.join('\n') + '\n';
  }

  function mdTable(head, rows) {
    return ['| ' + head.join(' | ') + ' |', '| ' + head.map(() => '---').join(' | ') + ' |']
      .concat(rows.map(r => '| ' + r.map(mdCell).join(' | ') + ' |')).join('\n') + '\n';
  }

  function toMarkdown(result, project) {
    const title = project && project.name ? `### IP plan: ${project.name}\n\nParent block: \`${result.parent.cidr}\`\n\n` : '';
    return title + mdTable(
      ['Name', 'VLAN', 'Role', 'CIDR', 'Netmask', 'Gateway', 'Usable range', 'Broadcast', 'Usable hosts', 'Static', 'DHCP'],
      result.allocations.map(a => [a.name, a.vlan, a.role, a.cidr, a.netmask, a.gateway, usable(a), a.broadcast, a.usableHosts, rng(a.staticStart, a.staticEnd), rng(a.dhcpStart, a.dhcpEnd)])
    );
  }

  function handoverRows(result) {
    return result.allocations.map(a => ({
      name: a.name, vlan: a.vlan === '' ? '' : String(a.vlan), role: a.role, subnet: a.cidr, mask: a.netmask,
      gateway: a.gateway || (a.prefix === 31 ? 'n/a (point-to-point)' : ''), usable: usable(a),
      static: rng(a.staticStart, a.staticEnd), dhcp: rng(a.dhcpStart, a.dhcpEnd),
      subnet6: a.v6 ? a.v6.cidr : '', gateway6: a.v6 ? a.v6.address : '',
    }));
  }
  const HANDOVER_HEAD = ['Network', 'VLAN', 'Role', 'Subnet', 'Subnet mask', 'Default gateway', 'Usable range', 'Static range', 'DHCP range'];
  const handoverCells = r => [r.name, r.vlan, r.role, r.subnet, r.mask, r.gateway, r.usable, r.static, r.dhcp];

  function toText(result, project) {
    const out = [];
    if (project && project.name) out.push(`IP plan: ${project.name}`);
    out.push(`Parent block: ${result.parent.cidr}`);
    if (result.v6) out.push(`IPv6 site prefix: ${result.v6.cidr} (${result.v6.kind})`);
    out.push('');
    result.allocations.forEach(a => {
      out.push(`${a.name}${a.vlan !== '' ? ` (VLAN ${a.vlan})` : ''}${a.role ? ` [${a.role}]` : ''}`);
      out.push(`  Network:   ${a.cidr}  (mask ${a.netmask}, wildcard ${a.wildcard})`);
      if (a.gateway) out.push(`  Gateway:   ${a.gateway}`);
      if (a.v6) out.push(`  IPv6:      ${a.v6.cidr}  (firewall address ${a.v6.address})`);
      out.push(`  Usable:    ${usable(a)}`);
      if (a.broadcast) out.push(`  Broadcast: ${a.broadcast}`);
      out.push(`  Addresses: ${a.totalAddresses} total, ${a.usableHosts} usable`);
      if (a.staticStart) out.push(`  Static:    ${rng(a.staticStart, a.staticEnd)}`);
      if (a.dhcpStart) out.push(`  DHCP:      ${rng(a.dhcpStart, a.dhcpEnd)}`);
      out.push('');
    });
    const s = result.summary;
    if (s) out.push(`Used ${s.used} of ${s.parentSize} addresses, ${s.free} free.` + (s.largestFree ? ` Largest free block: ${s.largestFree.cidr}.` : ''));
    result.gaps.forEach(g => out.push(`Free: ${g.cidrs.map(c => c.cidr).join(', ')} (${g.size} addresses)${g.between ? ' - gap between allocations' : ''}`));
    return out.join('\n') + '\n';
  }

  // ---------- FortiOS ----------
  const q = s => '"' + String(s).replace(/"/g, '') + '"';
  const fname = s => String(s).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  const sanitizeIf = s => String(s).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 15);

  // Port plan. With "ports available" set (project.portCount), every plain network gets a real port from the pool (port1..portN, name = project.portPrefix),
  // either the one picked on its card (project.portMap[name]) or the lowest free one. VLAN networks share one parent port: the explicit Parent port if given,
  // else the highest free port. Networks left without a port are listed in .short. With no count set, nothing changes: the placeholder is used.
  // VLAN interface name: <Network name>_V<id>, e.g. Management -> Management_V10. Letters/digits/underscore only, max 15 chars (FortiOS limit), unique.
  function vlanIf(a, used) {
    const suf = '_V' + a.vlan;
    let base = String(a.name).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, Math.max(0, 15 - suf.length)).replace(/_+$/, '');
    if (!base) base = 'vlan';
    let n = base + suf, k = 1;
    while (used.has(n)) { k++; const t = String(k); n = base.slice(0, Math.max(1, 15 - suf.length - t.length)) + t + suf; }
    used.add(n); return n;
  }
  const PH = 'PORT_CHANGE_ME';
  const phOf = ifName => (ifName && String(ifName).trim()) || PH;
  function portPool(project) {
    const n = Math.min(48, Math.max(0, Math.floor(Number(project && project.portCount)) || 0));
    const pre = sanitizeIf((project && project.portPrefix && String(project.portPrefix).trim()) || 'port');
    return Array.from({ length: n }, (_, i) => pre + (i + 1));
  }
  const isPlain = a => a.vlan === '' && a.role !== 'Loopback' && a.role !== 'WAN';
  function portPlan(allocs, ph, project) {
    const pool = portPool(project);
    const names = [], short = [], usedV = new Set();
    if (!pool.length) {
      let plain = 0;
      const plainCount = allocs.filter(a => a.vlan === '' && a.role !== 'Loopback').length;
      allocs.forEach(a => names.push(a.role === 'Loopback' ? sanitizeIf('lo_' + a.name) : a.vlan !== '' ? vlanIf(a, usedV) : plainCount > 1 ? sanitizeIf(ph + (++plain)) : sanitizeIf(ph)));
      return { pool, names, parent: ph, short, free: [] };
    }
    const map = (project && project.portMap) || {};
    const taken = new Set(), explicit = ph !== PH ? ph : '';
    if (explicit && pool.indexOf(explicit) >= 0) taken.add(explicit);
    allocs.forEach(a => { const p = map[a.name]; if (isPlain(a) && pool.indexOf(p) >= 0 && p !== explicit) taken.add(p); });
    const nextLow = () => pool.find(p => !taken.has(p));
    let wan = 0;
    allocs.forEach(a => {
      if (a.role === 'Loopback') return names.push(sanitizeIf('lo_' + a.name));
      if (a.vlan !== '') return names.push(vlanIf(a, usedV));
      if (a.role === 'WAN') return names.push('wan' + (++wan));
      let p = map[a.name];
      if (!(pool.indexOf(p) >= 0 && p !== explicit)) { p = nextLow(); if (p) taken.add(p); }
      if (!p) { short.push(a.name); p = ph; }
      names.push(sanitizeIf(p));
    });
    let parent = explicit;
    if (!parent) { const f = pool.slice().reverse().find(p => !taken.has(p)); parent = f || ph; if (f && allocs.some(a => a.vlan !== '' && a.role !== 'Loopback')) taken.add(f); }
    const vlans = allocs.some(a => a.vlan !== '' && a.role !== 'Loopback');
    return { pool, names, parent, short, free: pool.filter(p => !taken.has(p)), vlans };
  }
  const ifaceNames = (allocs, ph, project) => portPlan(allocs, ph, project).names;
  const parentPort = (allocs, ph, project) => portPlan(allocs, ph, project).parent;
  const portWarn = (allocs, ph, project) => { const pl = portPlan(allocs, ph, project); return pl.short.length ? [`# !! PORTS: only ${pl.pool.length} LAN port(s) available, none left for: ${pl.short.join(', ')}. Those use "${ph}" below. Add ports, or put the network on a VLAN (set its VLAN ID in the plan).`] : []; };

  // Website filter + application control profiles for the policies that ask for them. Returns Map(policy id -> { web, app } profile names).
  function profileCLI(L, pols) {
    const out = new Map(), webs = [], apps = [], wsig = new Map();
    pols.forEach(p => {
      const wf = p.webf && Webcat.entries(p.webf.groups).length ? p.webf : null;  // a profile that allows everything adds nothing
      if (p.action !== 'accept' || (!p.web && !p.app && !wf)) return;            // profiles only ever attach to Accept policies
      const e = {}; out.set(p.id, e);
      if (p.web || wf) {                                                         // identical profiles are shared between policies
        const sig = JSON.stringify([p.web || null, wf ? wf.groups : null]);
        if (!wsig.has(sig)) { const name = 'SP_Web_' + (webs.length + 1); wsig.set(sig, name); webs.push({ name, w: p.web, f: wf, used: [] }); }
        e.web = wsig.get(sig); webs.find(x => x.name === e.web).used.push(p.name);
      }
      if (p.app) { e.app = 'SP_App_' + (apps.length + 1); apps.push({ name: e.app, a: p.app }); }
    });
    if (webs.length) {
      L.push('', '# Website filtering. Verify profile and setting names against the FortiOS 8.0 docs and the lab VM. FortiGuard category IDs are UNVERIFIED (from memory). SAFER: build the profile in the GUI (Security Profiles > Web Filter), then read the real IDs back with: show webfilter profile. Do not paste these IDs blind.');
      L.push('# Web filtering needs a FortiGuard licence. Blocking HTTPS sites by category with certificate inspection is done from the site name; a block or warning page may only display with deep inspection (unverified; Warn pages probably need deep inspection over HTTPS). Only a web filter profile is generated here: no IPS, antivirus or SSL inspection profiles. Category blocking on the Servers network can break OS and vendor updates.');
      if (webs.some(x => x.w)) {
        L.push('config webfilter urlfilter');
        webs.forEach(({ name, w }, i) => {
          if (!w) return;
          const sites = String(w.sites || '').split(/[\s,;]+/).map(s => s.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim()).filter(Boolean);
          const act = w.mode === 'allow' ? 'allow' : 'block';
          L.push(`    edit ${101 + i}`, `        set name ${q(name + '_urls')}`, '        config entries');
          sites.forEach((s, k) => L.push(`            edit ${k + 1}`, `                set url ${q(s)}`, '                set type simple', `                set action ${act}`, '            next'));
          if (w.mode === 'allow') L.push(`            edit ${sites.length + 1}`, '                set url "*"', '                set type wildcard', '                set action block', '            next');
          L.push('        end', '    next');
        });
        L.push('end', '');
      }
      // One map of every category ID used, so each ID can be checked against its name once.
      const idMap = new Map(), notes = new Set();
      webs.forEach(({ w, f }) => {
        (w ? (w.cats || []).filter(Boolean) : []).forEach(c => idMap.set(Number(c), (Policy.WEB_CATS.find(x => x.id === Number(c)) || {}).l || 'category'));
        if (f) { Webcat.entries(f.groups).forEach(x => idMap.set(x.id, x.name)); Webcat.notes(f.groups).forEach(n => notes.add(n)); }
      });
      if (idMap.size) L.push('# Category IDs used below and the category each one is MEANT to be (UNVERIFIED, from memory): ' + Array.from(idMap).sort((a, b) => a[0] - b[0]).map(([id, n]) => `${id} ${n}`).join(', ') + '.');
      notes.forEach(n => L.push('# ' + n));
      webs.forEach(({ name, w, f, used }) => L.push(`# ${name} (${f ? Webcat.label(f.preset) + ': ' + Webcat.summary(f.groups) : 'your own site and category lists'}). Used by: ${used.join(', ')}.`));
      L.push('config webfilter profile');
      webs.forEach(({ name, w, f }, i) => {
        L.push(`    edit ${q(name)}`);
        if (w) L.push('        config web', `            set urlfilter-table ${101 + i}`, '        end');
        const entries = (w ? (w.cats || []).filter(Boolean) : []).map(c => ({ id: Number(c), action: w.mode === 'allow' ? 'monitor' : 'block' }));
        if (f) Webcat.entries(f.groups).forEach(x => { if (!entries.some(y => y.id === x.id)) entries.push(x); });
        if (entries.length) {
          L.push('        config ftgd-wf', '            config filters');
          entries.forEach((x, k) => L.push(`                edit ${k + 1}`, `                    set category ${x.id}`, `                    set action ${x.action}`, '                next'));
          L.push('            end', '        end');
        }
        L.push('    next');
      });
      L.push('end');
    }
    if (apps.length) {
      L.push('', '# Application control. Verify profile and setting names against the FortiOS 8.0 docs and the lab VM. Category IDs are unverified.');
      L.push('config application list');
      apps.forEach(({ name, a }) => {
        const cats = (a.cats || []).filter(Boolean);
        L.push(`    edit ${q(name)}`, '        config entries', '            edit 1');
        if (cats.length) L.push(`                set category ${cats.join(' ')}`);
        L.push(`                set action ${a.mode === 'allow' ? 'pass' : 'block'}`, '            next');
        if (a.mode === 'allow') L.push('            edit 2', '                set action block', '            next');
        L.push('        end', '    next');
      });
      L.push('end');
    }
    return out;
  }

  // Access list for one network, as FortiOS CLI. Empty means the interface answers nothing.
  const accessCLI = (a, ind) => { const v = Access.adminAccess(a); return v.length ? `${ind}set allowaccess ${v.join(' ')}` : `${ind}unset allowaccess`; };
  const ifaceLines = (a, name, ph) => {
    const L = [`    edit ${q(name)}`, '        set vdom "root"', `        set ip ${a.gateway ? a.gateway : a.firstUsable} ${a.netmask}`, accessCLI(a, '        ')];
    if (a.v6) {
      L.push('        config ipv6', '            set ip6-mode static', `            set ip6-address ${a.v6.address}/${a.v6.prefix}`, accessCLI(a, '            ').replace('allowaccess', 'ip6-allowaccess'));
      if (a.dhcpStart) L.push('            set ip6-send-adv enable'); // client networks: advertise the /64 so devices self-configure (SLAAC)
      L.push('        end');
    }
    if (a.role === 'Loopback') L.push('        set type loopback');
    else if (a.vlan !== '') L.push(`        set interface ${q(ph)}`, `        set vlanid ${a.vlan}`);
    L.push(`        set role ${FORTI_ROLE[a.role] || 'lan'}`, `        set alias ${q(a.name)}`, '    next');
    return L;
  };
  // Optional per-network DNS: dns = { server, domain }. Empty = "Same as System DNS". Only a plain IPv4 address is accepted.
  const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const okIp = s => { const m = IPV4.exec(String(s || '').trim()); return !!m && m.slice(1).every(x => Number(x) <= 255); };
  const dnsOf = (project, a) => { const d = project && project.dhcpDns && project.dhcpDns[a.name] || {}; return { server: okIp(d.server) ? String(d.server).trim() : '', domain: /^[A-Za-z0-9.-]{1,60}$/.test(String(d.domain || '').trim()) ? String(d.domain).trim() : '' }; };
  // Fixed firewall policy IDs (pasting twice overwrites, never adds): IPv4 final deny 1000, policies 1001+; IPv6 2000 / 2001+; remote staff 3001+. Order on screen comes from paste order, not the ID.
  const POL_ID0 = 1000, POL6_ID0 = 2000, VPNPOL_ID0 = 3000;
  const DHCP_ID0 = 101; // first DHCP server ID we use: a factory FortiGate already has ID 1, and re-using it would overwrite that server
  const dhcpLines = (a, name, id, lease, dns) => ['    edit ' + id, ...(dns && dns.server ? ['        set dns-service specify', `        set dns-server1 ${dns.server}`] : ['        set dns-service default']), ...(dns && dns.domain ? [`        set domain ${q(dns.domain)}`] : []), `        set default-gateway ${a.gateway}`, ...(lease ? [`        set lease-time ${lease}`] : []), `        set netmask ${a.netmask}`, `        set interface ${q(name)}`,
    '        config ip-range', '            edit 1', `                set start-ip ${a.dhcpStart}`, `                set end-ip ${a.dhcpEnd}`, '            next', '        end', '    next'];

  // Shared warnings: the parent port must never be the port you are managing through; dual WAN needs the SD-WAN zone.
  const lockWarn = ph => [`# !! WARNING: "${ph}" must NOT be the port you are managing the firewall through. Changing its address or VLAN mid-paste locks you out. Use a spare port, or have console access ready.`];
  const wanWarn = project => (project && project.intake && project.intake.dualWan) ? [
    `# !! DUAL WAN: every policy and the VPN below use "${WAN_IF}" only. If wan1 and wan2 are SD-WAN members, policies cannot use a member port: replace "${WAN_IF}" in each dstintf line with your SD-WAN zone (default name "virtual-wan-link"; check: show system sdwan). Create the zone and members first, and keep the VPN on a physical WAN port.`] : [];

  // ifName: the single interface-name placeholder the user edits.
  function buildFortiOS(result, project, ifName, opts) {
    const idOff = (opts && opts.idOffset) || 0;
    const ph = phOf(ifName);
    const allocs = result.allocations;
    const names = ifaceNames(allocs, ph, project), parent = parentPort(allocs, ph, project);
    const info = allocs.map((a, i) => ({ a, name: names[i] }));
    const byAlloc = new Map(info.map(x => [x.a, x]));
    const L = [];
    L.push('# ===== SubnetPal FortiOS snippet =====');
    L.push('# ' + FORTI_NOTE);
    if (!portPool(project).length || ph !== PH) L.push(`# >>> INTERFACE NAME PLACEHOLDER: "${ph}"  <<<  Replace every occurrence with your real port/aggregate name.`);
    if (portPool(project).length) L.push('# Ports: assigned from the ports available in the plan (port picker on each network card). Check each name against System > Network > Interfaces.');
    L.push(...lockWarn(parent), ...portWarn(allocs, ph, project), ...wanWarn(project));
    if (result.v6) L.push(`# IPv6: site prefix ${result.v6.cidr} (${result.v6.kind}). Each network is a /64 (SLAAC via router advertisements on client networks). If IPv6 is hidden in the GUI, enable it under System > Feature Visibility.`);
    L.push('# VLAN sub-interfaces use the placeholder as their parent port. Non-VLAN networks use it as the interface name itself.');
    L.push(`# Policies assume the internet-facing interface is "${WAN_IF}". Change it if yours differs.`);
    L.push('');
    L.push('config system interface');
    info.forEach(({ a, name }) => L.push(...ifaceLines(a, name, parent)));
    L.push('end');

    const dhcp = info.filter(({ a }) => a.dhcpStart);
    if (dhcp.length) {
      L.push('', `# DHCP server IDs start at ${DHCP_ID0} (fixed per network, so pasting twice overwrites instead of adding) and cannot overwrite a factory server. Check first: show system dhcp server`);
      L.push('config system dhcp server');
      dhcp.forEach(({ a, name }, i) => L.push(...dhcpLines(a, name, DHCP_ID0 + i, 0, dnsOf(project, a))));
      L.push('end');
    }

    // Suggested static routes the engineer has ticked (default route, blackhole). Before the policies so the paste order stays logical.
    const rt = Routes.lines(result, project);
    if (rt.length) L.push('', ...rt);

    // Firewall address objects: one per subnet.
    const used = new Set();
    info.forEach(x => {
      let n = 'SP_' + (fname(x.a.name) || 'net'), k = 2;
      while (used.has(n)) n = 'SP_' + fname(x.a.name) + '_' + k++;
      used.add(n); x.obj = n.slice(0, 79);
    });
    L.push('', 'config firewall address');
    info.forEach(x => {
      L.push(`    edit ${q(x.obj)}`);
      L.push(`        set subnet ${x.a.network} ${x.a.netmask}`);
      L.push(`        set comment ${q(x.a.name + ' (' + x.a.cidr + ')')}`);
      L.push('    next');
    });
    L.push('end');

    // Policies come from the Policies section (edited list) or, untouched, from the default access rules for this plan.
    const res = Policy.resolve(Policy.effective(project, allocs), allocs);
    const pols = res.pols;
    const internal = info.filter(x => Access.isInternal(x.a));
    if (pols.some(p => p.to === 'internal') && internal.length) {
      L.push('', 'config firewall addrgrp', '    edit "SP_INTERNAL"');
      L.push('        set member ' + internal.map(x => q(x.obj)).join(' '));
      L.push('    next', 'end');
    }
    // Optional security profiles (website filter, application control) attached to individual policies.
    const prof = profileCLI(L, pols);
    const usedNames = new Set();
    const polName = (pre, p) => { let n = (pre + fname(p.name.replace('(block)', 'block'))).slice(0, 35), k = 2; while (usedNames.has(n)) n = (pre + fname(p.name.replace('(block)', 'block'))).slice(0, 32) + '_' + k++; usedNames.add(n); return n; };
    const customSvc = Object.keys(Policy.CUSTOM_SERVICES || {}).filter(n => pols.some(p => p.services.indexOf(n) >= 0));
    if (customSvc.length) {
      L.push('', 'config firewall service custom');
      customSvc.forEach(n => { const s = Policy.CUSTOM_SERVICES[n]; L.push(`    edit ${q(n)}`, `        set tcp-portrange ${s.tcp}`, `        set comment ${q(s.comment)}`, '    next'); });
      L.push('end');
    }
    L.push('', '# ' + Policy.NOTE);
    L.push('# Policies are ordered top to bottom (first match wins); the last one denies everything else.');
    L.push('config firewall policy');
    pols.forEach((p, k) => {
      const f = byAlloc.get(p.from);
      const t = p.to === 'internet' || p.to === 'internal' ? null : byAlloc.get(p.to);
      L.push('    edit ' + (POL_ID0 + 1 + idOff + k));
      L.push(`        set name ${q(polName('SP_', p))}`);
      if (!p.enabled) L.push('        set status disable');
      L.push(`        set srcintf ${q(f.name)}`);
      L.push(`        set dstintf ${q(p.to === 'internet' ? WAN_IF : p.to === 'internal' ? 'any' : t.name)}`);
      L.push(`        set action ${p.action}`);
      if (p.insp === 'proxy') L.push('        set inspection-mode proxy');
      L.push(`        set srcaddr ${q(f.obj)}`);
      L.push(`        set dstaddr ${q(p.to === 'internet' ? 'all' : p.to === 'internal' ? 'SP_INTERNAL' : t.obj)}`);
      L.push(`        set schedule ${q(p.sched)}`);
      L.push(`        set service ${p.services.map(q).join(' ')}`);
      if (p.action === 'accept' && p.nat) {
        L.push('        set nat enable');
        if (p.ippool === 'dynamic') L.push('        set ippool enable', '        set poolname "POOL_NAME_CHANGE_ME"   # create it first: Policy & Objects > IP Pools');
        if (p.snat === 'never') L.push('        set fixedport enable');
        else if (p.snat === 'always') L.push('        # Source port translation "Always": set it on the IP pool (UNVERIFIED, check the GUI field on the VM)');
      }
      L.push(`        set logtraffic ${p.log ? p.logmode : 'disable'}`);
      if (p.log && p.logstart) L.push('        set logtraffic-start enable');
      if (p.capture) L.push('        set capture-packet enable');
      const pr = prof.get(p.id), u = p.utm || {};
      const on = ['av', 'web', 'dns', 'app', 'ips', 'file'].filter(k => u[k]);
      if (p.action === 'accept' && (pr || on.length)) {
        L.push('        set utm-status enable', `        set ssl-ssh-profile ${q(p.ssl || 'certificate-inspection')}`);
        if (pr && pr.web) L.push(`        set webfilter-profile ${q(pr.web)}`); else if (u.web) L.push('        set webfilter-profile "default"');
        if (pr && pr.app) L.push(`        set application-list ${q(pr.app)}`); else if (u.app) L.push('        set application-list "default"');
        if (u.av) L.push('        set av-profile "default"');
        if (u.dns) L.push('        set dnsfilter-profile "default"');
        if (u.ips) L.push('        set ips-sensor "default"');
        if (u.file) L.push('        set file-filter-profile "default"');
      } else if (p.action === 'accept' && p.ssl) L.push(`        set ssl-ssh-profile ${q(p.ssl)}`);
      L.push(`        set comments ${q(p.comments || 'SubnetPal policy')}`);
      L.push('    next');
    });
    L.push('    edit ' + POL_ID0, '        set name "SP_Final_deny"', '        set srcintf "any"', '        set dstintf "any"', '        set action deny', '        set srcaddr "all"', '        set dstaddr "all"',
      '        set schedule "always"', '        set service "ALL"', '        set logtraffic all', `        set comments ${q('SubnetPal final deny')}`, '    next', 'end');
    res.skipped.forEach(n => L.push(`# Skipped (network not in the current plan): ${n}`));
    if (result.v6) {
      info.forEach(x => { x.obj6 = ('SP6_' + x.obj.slice(3)).slice(0, 79); });
      L.push('', 'config firewall address6');
      info.forEach(x => {
        L.push(`    edit ${q(x.obj6)}`, `        set ip6 ${x.a.v6.cidr}`, `        set comment ${q(x.a.name + ' (' + x.a.v6.cidr + ')')}`, '    next');
      });
      L.push('end');
      if (pols.some(p => p.to === 'internal') && internal.length) {
        L.push('', 'config firewall addrgrp6', '    edit "SP6_INTERNAL"', '        set member ' + internal.map(x => q(x.obj6)).join(' '), '    next', 'end');
      }
      if (pols.length) {
        L.push('', '# IPv6 policies mirror the IPv4 ones (no NAT, no website or application profiles). ' + Policy.NOTE);
        L.push('config firewall policy6');
        usedNames.clear();
        pols.forEach((p, k) => {
          const f = byAlloc.get(p.from);
          const t = p.to === 'internet' || p.to === 'internal' ? null : byAlloc.get(p.to);
          L.push('    edit ' + (POL6_ID0 + 1 + idOff + k), `        set name ${q(polName('SP6_', p))}`, `        set srcintf ${q(f.name)}`);
          L.push(`        set dstintf ${q(p.to === 'internet' ? WAN_IF : p.to === 'internal' ? 'any' : t.name)}`);
          L.push(`        set action ${p.action}`, `        set srcaddr ${q(f.obj6)}`);
          L.push(`        set dstaddr ${q(p.to === 'internet' ? 'all' : p.to === 'internal' ? 'SP6_INTERNAL' : t.obj6)}`);
          L.push(`        set schedule ${q(p.sched)}`, `        set service ${p.services.map(q).join(' ')}`, `        set logtraffic ${p.log ? p.logmode : 'disable'}`);
          if (!p.enabled) L.push('        set status disable');
          L.push(`        set comments ${q(p.comments || 'SubnetPal policy')}`, '    next');
        });
        L.push('    edit ' + POL6_ID0, '        set name "SP6_Final_deny"', '        set srcintf "any"', '        set dstintf "any"', '        set action deny', '        set srcaddr "all"', '        set dstaddr "all"',
          '        set schedule "always"', '        set service "ALL"', '        set logtraffic all', '    next', 'end');
      }
    }
    L.push('', '# ' + FORTI_NOTE);
    return L.join('\n') + '\n';
  }

  // Pasteable text = no '#' lines (not CLI, and the web console chokes on them). The comments become a separate notes text, shown beside the CLI and never pasted.
  const isNote = l => /^\s*#/.test(l);
  const cliOnly = t => String(t).split('\n').filter(l => !isNote(l)).join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  const notesOnly = t => String(t).split('\n').filter(isNote).map(l => l.replace(/^\s*#\s?/, '')).join('\n');
  const dhcpId = (allocs, a) => DHCP_ID0 + Math.max(0, allocs.filter(x => x.dhcpStart).indexOf(a));
  // Public generators return pasteable CLI only; the *Notes versions return the comments; *Raw keeps both.
  const toFortiOSRaw = buildFortiOS, toPolicyFortiOSRaw = buildPolicyFortiOS, toRemoteFortiOSRaw = buildRemoteFortiOS;
  const toFortiOS = (...x) => cliOnly(buildFortiOS(...x)), fortiNotes = (...x) => notesOnly(buildFortiOS(...x));
  const toPolicyFortiOS = (...x) => cliOnly(buildPolicyFortiOS(...x)), policyNotes = (...x) => notesOnly(buildPolicyFortiOS(...x));
  const toRoutesFortiOS = (...x) => cliOnly(buildRoutesFortiOS(...x)), routesNotes = (...x) => notesOnly(buildRoutesFortiOS(...x));
  const toRemoteFortiOS = (...x) => cliOnly(buildRemoteFortiOS(...x)), remoteNotes = (...x) => notesOnly(buildRemoteFortiOS(...x));

  // Just the address objects, profiles and policies from the main snippet (interfaces and DHCP left out).
  function buildPolicyFortiOS(result, project, ifName, opts) {
    const full = buildFortiOS(result, project, ifName, opts);
    const i = full.indexOf('config firewall address\n');
    const head = ['# ===== SubnetPal policies =====', '# ' + FORTI_NOTE, '# ' + Policy.NOTE,
      `# >>> INTERFACE NAME PLACEHOLDER: "${phOf(ifName)}"  <<<  Use the same interface names as the main snippet. Internet-facing interface is assumed to be "${WAN_IF}".`, ...wanWarn(project), '# Paste the interfaces first. Policies have fixed IDs, so pasting twice overwrites them instead of adding copies.', ''];
    const body = i >= 0 ? full.slice(i) : full;
    return head.join('\n') + '\n' + (opts && opts.only ? onlyNeeded(body) : body);
  }

  // One policy on its own: keep its policy block(s) and only the objects it points to (addresses, groups, services, profiles, url tables), and drop the
  // final deny and every unused object. Entry IDs and names are untouched, so pasting it on top of the full export overwrites the same entries.
  function onlyNeeded(text) {
    const blocks = []; let cur = null, pend = [];
    text.split('\n').forEach(l => {
      if (!cur) { if (/^config /.test(l)) cur = { head: l, pre: pend, entries: [] }, pend = []; else if (l.trim()) pend.push(l); return; }
      if (l === 'end') { blocks.push(cur); cur = null; return; }
      const m = /^    edit (.+)$/.exec(l);
      if (m) cur.entries.push({ key: m[1].replace(/^"|"$/g, ''), lines: [l] }); else if (cur.entries.length) cur.entries[cur.entries.length - 1].lines.push(l);
    });
    const isPol = b => /^config firewall policy6?$/.test(b.head);
    const keep = new Set();
    let need = '';
    blocks.filter(isPol).forEach(b => b.entries.forEach(e => { if (Number(e.key) % 1000 !== 0) { keep.add(e); need += e.lines.join('\n') + '\n'; } }));
    for (let again = true; again;) {
      again = false;
      blocks.filter(b => !isPol(b)).forEach(b => b.entries.forEach(e => {
        if (keep.has(e)) return;
        const hit = need.indexOf('"' + e.key + '"') >= 0 || (/^\d+$/.test(e.key) && need.indexOf('urlfilter-table ' + e.key + '\n') >= 0);
        if (hit) { keep.add(e); need += e.lines.join('\n') + '\n'; again = true; }
      }));
    }
    const out = [];
    blocks.forEach(b => {
      const es = b.entries.filter(e => keep.has(e)); if (!es.length) return;
      out.push('', ...b.pre, b.head); es.forEach(e => out.push(...e.lines)); out.push('end');
    });
    return out.join('\n').replace(/^\n/, '') + '\n';
  }

  // Just the static routes (the same lines the main snippet carries).
  function buildRoutesFortiOS(result, project) {
    const rt = Routes.lines(result, project);
    return ['# ===== SubnetPal static routes =====', '# ' + FORTI_NOTE, ...(rt.length ? rt : ['# No static routes are ticked.'])].join('\n') + '\n';
  }

  // ---------- IPsec remote access (dial-up) ----------
  function buildRemoteFortiOS(result, project, ifName) {
    const pool = Remote.plan(result, project);
    if (!pool) return '';
    const ph = phOf(ifName);
    const L = ['# ===== SubnetPal IPsec remote access snippet =====', '# ' + FORTI_NOTE, '# ' + Policy.NOTE, '# Test before applying. PSK_CHANGE_ME is a placeholder: use a random key of 12+ characters and share it securely (the app never stores it). Create the users and the RemoteStaff group first (steps 1-2 on the card).'];
    if (!pool.ok) { L.push('# ' + pool.error); return L.join('\n') + '\n'; }
    const names = ifaceNames(result.allocations, ph, project);
    const reach = Remote.reachList(result, project);
    const idx = a => result.allocations.indexOf(a);
    const objOf = a => 'SP_' + (fname(a.name) || 'net');
    L.push(...lockWarn(parentPort(result.allocations, ph, project)), ...wanWarn(project));
    L.push(`# Internet-facing interface is assumed to be "${WAN_IF}". Interface names for office networks use the placeholder "${ph}" like the main snippet.`);
    pool.notes.forEach(n => L.push('# ' + n));
    L.push('', 'config firewall address', '    edit "SP_VPN_POOL"', `        set subnet ${pool.network} ${pool.netmask}`, `        set comment ${q('VPN user pool ' + pool.cidr)}`, '    next');
    reach.forEach(a => L.push(`    edit ${q(objOf(a))}`, `        set subnet ${a.network} ${a.netmask}`, `        set comment ${q(a.name + ' (' + a.cidr + ')')}`, '    next'));
    L.push('end');
    if (reach.length) L.push('', 'config firewall addrgrp', '    edit "SP_VPN_SPLIT"', '        set member ' + reach.map(a => q(objOf(a))).join(' '), '    next', 'end');
    else L.push('', '# No office networks are ticked for remote staff, so there is no split-tunnel list or policy.');
    L.push('', '# Phase 1: dial-up. IKE version is NOT forced: leave what the VPN Wizard (FortiClient template) chose. This snippet is the IKEv1 + XAuth dial-up (FortiClient IPsec): xauthtype is an IKEv1 feature. If your wizard chose IKEv2, delete the xauthtype line and use EAP instead. CONFIRM ON THE VM. Weak crypto is left out (no DES, 3DES, MD5, SHA1); DH 20 and 21.',
      'config vpn ipsec phase1-interface', '    edit "SP_VPN"', '        set type dynamic', `        set interface ${q(WAN_IF)}`,
      '        set peertype any', '        set net-device disable', '        set mode-cfg enable', '        set proposal aes256-sha256', '        set dhgrp 20 21',
      '        set dpd on-idle', '        set xauthtype auto', '        set authusrgrp "RemoteStaff"',
      `        set ipv4-start-ip ${pool.first}`, `        set ipv4-end-ip ${pool.last}`, `        set ipv4-netmask ${pool.netmask}`);
    const vd = reach.map(x => dnsOf(project, x)).find(d => d.server) || null; // VPN clients use the office DNS set on the first ticked network that has one
    if (vd && vd.server) L.push(`        set ipv4-dns-server1 ${vd.server}`);
    if (vd && vd.domain) L.push(`        set domain ${q(vd.domain)}`);
    else if (!vd || !vd.server) L.push('        # set ipv4-dns-server1 <office DNS server>   <- VPN clients get no DNS without this');
    if (reach.length) L.push('        set ipv4-split-include "SP_VPN_SPLIT"');
    L.push('        set add-route enable', '        set psksecret PSK_CHANGE_ME', '    next', 'end',
      '', '# Phase 2', 'config vpn ipsec phase2-interface', '    edit "SP_VPN"', '        set phase1name "SP_VPN"', '        set proposal aes256-sha256', '    next', 'end');
    if (reach.length) {
      L.push('', '# Policy: only the RemoteStaff group, only the ticked networks, narrow services (trim SMB/HTTPS/RDP to what staff use), NAT off, log all sessions.', 'config firewall policy');
      reach.forEach((a, k) => L.push('    edit ' + (VPNPOL_ID0 + 1 + k), `        set name ${q(('RemoteStaff-to-' + fname(a.name)).slice(0, 35))}`, '        set srcintf "SP_VPN"', `        set dstintf ${q(names[idx(a)])}`,
        '        set action accept', '        set srcaddr "SP_VPN_POOL"', '        set groups "RemoteStaff"', `        set dstaddr ${q(objOf(a))}`, '        set schedule "always"', '        set service "SMB" "HTTPS" "RDP"', '        set nat disable', '        set logtraffic all',
        `        set comments ${q('SubnetPal remote access')}`, '    next'));
      L.push('end');
    }
    L.push('', '# ' + FORTI_NOTE);
    return L.join('\n') + '\n';
  }

  // ---------- Client handover document ----------
  function docModel(result, project) {
    const it = project.intake || {}, c = it.counts || {}, req = it.req || {};
    const growth = project.opts && project.opts.growth !== undefined && project.opts.growth !== '' ? Number(project.opts.growth) : 25;
    const expKey = it.expansion || 'none';
    const counts = Object.keys(COUNT_LABEL).filter(k => Number(c[k]) > 0).map(k => `${c[k]} ${COUNT_LABEL[k]}`);
    const sep = Object.keys(REQ_LABEL).filter(k => req[k]).map(k => REQ_LABEL[k]);
    const existing = project.existing || [];
    const reqLines = [
      ['Client', project.name || ''], ['Site', project.site || '-'], ['Date', project.date || '-'],
      ['Address block', result.parent.cidr],
      ['IPv6 site prefix', result.v6 ? `${result.v6.cidr} (${result.v6.kind === 'ULA' ? 'ULA, private' : 'global'})` : 'Not planned'],
      ['Devices', counts.length ? counts.join(', ') : 'Not recorded'],
      ['Separation requested', sep.length ? sep.join(', ') : 'None'],
      ['Expected growth', `${EXP_LABEL[expKey] || EXP_LABEL.none} (${growth}% growth buffer)`],
      ['Existing ranges avoided', existing.length ? existing.join(', ') : 'None'],
    ];
    const prof = [];
    if (it.industry) prof.push(it.industry.charAt(0).toUpperCase() + it.industry.slice(1));
    if (it.serversWhere) prof.push(it.serversWhere === 'cloud' ? 'cloud-only applications' : 'on-site servers');
    if (it.wifi) prof.push(it.wifi === 'fortiap' ? 'FortiAP Wi-Fi' : 'third-party Wi-Fi');
    if (it.voip) prof.push(it.voip === 'hosted' ? 'hosted phones' : 'on-site phone system');
    if (it.dualWan) prof.push('dual WAN'); if (it.siteVpn) prof.push('site-to-site VPN');
    if (prof.length) reqLines.push(['Site profile', prof.join(', ')]);
    const why = result.allocations.map(a => ({ name: a.name, cidr: a.cidr, text: Access.why(a, it) }));
    const m = Access.matrix(result.allocations);
    const cell = v => (v === 'self' ? '-' : v ? 'Yes' : 'No');
    const matrix = { head: ['From \\ To', 'Internet'].concat(m.cols), rows: m.rows.map(r => [r.name, r.internet ? 'Yes' : 'No'].concat(r.cells.map(cell))) };
    const growthLines = [`Expected growth: ${EXP_LABEL[expKey] || EXP_LABEL.none}. Every network was sized with a ${growth}% buffer on top of the devices listed.`];
    result.allocations.filter(a => Access.hasPolicy(a)).forEach(a => {
      const spare = a.usableHosts - (a.gateway ? 1 : 0) - a.hosts;
      growthLines.push(`${a.name}: ${a.hosts} planned plus ${a.buffer} growth buffer; ${spare} spare host addresses in ${a.cidr}.`);
    });
    const s = result.summary;
    growthLines.push(`Unallocated space: ${s.free.toLocaleString('en-GB')} of ${s.parentSize.toLocaleString('en-GB')} addresses remain in ${result.parent.cidr}` +
      (s.largestFree ? `; the largest free block is ${s.largestFree.cidr}.` : '.'));
    if (s.reserved) growthLines.push(`${s.reserved.toLocaleString('en-GB')} addresses inside this block belong to existing ranges and were left untouched.`);
    if (result.v6) growthLines.push(`IPv6: each network has its own /64 from ${result.v6.cidr}, with the subnet number matching the VLAN. A /64 holds far more addresses than will ever be used, so IPv6 needs no growth buffer. Devices on client networks self-configure from router advertisements.`);
    result.gaps.forEach(g => growthLines.push(`Free: ${g.cidrs.map(x => x.cidr).join(', ')} (${g.size.toLocaleString('en-GB')} addresses)${g.between ? ' - a gap between allocations' : ''}.`));
    return {
      title: `Network addressing handover: ${project.name || 'Client'}`,
      reqLines, why, matrix,
      table: result.v6
        ? { head: HANDOVER_HEAD.concat(['IPv6 subnet', 'IPv6 gateway']), rows: handoverRows(result).map(r => handoverCells(r).concat([r.subnet6, r.gateway6])) }
        : { head: HANDOVER_HEAD, rows: handoverRows(result).map(handoverCells) },
      matrixNote: 'Based on the starter firewall policies. Guest and DMZ networks have no route to internal networks, and only the Management network can reach other internal networks to administer them. Final rules to be agreed with the client.',
      growthLines, wan: (it.wanNote || '').trim() || 'None provided.', routes: Routes.summary(result, project),
    };
  }

  function toHandoverDoc(result, project) {
    const d = docModel(result, project);
    const o = [`# ${d.title}`, '', '## 1. Requirements summary', ''];
    d.reqLines.forEach(([k, v]) => o.push(`- **${k}:** ${v}`));
    o.push('', '## 2. IP address table', '', mdTable(d.table.head, d.table.rows));
    o.push('## 3. Why each network exists', '');
    d.why.forEach(w => o.push(`- **${w.name}** (\`${w.cidr}\`): ${w.text}`));
    o.push('', '## 4. Who can talk to who', '', mdTable(d.matrix.head, d.matrix.rows), `_${d.matrixNote}_`, '');
    o.push('## 5. Growth notes', '');
    d.growthLines.forEach(l => o.push(`- ${l}`));
    o.push('', '## 6. WAN / VPN notes', '', d.wan.replace(/\r?\n/g, '  \n'), '');
    if (d.routes.length) { o.push('## 7. Static routes', ''); d.routes.forEach(l => o.push(`- ${l}`)); o.push(''); }
    return o.join('\n');
  }

  function htmlTable(head, rows, monoFrom) {
    return `<div class="tablewrap scroll"><table class="plain"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>` +
      rows.map(r => `<tr>${r.map((c, i) => `<td class="${monoFrom !== undefined && i >= monoFrom ? 'mono' : ''}">${esc(c === '' ? '-' : c)}</td>`).join('')}</tr>`).join('') + '</tbody></table></div>';
  }

  function toHandoverHTML(result, project) {
    const d = docModel(result, project);
    return `<article class="doc"><h1>${esc(d.title)}</h1>` +
      '<h2>1. Requirements summary</h2><dl class="req">' + d.reqLines.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('') + '</dl>' +
      '<h2>2. IP address table</h2>' + htmlTable(d.table.head, d.table.rows, 3) +
      '<h2>3. Why each network exists</h2><ul>' + d.why.map(w => `<li><b>${esc(w.name)}</b> (<span class="mono">${esc(w.cidr)}</span>): ${esc(w.text)}</li>`).join('') + '</ul>' +
      '<h2>4. Who can talk to who</h2>' + htmlTable(d.matrix.head, d.matrix.rows) + `<p class="hint">${esc(d.matrixNote)}</p>` +
      '<h2>5. Growth notes</h2><ul>' + d.growthLines.map(l => `<li>${esc(l)}</li>`).join('') + '</ul>' +
      `<h2>6. WAN / VPN notes</h2><p>${esc(d.wan).replace(/\r?\n/g, '<br>')}</p>` +
      (d.routes.length ? '<h2>7. Static routes</h2><ul>' + d.routes.map(l => `<li>${esc(l)}</li>`).join('') + '</ul>' : '') + '</article>';
  }

  // Paste-safe CLI: CRLF line ends and no leading indent (FortiOS ignores indentation), so a console or PuTTY gets one command per line.
  const cliForPaste = t => String(t == null ? '' : t).split(/\r\n|\r|\n/).map(l => l.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '')).join('\r\n').replace(/(\r\n)+$/, '') + '\r\n';
  // PowerShell that types the CLI into whatever window has focus (SendKeys), one line at a time. For consoles that turn a paste into one long line.
  const cliTyper = t => {
    const lines = cliForPaste(t).split('\r\n').filter(l => l && l.charAt(0) !== '#');
    return ['# SubnetPal: types the FortiOS CLI into the window you click. Run in PowerShell, then click the FortiGate CLI console within 8 seconds.',
      '# Do not touch the keyboard until it finishes. Closing PowerShell stops it.',
      'Add-Type -AssemblyName System.Windows.Forms', '$lines = @(']
      .concat(lines.map(l => "'" + l.replace(/'/g, "''") + "'"))
      .concat([')', 'Write-Host "Click the FortiGate CLI console now. Typing starts in 8 seconds..."', 'Start-Sleep -Seconds 8',
        'foreach ($l in $lines) {', "  $e = $l -replace '([+^%~(){}\\[\\]])', '{$1}'", "  [System.Windows.Forms.SendKeys]::SendWait($e + '{ENTER}')", '  Start-Sleep -Milliseconds 250', '}', 'Write-Host "Done."']).join('\r\n') + '\r\n';
  };
  return {
    cliForPaste, cliTyper, FORTI_NOTE, WAN_IF, FORTI_ROLE, fname, ifaceNames, portPlan, parentPort, portPool, isPlain, ifaceLines, dhcpLines, HANDOVER_HEAD, usable, rng, toCSV, toMarkdown, toText, toFortiOS, toPolicyFortiOS, toRemoteFortiOS, toRoutesFortiOS, routesNotes, toFortiOSRaw, toPolicyFortiOSRaw, toRemoteFortiOSRaw, fortiNotes, policyNotes, remoteNotes, cliOnly, notesOnly, dhcpId, POL_ID0, POL6_ID0, VPNPOL_ID0, dnsOf, okIp, handoverRows, handoverCells,
    docModel, toHandoverDoc, toHandoverMarkdown: toHandoverDoc, toHandoverHTML,
  };
}));
