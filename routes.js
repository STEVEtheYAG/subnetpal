/* SubnetPal - suggested static routes: default route per WAN, blackhole for the unused office block, VPN pool. Pure, no DOM. window.Routes / Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'), require('./remote.js'));
  else root.Routes = factory(root.Calc, root.Remote);
}(typeof self !== 'undefined' ? self : this, function (Calc, Remote) {
  'use strict';

  const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const okIp = s => { const m = IPV4.exec(String(s || '').trim()); return !!m && m.slice(1).every(x => Number(x) <= 255); };
  const gwOf = (project, key) => { const v = String(((project && project.routes) || {})[key] || '').trim(); return okIp(v) ? v : ''; };
  const split = cidr => { const p = Calc.parseCidr(cidr); return p.error ? null : { net: Calc.intToIp(p.start), mask: Calc.intToIp(Calc.prefixToMask(p.prefix)) }; };

  // Every route this plan suggests. on = ticked (the engineer's choice wins over the default).
  // -> [{ id, title, dst, dstMask, cidr, device, gwKey, gateway, distance, blackhole, def, on, reason }]
  function suggest(result, project) {
    if (!result || !result.ok) return [];
    const it = (project && project.intake) || {}, sel = ((project && project.routes) || {}).sel || {};
    const out = [];
    const add = r => { r.on = typeof sel[r.id] === 'boolean' ? sel[r.id] : r.def; out.push(r); };
    add({ id: 'def1', seq: 101, title: 'Default route out wan1', dst: '0.0.0.0', dstMask: '0.0.0.0', cidr: '0.0.0.0/0', device: 'wan1', gwKey: 'gw1', gateway: gwOf(project, 'gw1'), distance: 10, blackhole: false, def: true,
      reason: 'Sends everything that is not an office network to the internet provider. A factory unit may already have one (check: show router static).' });
    if (it.dualWan) add({ id: 'def2', seq: 102, title: 'Backup default route out wan2', dst: '0.0.0.0', dstMask: '0.0.0.0', cidr: '0.0.0.0/0', device: 'wan2', gwKey: 'gw2', gateway: gwOf(project, 'gw2'), distance: 20, blackhole: false, def: true,
      reason: 'Same destination with a higher distance, so wan2 only takes over when the wan1 link goes down. It does not notice a dead provider behind a live link. If you use SD-WAN, untick it and use the SD-WAN zone instead.' });
    const par = split(result.parent.cidr);
    if (par) add({ id: 'bh', seq: 103, title: `Blackhole for ${result.parent.cidr}`, dst: par.net, dstMask: par.mask, cidr: result.parent.cidr, device: '', gwKey: '', gateway: '', distance: 254, blackhole: true, def: true,
      reason: 'Traffic for unused office addresses is dropped instead of leaking out the default route. Real networks are more specific, so they always win.' });
    const pool = Remote.plan(result, project);
    if (pool && pool.ok && pool.where === 'separate') add({ id: 'vpn', seq: 104, title: `Blackhole for VPN pool ${pool.cidr}`, dst: pool.network, dstMask: pool.netmask, cidr: pool.cidr, device: '', gwKey: '', gateway: '', distance: 254, blackhole: true, def: true,
      reason: 'The VPN pool sits outside the office block, so the block blackhole does not cover it. This stops pool traffic going out the internet when no tunnel is up.' });
    return out;
  }

  // CLI lines (no header). Routes that still need a gateway are written as comments so a paste never half-applies.
  function lines(result, project) {
    const on = suggest(result, project).filter(r => r.on);
    if (!on.length) return [];
    const L = ['# Static routes use fixed IDs (101 and up), so pasting twice overwrites. Check first for clashes: show router static.'];
    if (project && project.intake && project.intake.dualWan) L.push('# !! DUAL WAN: if wan1 and wan2 are SD-WAN members, do not add the two default routes below. Use one static route with the SD-WAN zone instead.');
    const missing = [], body = [];
    on.forEach(r => {
      const cm = `        set comment ${JSON.stringify(('SubnetPal ' + r.title).slice(0, 255))}`;
      if (!r.blackhole && !r.gateway) { missing.push(r.title); return; }
      body.push(...(r.blackhole
        ? [`    edit ${r.seq}`, `        set dst ${r.dst} ${r.dstMask}`, '        set blackhole enable', `        set distance ${r.distance}`, cm, '    next']
        : [`    edit ${r.seq}`, `        set dst ${r.dst} ${r.dstMask}`, `        set gateway ${r.gateway}`, `        set device "${r.device}"`, `        set distance ${r.distance}`, cm, '    next']));
    });
    if (missing.length) L.push('# Not added until the ISP gateway is entered: ' + missing.join('; ') + '.');
    if (!body.length) return L;
    L.push('config router static', ...body, 'end');
    return L;
  }

  // Plain sentences for the client report.
  function summary(result, project) {
    return suggest(result, project).filter(r => r.on).map(r => r.blackhole
      ? `${r.title} (${r.cidr}, distance ${r.distance}): ${r.reason}`
      : `${r.title} (${r.cidr} via ${r.gateway || 'ISP gateway to be entered'}, distance ${r.distance}): ${r.reason}`);
  }

  return { suggest, lines, summary, okIp };
}));
