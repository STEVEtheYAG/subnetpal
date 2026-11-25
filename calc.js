/* SubnetPal - subnet maths. No DOM code. Works in browsers (window.Calc) and Node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ROLES = ['LAN', 'Guest', 'DMZ', 'Mgmt', 'WAN', 'Transit', 'Loopback'];
  const DHCP_ROLES = ['', 'LAN', 'Guest']; // roles that get a DHCP range
  const DEFAULT_OPTS = { gwPos: 'first', dhcpOffset: 0, staticReserve: 10, growth: 25 };
  const MAX = 4294967296; // 2^32

  // ---------- address helpers ----------
  function ipToInt(str) {
    if (typeof str !== 'string') return null;
    const parts = str.trim().split('.');
    if (parts.length !== 4) return null;
    let n = 0;
    for (const p of parts) {
      if (!/^\d{1,3}$/.test(p)) return null;
      if (p.length > 1 && p[0] === '0') return null; // ambiguous octal-style
      const v = Number(p);
      if (v > 255) return null;
      n = n * 256 + v;
    }
    return n;
  }
  function intToIp(n) {
    return [Math.floor(n / 16777216) % 256, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }
  function prefixToMask(p) { return p === 0 ? 0 : (0xFFFFFFFF << (32 - p)) >>> 0; }
  function sizeOf(prefix) { return Math.pow(2, 32 - prefix); }

  function parseCidr(str) {
    if (typeof str !== 'string' || !str.trim()) return { error: 'Enter a CIDR block such as 10.20.0.0/16.' };
    const m = /^\s*([\d.]+)\s*\/\s*(\d{1,2})\s*$/.exec(str);
    if (!m) return { error: `"${str.trim()}" is not valid CIDR notation (expected a.b.c.d/nn).` };
    const ip = ipToInt(m[1]);
    if (ip === null) return { error: `"${m[1]}" is not a valid IPv4 address.` };
    const prefix = Number(m[2]);
    if (prefix > 32) return { error: `Prefix /${prefix} is out of range (0-32).` };
    const mask = prefixToMask(prefix);
    const network = (ip & mask) >>> 0;
    const size = sizeOf(prefix);
    return { ip, prefix, mask, network, size, start: network, end: network + size - 1, hostBits: network !== ip };
  }

  // Split an inclusive integer range into the minimal list of aligned CIDR blocks.
  function rangeToCidrs(start, end) {
    const out = [];
    while (start <= end) {
      let size = start === 0 ? MAX : ((start & -start) >>> 0);
      while (size > end - start + 1) size /= 2;
      const prefix = 32 - Math.log2(size);
      out.push({ network: start, prefix, size, cidr: intToIp(start) + '/' + prefix });
      start += size;
    }
    return out;
  }

  // items: [{start, end, label}] -> list of overlapping pairs [{a, b}]
  function findOverlaps(items) {
    const s = items.slice().sort((x, y) => x.start - y.start || x.end - y.end);
    const pairs = [];
    for (let i = 0; i < s.length; i++) {
      for (let j = i + 1; j < s.length && s[j].start <= s[i].end; j++) pairs.push({ a: s[i], b: s[j] });
    }
    return pairs;
  }

  // Free ranges inside parent given allocations [{start,end}] -> [{start,end,size,between,cidrs}]
  function computeGaps(parent, allocs) {
    const s = allocs.slice().sort((a, b) => a.start - b.start);
    const gaps = [];
    let cursor = parent.start;
    const push = (from, to, between) => {
      if (to >= from) gaps.push({ start: from, end: to, size: to - from + 1, between, cidrs: rangeToCidrs(from, to) });
    };
    for (const a of s) {
      if (a.start > cursor) push(cursor, a.start - 1, true);
      cursor = Math.max(cursor, a.end + 1);
    }
    push(cursor, parent.end, false);
    return gaps;
  }

  function largestFreeBlock(gaps) {
    let best = null;
    for (const g of gaps) for (const c of g.cidrs) if (!best || c.size > best.size) best = c;
    return best;
  }

  // ---------- validation ----------
  function normalizeOpts(o) {
    o = o || {};
    const num = (v, d) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? d : Number(v));
    return {
      gwPos: o.gwPos === 'last' ? 'last' : 'first',
      dhcpOffset: num(o.dhcpOffset, DEFAULT_OPTS.dhcpOffset),
      staticReserve: num(o.staticReserve, DEFAULT_OPTS.staticReserve),
      growth: num(o.growth, DEFAULT_OPTS.growth),
      style: o.style === 'vlan24' ? 'vlan24' : 'packed', // 'vlan24' = one /24 per VLAN, third octet = VLAN ID
    };
  }

  function validate(project) {
    const errors = [], warnings = [];
    const err = (msg, row, field) => errors.push({ msg, row: row === undefined ? -1 : row, field: field || '' });
    const warn = (msg) => warnings.push(msg);

    const p = parseCidr(project.parent);
    if (p.error) err('Parent block: ' + p.error, -1, 'parent');
    else {
      if (p.hostBits) err(`Parent block ${project.parent.trim()} has host bits set, so it is not on a network boundary. Use ${intToIp(p.network)}/${p.prefix}.`, -1, 'parent');
      if (p.prefix < 1) err('Parent block /0 is the whole internet. Use something like 10.0.0.0/8.', -1, 'parent');
      else if (p.prefix > 30) err(`Parent block /${p.prefix} is too small to subdivide. Use /30 or larger.`, -1, 'parent');
      const isPrivate = (p.network >>> 24 === 10) || ((p.network >>> 20) === 0xAC1) || ((p.network >>> 16) === 0xC0A8) || ((p.network >>> 16) === 0xA9FE) || ((p.network >>> 22) === 0x191);
      if (!p.hostBits && !isPrivate) warn(`Parent block ${intToIp(p.network)}/${p.prefix} is not private (RFC1918) address space. Fine if it is your public allocation.`);
    }

    const o = normalizeOpts(project.opts);
    const raw = project.opts || {};
    const intOk = (v) => Number.isInteger(v) && v >= 0;
    if (!intOk(o.dhcpOffset)) err('DHCP start offset must be a whole number, 0 or more.', -1, 'dhcpOffset');
    if (!intOk(o.staticReserve)) err('Static reserve must be a whole number, 0 or more.', -1, 'staticReserve');
    if (!(o.growth >= 0 && o.growth <= 500)) err('Growth buffer must be between 0 and 500 %.', -1, 'growth');
    if (raw.gwPos && raw.gwPos !== 'first' && raw.gwPos !== 'last') err('Gateway position must be first or last.', -1, 'gwPos');

    const existing = [];
    (project.existing || []).forEach(s => {
      const e = parseCidr(s);
      if (e.error) err(`Existing range "${s}": ${e.error}`, -1, 'existing');
      else if (e.hostBits) err(`Existing range ${s} has host bits set. Use ${intToIp(e.network)}/${e.prefix}.`, -1, 'existing');
      else existing.push({ start: e.start, end: e.end, size: e.size, cidr: intToIp(e.network) + '/' + e.prefix, label: intToIp(e.network) + '/' + e.prefix });
    });
    findOverlaps(existing).forEach(o => warn(`Existing ranges ${o.a.cidr} and ${o.b.cidr} overlap each other.`));

    const nets = project.networks || [];
    if (!nets.length) err('Add at least one network.', -1, 'networks');
    const seen = new Map();
    nets.forEach((n, i) => {
      const name = String(n.name == null ? '' : n.name).trim();
      const label = name || `Row ${i + 1}`;
      if (!name) err(`Row ${i + 1}: name is required.`, i, 'name');
      else {
        const k = name.toLowerCase();
        if (seen.has(k)) err(`Row ${i + 1}: duplicate name "${name}" (also row ${seen.get(k) + 1}).`, i, 'name');
        else seen.set(k, i);
      }
      const hs = String(n.hosts == null ? '' : n.hosts).trim();
      const hosts = Number(hs);
      if (hs === '' || !Number.isInteger(hosts) || hosts < 1) err(`${label}: hosts must be a whole number of at least 1 (got "${hs}").`, i, 'hosts');
      else if (hosts > 2147483000) err(`${label}: hosts value is unrealistically large.`, i, 'hosts');
      const vs = String(n.vlan == null ? '' : n.vlan).trim();
      if (vs !== '') {
        const v = Number(vs);
        if (!Number.isInteger(v) || v < 1 || v > 4094) err(`${label}: VLAN ID must be 1-4094 (got "${vs}").`, i, 'vlan');
      }
      const role = n.role || '';
      if (role && ROLES.indexOf(role) < 0) err(`${label}: unknown role "${role}".`, i, 'role');
      if (role === 'Loopback' && Number.isInteger(hosts) && hosts > 1) err(`${label}: a Loopback is a single /32 address; hosts must be 1.`, i, 'hosts');
      if (role === 'Transit' && Number.isInteger(hosts) && hosts > 2) warn(`${label}: Transit with more than 2 hosts is sized as a normal subnet instead of a /31.`);
    });
    const vlans = {};
    nets.forEach((n, i) => {
      const vs = String(n.vlan == null ? '' : n.vlan).trim();
      if (vs !== '') (vlans[vs] = vlans[vs] || []).push(i + 1);
    });
    Object.keys(vlans).forEach(v => { if (vlans[v].length > 1) warn(`VLAN ${v} is used on rows ${vlans[v].join(', ')}.`); });
    return { errors, warnings, existing };
  }

  function mergeRanges(list) {
    const s = list.map(r => ({ start: r.start, end: r.end })).sort((a, b) => a.start - b.start);
    const out = [];
    for (const r of s) {
      const last = out[out.length - 1];
      if (last && r.start <= last.end + 1) last.end = Math.max(last.end, r.end); else out.push(r);
    }
    return out;
  }

  // ---------- sizing ----------
  function sizeNetwork(net, opts) {
    const role = net.role || '';
    const hosts = Number(net.hosts);
    if (role === 'Loopback') return { prefix: 32, needed: 1, buffer: 0 };
    if (role === 'Transit' && hosts <= 2) return { prefix: 31, needed: 2, buffer: 0 };
    const buffer = Math.ceil(hosts * opts.growth / 100);
    const needed = hosts + buffer + 3; // + network + broadcast + gateway
    let size = 4;
    while (size < needed) size *= 2;
    return { prefix: 32 - Math.log2(size), needed, buffer };
  }

  function describe(net, start, prefix, sizing, opts) {
    const role = net.role || '';
    const size = sizeOf(prefix);
    const end = start + size - 1;
    const mask = prefixToMask(prefix);
    const vs = String(net.vlan == null ? '' : net.vlan).trim();
    const d = {
      name: String(net.name).trim(), vlan: vs === '' ? '' : Number(vs), role, kind: net.kind || '',
      hosts: Number(net.hosts), buffer: sizing.buffer, needed: sizing.needed,
      prefix, size, start, end,
      cidr: intToIp(start) + '/' + prefix,
      network: intToIp(start), netmask: intToIp(mask), wildcard: intToIp((~mask) >>> 0),
      gateway: '', firstUsable: '', lastUsable: '', broadcast: '',
      totalAddresses: size, usableHosts: 0,
      staticStart: '', staticEnd: '', dhcpStart: '', dhcpEnd: '',
      warnings: [],
    };
    if (prefix === 32) {
      d.usableHosts = 1; d.firstUsable = d.lastUsable = d.network;
      return d;
    }
    if (prefix === 31) {
      d.usableHosts = 2; d.firstUsable = intToIp(start); d.lastUsable = intToIp(start + 1);
      return d;
    }
    const first = start + 1, last = end - 1;
    d.usableHosts = size - 2;
    d.firstUsable = intToIp(first); d.lastUsable = intToIp(last); d.broadcast = intToIp(end);
    const gwFirst = opts.gwPos !== 'last';
    d.gateway = intToIp(gwFirst ? first : last);
    const hostStart = gwFirst ? first + 1 : first;
    const hostEnd = gwFirst ? last : last - 1;
    let dhcpFrom = hostStart;
    if (opts.staticReserve > 0) {
      const sEnd = Math.min(hostStart + opts.staticReserve - 1, hostEnd);
      if (sEnd - hostStart + 1 < opts.staticReserve) d.warnings.push(`Static reserve reduced to ${sEnd - hostStart + 1} (network too small).`);
      if (sEnd >= hostStart) { d.staticStart = intToIp(hostStart); d.staticEnd = intToIp(sEnd); }
      dhcpFrom = sEnd + 1;
    }
    if (net.dhcp !== false && DHCP_ROLES.indexOf(role) >= 0) {
      const dStart = dhcpFrom + opts.dhcpOffset;
      if (dStart <= hostEnd) { d.dhcpStart = intToIp(dStart); d.dhcpEnd = intToIp(hostEnd); }
      else d.warnings.push('No room left for a DHCP range after the static reserve and offset.');
    }
    return d;
  }

  // ---------- main entry ----------
  // project: { parent, networks:[{name,hosts,vlan,role}], opts:{gwPos,dhcpOffset,staticReserve,growth} }
  function plan(project) {
    const v = validate(project);
    const result = { ok: false, errors: v.errors, warnings: v.warnings.slice(), conflicts: [], parent: null, allocations: [], gaps: [], unplaced: [], summary: null };
    if (v.errors.length) return result;

    const opts = normalizeOpts(project.opts);
    const p = parseCidr(project.parent);
    result.parent = { cidr: intToIp(p.network) + '/' + p.prefix, network: intToIp(p.network), prefix: p.prefix, size: p.size, start: p.start, end: p.end };

    const items = project.networks.map((n, i) => ({ n, i, sizing: sizeNetwork(n, opts) }));
    items.forEach(it => { it.size = sizeOf(it.sizing.prefix); });
    const order = items.slice().sort((a, b) => b.size - a.size || a.i - b.i); // largest first

    // Existing ranges that touch the parent are reserved: networks are placed around them.
    const touching = v.existing.filter(e => e.start <= p.end && e.end >= p.start);
    result.conflicts = touching.map(e => `Parent block ${result.parent.cidr} overlaps existing range ${e.cidr} already in use. Those addresses are skipped; consider a different parent block.`);
    const reservedRanges = mergeRanges(touching.map(e => ({ start: Math.max(e.start, p.start), end: Math.min(e.end, p.end) })));
    const occupied = reservedRanges.map(r => ({ start: r.start, end: r.end, label: 'existing range' }));
    const reserved = reservedRanges.reduce((s, r) => s + (r.end - r.start + 1), 0);

    const findSpot = size => {
      let pos = p.start;
      while (pos + size - 1 <= p.end) {
        const hit = occupied.find(o => o.start <= pos + size - 1 && o.end >= pos);
        if (!hit) return pos;
        pos = p.start + Math.ceil((hit.end + 1 - p.start) / size) * size;
      }
      return -1;
    };

    // One /24 per VLAN: network = parent base + VLAN ID x 256. Transit and Loopback share the third-octet-0 block.
    // Returns { spots } or { why } when it cannot be done (the caller then falls back to packed VLSM).
    const layoutVlan24 = () => {
      if (p.size < 65536) return { why: `the parent block ${result.parent.cidr} is smaller than a /16, so there is no room for a /24 per VLAN.` };
      const spots = [], seen = new Set(), infra = [];
      for (const it of items) {
        const name = String(it.n.name).trim();
        if ((it.n.role || '') === 'Loopback' || it.sizing.prefix >= 31) { infra.push(it); continue; }
        const raw = String(it.n.vlan == null ? '' : it.n.vlan).trim(), v = Number(raw);
        if (raw === '' || !Number.isInteger(v) || v < 1 || v > 255) return { why: `${name} has no VLAN ID between 1 and 255.` };
        if (it.sizing.prefix < 24) return { why: `${name} needs more than a /24 (${it.n.hosts} hosts plus growth).` };
        if (seen.has(v)) return { why: `VLAN ${v} is used by more than one network.` };
        seen.add(v);
        const at = p.start + v * 256;
        if (at + 255 > p.end) return { why: `VLAN ${v} does not fit inside ${result.parent.cidr}.` };
        if (occupied.some(o => o.start <= at + 255 && o.end >= at)) return { why: `the /24 for VLAN ${v} (${intToIp(at)}) overlaps an existing range.` };
        spots.push({ it, at, prefix: 24 });
      }
      infra.sort((a, b) => b.size - a.size || a.i - b.i);
      for (const it of infra) {
        let pos = p.start + (it.size === 1 ? 1 : 0), found = -1;   // a /32 never takes the .0.0 address (looks like a network address)
        while (pos + it.size - 1 <= p.start + 255) {
          const end = pos + it.size - 1;
          if (!occupied.some(o => o.start <= end && o.end >= pos) && !spots.some(s => s.infra && s.at <= end && s.at + sizeOf(s.prefix) - 1 >= pos)) { found = pos; break; }
          pos += it.size;
        }
        if (found < 0) return { why: `there is no free space for ${String(it.n.name).trim()} in the ${intToIp(p.start)} block.` };
        spots.push({ it, at: found, prefix: it.sizing.prefix, infra: true });
      }
      return { spots };
    };

    let placed = [];
    let unplaced = [];
    result.style = 'packed';
    if (opts.style === 'vlan24') {
      const v24 = layoutVlan24();
      if (v24.why) result.styleNote = `Packed addressing is being used instead of one /24 per VLAN, because ${v24.why}`;
      else {
        result.style = 'vlan24';
        v24.spots.forEach(s => {
          placed.push(describe(s.it.n, s.at, s.prefix, s.it.sizing, opts));
          occupied.push({ start: s.at, end: s.at + sizeOf(s.prefix) - 1, label: String(s.it.n.name).trim() });
        });
      }
    }
    if (result.style === 'packed') {
      for (const it of order) {
        const at = findSpot(it.size);
        if (at < 0) { unplaced.push(it); continue; }
        placed.push(describe(it.n, at, it.sizing.prefix, it.sizing, opts));
        occupied.push({ start: at, end: at + it.size - 1, label: String(it.n.name).trim() });
      }
    }
    placed.sort((a, b) => a.start - b.start);
    result.allocations = placed;
    result.unplaced = unplaced.map(it => ({ name: String(it.n.name).trim(), prefix: it.sizing.prefix, size: it.size }));
    placed.forEach(a => a.warnings.forEach(w => result.warnings.push(`${a.name}: ${w}`)));

    // Safety net: allocations must never overlap.
    const ov = findOverlaps(placed.map(a => ({ start: a.start, end: a.end, label: a.name }))
      .concat(reservedRanges.map(r => ({ start: r.start, end: r.end, label: 'an existing range' }))));
    if (ov.length) {
      result.errors.push({ msg: `Internal error: ${ov[0].a.label} overlaps ${ov[0].b.label}.`, row: -1, field: '' });
      return result;
    }

    result.gaps = computeGaps(p, placed.concat(reservedRanges));
    const used = placed.reduce((s, a) => s + a.size, 0);
    const largest = largestFreeBlock(result.gaps);
    result.summary = {
      parentSize: p.size, used, reserved, free: p.size - used - reserved,
      percentUsed: Math.round(used / p.size * 1000) / 10,
      largestFree: largest ? { cidr: largest.cidr, size: largest.size } : null,
    };

    if (unplaced.length) {
      const needTotal = items.reduce((s, it) => s + it.size, 0);
      const list = unplaced.map(it => `${String(it.n.name).trim()} (/${it.sizing.prefix}, ${it.size} addresses)`).join(', ');
      result.errors.push({
        msg: `Does not fit in ${result.parent.cidr}: ${list}. All networks need ${needTotal} addresses; the parent block has ${p.size - reserved} free${reserved ? ` (${reserved} already used by existing ranges)` : ''}. Largest free block left: ${largest ? largest.cidr : 'none'}. Use a bigger parent block or reduce hosts/growth buffer.`,
        row: -1, field: 'networks',
      });
      return result;
    }
    result.ok = true;
    return result;
  }

  return {
    ROLES, DHCP_ROLES, DEFAULT_OPTS,
    ipToInt, intToIp, prefixToMask, parseCidr, rangeToCidrs, findOverlaps, computeGaps, largestFreeBlock,
    normalizeOpts, validate, sizeNetwork, mergeRanges, plan,
  };
}));
