/* SubnetPal - remote access: home-range avoidance, VPN address pool, split-tunnel choice. Pure, no DOM. window.Remote / Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'), require('./access.js'));
  else root.Remote = factory(root.Calc, root.Access);
}(typeof self !== 'undefined' ? self : this, function (Calc, Access) {
  'use strict';

  // Ranges that are very common on home routers. An office network inside one of these clashes with a remote worker's home LAN.
  const HOME_RANGES = ['192.168.0.0/24', '192.168.1.0/24', '192.168.2.0/24', '192.168.10.0/24', '192.168.100.0/24', '10.0.0.0/24', '10.0.1.0/24', '10.1.1.0/24', '172.16.0.0/24'];
  const homeParsed = () => HOME_RANGES.map(c => Object.assign({ cidr: c }, Calc.parseCidr(c)));
  const n0 = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };

  // Candidate private /16 blocks in preference order (the intake's auto-pick uses this too).
  function pickSixteen(avoid) {
    const ex = (avoid || []).filter(e => e && !e.error);
    const clash = (start, size) => ex.some(e => e.start <= start + size - 1 && e.end >= start);
    const cands = [];
    for (let x = 20; x <= 255; x++) cands.push([10, x]);
    for (let x = 2; x < 20; x++) cands.push([10, x]);
    cands.push([10, 0], [10, 1]);
    for (let x = 16; x <= 31; x++) cands.push([172, x]);
    cands.push([192, 168]);
    for (const [a, b] of cands) {
      const start = a * 16777216 + b * 65536;
      if (!clash(start, 65536)) return { cidr: `${a}.${b}.0.0/16`, start, prefix: 16 };
    }
    return null;
  }

  // Which of these CIDR strings overlap a common home range? -> [{ cidr, home: [..] }]
  function homeClashes(cidrs) {
    const hp = homeParsed(), out = [];
    (cidrs || []).forEach(c => {
      const p = Calc.parseCidr(c); if (p.error) return;
      const hit = hp.filter(h => h.start <= p.end && h.end >= p.start).map(h => h.cidr);
      if (hit.length) out.push({ cidr: c, home: hit });
    });
    return out;
  }

  const norm = project => {
    const r = (project && project.intake && project.intake.remote) || {};
    return { on: !!r.on, count: n0(r.count), reach: r.reach && typeof r.reach === 'object' ? r.reach : null };
  };

  // Office networks remote staff could be given access to (internal ones only).
  const reachable = result => (result.allocations || []).filter(a => Access.isInternal(a));
  const isDefaultReach = a => ['staff', 'servers'].indexOf(Access.kindOf(a)) >= 0;
  function reachList(result, project) {
    const r = norm(project);
    return reachable(result).filter(a => (r.reach ? !!r.reach[a.name] : isDefaultReach(a)));
  }

  // Plain-English warnings; only when remote staff are ticked.
  function warnings(result, project) {
    const r = norm(project), out = [];
    if (!r.on || !result || !result.ok) return out;
    const text = (what, c) => `Remote-worker clash: ${what} ${c.cidr} ${c.home.length === 1 && c.home[0] === c.cidr ? 'is' : 'overlaps ' + c.home.join(', ') + ','} a range many home routers use. A remote worker whose home network uses it cannot reliably reach that office range over the VPN, because their traffic stays on the home network. Renumber it, or ask affected staff to change their home router's range.`;
    homeClashes(project.existing || []).forEach(c => out.push(text('The existing range', c)));
    homeClashes([result.parent.cidr].concat(result.allocations.filter(a => a.prefix <= 30).map(a => a.cidr)))
      .forEach(c => out.push(text('The office network', c)));
    return out;
  }

  // VPN address pool: remote staff + growth buffer, placed outside every office network.
  function plan(result, project) {
    const r = norm(project);
    if (!r.on || !result || !result.ok) return null;
    const g = project.opts && project.opts.growth !== undefined && project.opts.growth !== '' ? Number(project.opts.growth) : 25;
    const need = Math.max(2, Math.ceil(r.count * (1 + (Number.isFinite(g) ? g : 25) / 100)));
    let prefix = 28; while (prefix > 8 && Math.pow(2, 32 - prefix) - 2 < need) prefix--;
    const size = Math.pow(2, 32 - prefix);
    const blocked = [];
    result.allocations.forEach(a => { const p = Calc.parseCidr(a.cidr); if (!p.error) blocked.push(p); });
    (project.existing || []).forEach(c => { const p = Calc.parseCidr(c); if (!p.error) blocked.push(p); });
    homeParsed().forEach(h => blocked.push(h));
    const free = s => !blocked.some(b => b.start <= s + size - 1 && b.end >= s);
    let start = null, where = 'inside';
    const par = result.parent;
    for (let s = Math.floor((par.end + 1 - size) / size) * size; s >= par.start; s -= size) if (free(s)) { start = s; break; }
    if (start === null) { // office block is full: take the top of a separate private /16
      const p = pickSixteen(blocked.concat([par]));
      if (p) { where = 'separate'; start = p.start + 65536 - size; }
    }
    const note = [];
    if (!r.count) note.push('Remote staff was ticked with no count, so the VPN pool was sized for 2 users.');
    if (start === null) return { ok: false, error: 'No free space was found for the VPN pool.', need, notes: note };
    const cidr = `${Calc.intToIp(start)}/${prefix}`;
    return {
      ok: true, cidr, prefix, network: Calc.intToIp(start), netmask: Calc.intToIp(Calc.prefixToMask(prefix)),
      first: Calc.intToIp(start + 1), last: Calc.intToIp(start + size - 2), start, end: start + size - 1, size,
      usable: size - 2, staff: r.count, growth: g, need, where, notes: note,
      reach: reachList(result, project).map(a => a.name),
    };
  }

  return { HOME_RANGES, pickSixteen, homeClashes, warnings, plan, reachable, reachList, isDefaultReach, norm };
}));
