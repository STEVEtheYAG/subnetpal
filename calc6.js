/* SubnetPal - IPv6 layer. Pure, no DOM. window.Calc6 / Node.
   IPv4 stays the source of truth. IPv6 adds one /64 per network, carved from a /48../56 site prefix. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc6 = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX = (1n << 128n) - 1n;
  const TRANSIT_SUBNET = 0xfe, LOOPBACK_SUBNET = 0xff;

  // "2001:db8::1" -> BigInt, or null
  function parseIp6(s) {
    s = String(s || '').trim().toLowerCase();
    if (!s || /[^0-9a-f:.]/.test(s) || s.indexOf(':::') >= 0) return null;
    const dbl = s.split('::');
    if (dbl.length > 2) return null;
    const grp = part => (part === '' ? [] : part.split(':'));
    const head = grp(dbl[0]), tail = dbl.length === 2 ? grp(dbl[1]) : [];
    if (dbl.length === 1 && head.length !== 8) return null;
    if (dbl.length === 2 && head.length + tail.length > 7) return null;
    const fill = dbl.length === 2 ? 8 - head.length - tail.length : 0;
    const all = head.concat(new Array(fill).fill('0'), tail);
    let v = 0n;
    for (const g of all) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      v = (v << 16n) | BigInt(parseInt(g, 16));
    }
    return v;
  }

  // BigInt -> compressed text (RFC 5952: longest run of 2+ zero groups becomes ::)
  function formatIp6(v) {
    const g = [];
    for (let i = 7; i >= 0; i--) g.push(Number((v >> BigInt(i * 16)) & 0xffffn));
    let bs = -1, bl = 0;
    for (let i = 0; i < 8;) {
      if (g[i] !== 0) { i++; continue; }
      let j = i; while (j < 8 && g[j] === 0) j++;
      if (j - i > bl) { bs = i; bl = j - i; }
      i = j;
    }
    const hex = x => x.toString(16);
    if (bl < 2) return g.map(hex).join(':');
    return g.slice(0, bs).map(hex).join(':') + '::' + g.slice(bs + bl).map(hex).join(':');
  }

  // "fd12:3456:789a::/48" -> { prefix, network (BigInt), cidr } or { error }
  function parsePrefix6(text) {
    const m = String(text || '').trim().match(/^([^/]+)\/(\d{1,3})$/);
    if (!m) return { error: 'Enter an IPv6 prefix like fd12:3456:789a::/48.' };
    const ip = parseIp6(m[1]), prefix = Number(m[2]);
    if (ip === null) return { error: `"${m[1]}" is not a valid IPv6 address.` };
    if (prefix < 16 || prefix > 128) return { error: 'IPv6 prefix length must be between 16 and 128.' };
    const hostMask = (1n << BigInt(128 - prefix)) - 1n;
    const network = ip & ~hostMask & MAX;
    return { prefix, network, hostMask, cidr: formatIp6(network) + '/' + prefix };
  }

  // Random ULA /48 (RFC 4193): fd + 40 random bits. rand() returns 0..1, injectable for tests.
  function generateUla(rand) {
    rand = rand || Math.random;
    let g = 0n;
    for (let i = 0; i < 5; i++) g = (g << 8n) | BigInt(Math.floor(rand() * 256));
    const net = (0xfdn << 120n) | (g << 80n);
    return formatIp6(net) + '/48';
  }

  // Check a site prefix. Needs room for subnet ids up to 0xff, so /56 or shorter, and at most /64.
  function validatePrefix(text) {
    const p = parsePrefix6(text);
    if (p.error) return p;
    if (p.prefix > 56) return { error: 'Use a /56 or shorter site prefix (a /48 is typical). A /64 per network needs room for the subnet ids.' };
    if (p.prefix < 16) return { error: 'IPv6 prefix too short.' };
    return p;
  }

  // Subnet id (0..255) for an allocation: its VLAN id read as hex digits when 99 or less (VLAN 20 -> :20::), else the first free id. Transit and Loopback get fixed ids.
  function annotate(result, v6) {
    const out = [];
    if (!result || !result.allocations) return out;
    result.allocations.forEach(a => { delete a.v6; });
    result.v6 = null; delete result.v6Error;
    if (!v6 || !v6.enabled) return out;
    const sp = validatePrefix(v6.prefix);
    if (sp.error) { result.v6Error = sp.error; out.push(sp.error); return out; }
    result.v6 = { cidr: sp.cidr, prefix: sp.prefix, network: formatIp6(sp.network), kind: ulaOrGua(sp.network) };
    const used = new Set();
    const ids = new Map();
    const take = (a, id) => { ids.set(a, id); used.add(id); };
    result.allocations.forEach(a => {
      if (a.role === 'Loopback') take(a, LOOPBACK_SUBNET);
      else if (a.role === 'Transit') take(a, TRANSIT_SUBNET);
    });
    result.allocations.forEach(a => {
      if (ids.has(a)) return;
      const v = a.vlan;
      if (v !== '' && Number.isInteger(v) && v >= 1 && v <= 253) { const id = v <= 99 ? parseInt(String(v), 16) : v; if (!used.has(id)) take(a, id); }
    });
    result.allocations.forEach(a => {
      if (ids.has(a)) return;
      let id = 1; while (used.has(id)) id++;
      take(a, id);
      out.push(`${a.name}: no free VLAN-based subnet id, so IPv6 subnet ${id.toString(16)} was used.`);
    });
    result.allocations.forEach(a => {
      const id = ids.get(a);
      const base = sp.network | (BigInt(id) << 64n);
      const hex = id.toString(16);
      if (a.role === 'Loopback') a.v6 = { cidr: formatIp6(base | 1n) + '/128', network: formatIp6(base | 1n), prefix: 128, address: formatIp6(base | 1n), subnetId: hex };
      else if (a.role === 'Transit') a.v6 = { cidr: formatIp6(base) + '/127', network: formatIp6(base), prefix: 127, address: formatIp6(base | 1n), subnetId: hex };
      else a.v6 = { cidr: formatIp6(base) + '/64', network: formatIp6(base), prefix: 64, address: formatIp6(base | 1n), subnetId: hex };
    });
    return out;
  }

  function ulaOrGua(net) { return (net >> 121n) === 0x7en ? 'ULA' : 'GUA'; }

  return { parseIp6, formatIp6, parsePrefix6, validatePrefix, generateUla, annotate };
}));
