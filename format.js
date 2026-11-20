/* SubnetPal - exporters (CSV, Markdown, text, FortiOS, client handover doc). Pure, no DOM. window.Fmt / Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./access.js'));
  else root.Fmt = factory(root.Access);
}(typeof self !== 'undefined' ? self : this, function (Access) {
  'use strict';

  const FORTI_NOTE = 'Generated, untested. Verify against FortiOS 8.0 docs and the lab VM before applying. Starter policies are not production rules.';
  const WAN_IF = 'wan1';
  const ALLOWACCESS = { LAN: 'ping https ssh', Mgmt: 'ping https ssh', Guest: 'ping', DMZ: 'ping', WAN: 'ping', Transit: 'ping', '': 'ping https ssh' };
  const FORTI_ROLE = { LAN: 'lan', Guest: 'lan', Mgmt: 'lan', DMZ: 'dmz', WAN: 'wan', Transit: 'undefined', Loopback: 'undefined', '': 'lan' };
  const EXP_LABEL = { none: 'None', soon: 'Soon', big: 'Big growth' };
  const COUNT_LABEL = { staff: 'staff', wired: 'wired devices', wifi: 'Wi-Fi devices', voice: 'phones', cameras: 'cameras', iot: 'IoT devices', servers: 'servers', guest: 'guest users', dmz: 'public servers (DMZ)' };
  const REQ_LABEL = { guest: 'Guest Wi-Fi separation', dmz: 'DMZ / public servers', voice: 'Voice VLAN', cameras: 'Cameras VLAN', iot: 'IoT VLAN' };

  const rng = (a, b) => (a && b ? `${a} - ${b}` : '');
  const usable = a => (a.prefix === 32 ? a.firstUsable : rng(a.firstUsable, a.lastUsable));
  const csvCell = v => { const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const mdCell = v => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- CSV / Markdown / text ----------
  function toCSV(result) {
    const head = ['Name', 'VLAN', 'Role', 'CIDR', 'Netmask', 'Wildcard', 'Network', 'Gateway', 'First usable', 'Last usable', 'Broadcast', 'Total addresses', 'Usable hosts', 'Static range', 'DHCP range'];
    const lines = [head.map(csvCell).join(',')];
    result.allocations.forEach(a => lines.push([
      a.name, a.vlan, a.role, a.cidr, a.netmask, a.wildcard, a.network, a.gateway, a.firstUsable, a.lastUsable, a.broadcast,
      a.totalAddresses, a.usableHosts, rng(a.staticStart, a.staticEnd), rng(a.dhcpStart, a.dhcpEnd),
    ].map(csvCell).join(',')));
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
    }));
  }
  const HANDOVER_HEAD = ['Network', 'VLAN', 'Role', 'Subnet', 'Subnet mask', 'Default gateway', 'Usable range', 'Static range', 'DHCP range'];
  const handoverCells = r => [r.name, r.vlan, r.role, r.subnet, r.mask, r.gateway, r.usable, r.static, r.dhcp];

  function toText(result, project) {
    const out = [];
    if (project && project.name) out.push(`IP plan: ${project.name}`);
    out.push(`Parent block: ${result.parent.cidr}`, '');
    result.allocations.forEach(a => {
      out.push(`${a.name}${a.vlan !== '' ? ` (VLAN ${a.vlan})` : ''}${a.role ? ` [${a.role}]` : ''}`);
      out.push(`  Network:   ${a.cidr}  (mask ${a.netmask}, wildcard ${a.wildcard})`);
      if (a.gateway) out.push(`  Gateway:   ${a.gateway}`);
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

  function ifaceNames(allocs, ph) {
    let plain = 0;
    const plainCount = allocs.filter(a => a.vlan === '' && a.role !== 'Loopback').length;
    return allocs.map(a => {
      if (a.role === 'Loopback') return sanitizeIf('lo_' + a.name);
      if (a.vlan !== '') return sanitizeIf('vlan' + a.vlan);
      return plainCount > 1 ? sanitizeIf(ph + (++plain)) : sanitizeIf(ph);
    });
  }

  // ifName: the single interface-name placeholder the user edits.
  function toFortiOS(result, project, ifName) {
    const ph = (ifName && String(ifName).trim()) || 'PORT_CHANGE_ME';
    const allocs = result.allocations;
    const names = ifaceNames(allocs, ph);
    const info = allocs.map((a, i) => ({ a, name: names[i] }));
    const byAlloc = new Map(info.map(x => [x.a, x]));
    const L = [];
    L.push('# ===== SubnetPal FortiOS snippet =====');
    L.push('# ' + FORTI_NOTE);
    L.push(`# >>> INTERFACE NAME PLACEHOLDER: "${ph}"  <<<  Replace every occurrence with your real port/aggregate name.`);
    L.push('# VLAN sub-interfaces use the placeholder as their parent port. Non-VLAN networks use it as the interface name itself.');
    L.push(`# Policies assume the internet-facing interface is "${WAN_IF}". Change it if yours differs.`);
    L.push('');
    L.push('config system interface');
    info.forEach(({ a, name }) => {
      L.push(`    edit ${q(name)}`);
      L.push('        set vdom "root"');
      L.push(`        set ip ${a.gateway ? a.gateway : a.firstUsable} ${a.netmask}`);
      L.push(`        set allowaccess ${ALLOWACCESS[a.role] || 'ping'}`);
      if (a.role === 'Loopback') L.push('        set type loopback');
      else if (a.vlan !== '') { L.push(`        set interface ${q(ph)}`); L.push(`        set vlanid ${a.vlan}`); }
      L.push(`        set role ${FORTI_ROLE[a.role] || 'lan'}`);
      L.push(`        set alias ${q(a.name)}`);
      L.push('    next');
    });
    L.push('end');

    const dhcp = info.filter(({ a }) => a.dhcpStart);
    if (dhcp.length) {
      L.push('', 'config system dhcp-server');
      dhcp.forEach(({ a, name }, i) => {
        L.push(`    edit ${i + 1}`);
        L.push('        set dns-service default');
        L.push(`        set default-gateway ${a.gateway}`);
        L.push(`        set netmask ${a.netmask}`);
        L.push(`        set interface ${q(name)}`);
        L.push('        config ip-range');
        L.push('            edit 1');
        L.push(`                set start-ip ${a.dhcpStart}`);
        L.push(`                set end-ip ${a.dhcpEnd}`);
        L.push('            next');
        L.push('        end');
        L.push('    next');
      });
      L.push('end');
    }

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

    const pols = Access.policies(allocs);
    const internal = info.filter(x => Access.isInternal(x.a));
    if (pols.some(p => p.to === 'internal') && internal.length) {
      L.push('', 'config firewall addrgrp', '    edit "SP_INTERNAL"');
      L.push('        set member ' + internal.map(x => q(x.obj)).join(' '));
      L.push('    next', 'end');
    }
    if (pols.length) {
      L.push('', '# STARTER policies: review, tighten services, add logging/UTM profiles before any real use.');
      L.push('config firewall policy');
      pols.forEach(p => {
        const f = byAlloc.get(p.from);
        const t = p.to === 'internet' || p.to === 'internal' ? null : byAlloc.get(p.to);
        const pname = ('SP_' + fname(p.name.replace('(block)', 'block'))).slice(0, 35);
        L.push('    edit 0');
        L.push(`        set name ${q(pname)}`);
        L.push(`        set srcintf ${q(f.name)}`);
        L.push(`        set dstintf ${q(p.to === 'internet' ? WAN_IF : p.to === 'internal' ? 'any' : t.name)}`);
        L.push(`        set action ${p.action}`);
        L.push(`        set srcaddr ${q(f.obj)}`);
        L.push(`        set dstaddr ${q(p.to === 'internet' ? 'all' : p.to === 'internal' ? 'SP_INTERNAL' : t.obj)}`);
        L.push('        set schedule "always"');
        L.push(`        set service ${p.services.map(q).join(' ')}`);
        if (p.to === 'internet' && p.action === 'accept') L.push('        set nat enable');
        L.push('        set logtraffic all');
        L.push(`        set comments ${q('SubnetPal starter policy')}`);
        L.push('    next');
      });
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
      ['Devices', counts.length ? counts.join(', ') : 'Not recorded'],
      ['Separation requested', sep.length ? sep.join(', ') : 'None'],
      ['Expected growth', `${EXP_LABEL[expKey] || EXP_LABEL.none} (${growth}% growth buffer)`],
      ['Existing ranges avoided', existing.length ? existing.join(', ') : 'None'],
    ];
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
    result.gaps.forEach(g => growthLines.push(`Free: ${g.cidrs.map(x => x.cidr).join(', ')} (${g.size.toLocaleString('en-GB')} addresses)${g.between ? ' - a gap between allocations' : ''}.`));
    return {
      title: `Network addressing handover: ${project.name || 'Client'}`,
      reqLines, table: { head: HANDOVER_HEAD, rows: handoverRows(result).map(handoverCells) }, why, matrix,
      matrixNote: 'Based on the starter firewall policies. Guest and DMZ networks have no route to internal networks, and only the Management network can reach other internal networks to administer them. Final rules to be agreed with the client.',
      growthLines, wan: (it.wanNote || '').trim() || 'None provided.',
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
      `<h2>6. WAN / VPN notes</h2><p>${esc(d.wan).replace(/\r?\n/g, '<br>')}</p></article>`;
  }

  return {
    FORTI_NOTE, HANDOVER_HEAD, usable, rng, toCSV, toMarkdown, toText, toFortiOS, handoverRows, handoverCells,
    docModel, toHandoverDoc, toHandoverMarkdown: toHandoverDoc, toHandoverHTML,
  };
}));
