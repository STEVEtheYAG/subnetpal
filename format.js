/* SubnetPal - text exporters. Pure functions, no DOM. Works in browsers (window.Fmt) and Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Fmt = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FORTI_NOTE = 'Verify against the FortiOS 8.0 documentation before applying. Review every line; this is a planning aid, not a tested config.';
  const ALLOWACCESS = { LAN: 'ping https ssh', Mgmt: 'ping https ssh', Guest: 'ping', DMZ: 'ping', WAN: 'ping', Transit: 'ping', '': 'ping https ssh' };
  const FORTI_ROLE = { LAN: 'lan', Guest: 'lan', Mgmt: 'lan', DMZ: 'dmz', WAN: 'wan', Transit: 'undefined', Loopback: 'undefined', '': 'lan' };

  const rng = (a, b) => (a && b ? `${a} - ${b}` : '');
  const usable = a => (a.prefix >= 31 ? (a.prefix === 32 ? a.firstUsable : `${a.firstUsable} - ${a.lastUsable}`) : rng(a.firstUsable, a.lastUsable));
  const csvCell = v => { const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const mdCell = v => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

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

  function toHandoverMarkdown(result, project) {
    const t = project && project.name ? `## Network addressing: ${project.name}\n\nAddress block: \`${result.parent.cidr}\`\n\n` : '';
    return t + mdTable(HANDOVER_HEAD, handoverRows(result).map(handoverCells));
  }

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

  const q = s => '"' + String(s).replace(/"/g, '') + '"';
  const sanitizeIf = s => String(s).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 15);

  // ifName: the single interface-name placeholder the user edits.
  function toFortiOS(result, project, ifName) {
    const ph = (ifName && String(ifName).trim()) || 'PORT_CHANGE_ME';
    const L = [];
    L.push('# ===== SubnetPal FortiOS snippet =====');
    L.push('# NOTE: ' + FORTI_NOTE);
    L.push(`# >>> INTERFACE NAME PLACEHOLDER: "${ph}"  <<<  Replace every occurrence with your real port/aggregate/zone-member name.`);
    L.push('# VLAN sub-interfaces use the placeholder as their parent port. Non-VLAN networks use it as the interface name itself.');
    L.push('');
    const info = [];
    let plain = 0;
    const plainCount = result.allocations.filter(a => a.vlan === '' && a.role !== 'Loopback').length;
    result.allocations.forEach(a => {
      let name;
      if (a.role === 'Loopback') name = sanitizeIf('lo_' + a.name);
      else if (a.vlan !== '') name = sanitizeIf('vlan' + a.vlan);
      else name = plainCount > 1 ? sanitizeIf(ph + (++plain)) : sanitizeIf(ph);
      info.push({ a, name });
    });
    L.push('config system interface');
    info.forEach(({ a, name }) => {
      const ipLine = a.gateway ? a.gateway : a.firstUsable;
      L.push(`    edit ${q(name)}`);
      L.push('        set vdom "root"');
      L.push(`        set ip ${ipLine} ${a.netmask}`);
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
      L.push('');
      L.push('config system dhcp-server');
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
    L.push('');
    L.push('# ' + FORTI_NOTE);
    return L.join('\n') + '\n';
  }

  return { FORTI_NOTE, HANDOVER_HEAD, usable, rng, toCSV, toMarkdown, toText, toFortiOS, handoverRows, handoverCells, toHandoverMarkdown };
}));
