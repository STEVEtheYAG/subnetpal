/* SubnetPal - policy card library. A "card" is one firewall rule idea with its reason, risk, tier and scenario tags.
   Cards turn into editable policies only when the networks they name exist in the plan. Pure, no DOM. window.Cards / Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./access.js'), require('./webcat.js'));
  else root.Cards = factory(root.Access, root.Webcat);
}(typeof self !== 'undefined' ? self : this, function (Access, Webcat) {
  'use strict';

  const TIERS = ['baseline', 'recommended', 'optional'];
  const RISKS = ['low', 'medium', 'high'];
  // Scenarios the library covers. Every card carries at least one tag.
  const SCENARIOS = ['staff-lan', 'guest', 'iot', 'servers-dmz', 'voip', 'printers', 'pos-pci', 'management', 'wifi-ap', 'remote-vpn', 'site-vpn', 'dual-wan'];

  const ST = ['staff', 'lan'];
  // A policy card: src is a list of network kinds; dst is a list of kinds, 'internet' or 'internal' (every internal network).
  // exception: a narrow, optional allow that must sit above the deny rules it would otherwise be shadowed by.
  const P = (id, name, o) => Object.assign({ id, name, type: 'policy', action: 'accept', service: 'ALL', tier: 'recommended', risk: 'low', tags: [], why: '', exception: false }, o);
  // An advice card never becomes a policy. It is shown in the library when its condition holds.
  const D = (id, name, o) => Object.assign({ id, name, type: 'advice', tier: 'recommended', risk: 'low', tags: [], why: '', text: '' }, o);

  const intakeOf = ctx => (ctx && ctx.intake) || {};

  const LIBRARY = [
    // ---- explicit denies ----
    P('guest-deny-internal', 'Guests cannot reach internal networks', { src: ['guest'], dst: 'internal', action: 'deny', tier: 'baseline', tags: ['guest', 'wifi-ap'],
      why: 'Guests only need the internet, so they are explicitly kept away from staff, servers and equipment.' }),
    P('dmz-deny-internal', 'Public servers cannot reach internal networks', { src: ['dmz'], dst: 'internal', action: 'deny', tier: 'baseline', tags: ['servers-dmz'],
      why: 'If a public-facing server is compromised, the attacker must not be able to move into the office network.' }),
    P('iot-deny-internal', 'IoT devices cannot reach internal networks', { src: ['iot'], dst: 'internal', action: 'deny', tags: ['iot'],
      why: 'Smart devices are rarely patched, so a weak one must not be a way into staff computers or servers.' }),
    P('other-deny-internal', 'Custom device pools cannot reach internal networks', { src: ['other'], dst: 'internal', action: 'deny', tags: ['iot'],
      why: 'Each extra device pool is kept on its own island with internet access only.' }),
    P('printers-deny-internal', 'Printers cannot start connections inward', { src: ['printers'], dst: 'internal', action: 'deny', tags: ['printers'],
      why: 'Printers answer print jobs only. They should never be able to reach staff computers or servers.' }),
    P('pos-deny-internal', 'Card terminals cannot reach internal networks', { src: ['pos'], dst: 'internal', action: 'deny', tags: ['pos-pci'],
      why: 'Keeps the card payment network isolated, which limits how much of the office is in scope for card-data rules.' }),
    P('staff-deny-pos', 'Staff cannot reach card terminals', { src: ST, dst: ['pos'], action: 'deny', tags: ['pos-pci'],
      why: 'Office computers have no reason to talk to card terminals, and a compromised PC must not be able to.' }),
    P('cameras-deny-internet', 'Cameras blocked from the internet', { src: ['cameras'], dst: 'internet', action: 'deny', tags: ['iot'],
      why: 'Cameras only need to send video to the recorder. Blocking the internet stops a hacked camera calling home.' }),
    P('mgmt-lockdown', 'Only administrators can reach network equipment', { src: ['voice', 'cameras'], dst: ['mgmt'], action: 'deny', tags: ['management'],
      why: 'Switch, access point and firewall admin pages are reachable from the Management network only. Guests, IoT, printers and card terminals are already refused by their own rules; this covers phones and cameras.' }),

    // ---- common allows ----
    P('staff-internet', 'Staff to the internet', { src: ST, dst: 'internet', tier: 'baseline', tags: ['staff-lan'],
      why: 'Staff need web, email and cloud apps to do their jobs.' }),
    P('staff-servers', 'Staff to servers', { src: ST, dst: ['servers'], tier: 'baseline', tags: ['staff-lan', 'servers-dmz'],
      why: 'Staff open shared files, line-of-business apps and databases on the on-site servers.' }),
    P('staff-dmz', 'Staff to public servers', { src: ST, dst: ['dmz'], tier: 'baseline', risk: 'medium', tags: ['servers-dmz'],
      why: 'Staff and administrators look after the public-facing servers.' }),
    P('staff-printers', 'Staff to printers', { src: ST, dst: ['printers'], tags: ['printers', 'staff-lan'],
      why: 'Staff can send work to the printers. The printers cannot start a connection back, so this is a one-way door.' }),
    P('servers-internet', 'Servers to the internet', { src: ['servers'], dst: 'internet', tier: 'baseline', risk: 'medium', tags: ['servers-dmz'],
      why: 'Servers fetch updates, licences and cloud services.' }),
    P('voice-internet', 'Phones to the internet', { src: ['voice'], dst: 'internet', tier: 'baseline', tags: ['voip'],
      why: 'Hosted phone systems and SIP trunks live on the internet, so the handsets must reach them.' }),
    P('voice-servers', 'Phones to servers', { src: ['voice'], dst: ['servers'], tags: ['voip'],
      why: 'The handsets connect to a phone system that runs on your on-site servers.' }),
    P('cameras-servers', 'Cameras to servers', { src: ['cameras'], dst: ['servers'], tier: 'baseline', tags: ['iot'],
      why: 'Cameras send their video to the recorder on the servers network and nowhere else.' }),
    P('iot-internet', 'IoT devices to the internet', { src: ['iot'], dst: 'internet', tier: 'baseline', risk: 'medium', tags: ['iot'],
      why: 'Smart devices usually need their vendor cloud to work.' }),
    P('other-internet', 'Custom device pools to the internet', { src: ['other'], dst: 'internet', tier: 'baseline', risk: 'medium', tags: ['iot'],
      why: 'Extra device pools get internet access only.' }),
    P('guest-internet', 'Guests to the internet', { src: ['guest'], dst: 'internet', service: 'DNS,HTTP,HTTPS', tier: 'baseline', tags: ['guest', 'wifi-ap'],
      why: 'Guests can browse the web and nothing else.' }),
    P('dmz-internet', 'Public servers to the internet', { src: ['dmz'], dst: 'internet', tier: 'baseline', risk: 'medium', tags: ['servers-dmz'],
      why: 'Public servers fetch updates and call out to cloud services.' }),
    P('pos-internet', 'Card terminals to the payment provider', { src: ['pos'], dst: 'internet', service: 'DNS,HTTPS,NTP', risk: 'medium', tags: ['pos-pci'],
      why: 'The terminals only need to reach your payment provider, so that is all they can reach. Check with the provider whether it needs anything else.' }),
    P('mgmt-internet', 'Management to the internet', { src: ['mgmt'], dst: 'internet', tier: 'baseline', tags: ['management', 'wifi-ap'],
      why: 'Switches, access points and the firewall fetch firmware, licences and cloud-managed settings.' }),
    P('mgmt-admin', 'Management to internal networks', { src: ['mgmt'], dst: ['staff', 'lan', 'servers', 'voice', 'cameras', 'iot', 'other', 'printers', 'pos', 'dmz'], tier: 'baseline', risk: 'high', tags: ['management'],
      why: 'Administrators on the Management network reach every device they look after. This is the one network allowed to do that.' }),

    // ---- optional extras (off by default) ----
    P('pos-servers', 'Card terminals to servers', { src: ['pos'], dst: ['servers'], tier: 'optional', risk: 'medium', exception: true, tags: ['pos-pci'],
      why: 'Only if the till software needs a back-office server. It widens what has to be protected for card payments, so leave it off if the tills work on their own.' }),
    P('dmz-backend', 'Public servers to a back-end database', { src: ['dmz'], dst: ['servers'], service: 'MYSQL,MS-SQL', tier: 'optional', risk: 'high', exception: true, tags: ['servers-dmz'],
      why: 'Only if a public web server needs a database on your internal servers. It is safer to keep that database next to the public server.' }),
    P('staff-mgmt-admin', 'Staff LAN to Management (admin pages)', { src: ST, dst: ['mgmt'], service: 'HTTPS,SSH', tier: 'optional', risk: 'high', tags: ['management'],
      why: 'Lets administrators manage switches and access points from the staff LAN. Leave it off if admins connect to the Management network directly.' }),
    P('printers-internet', 'Printers to the internet', { src: ['printers'], dst: 'internet', service: 'DNS,HTTP,HTTPS,NTP', tier: 'optional', risk: 'medium', tags: ['printers'],
      why: 'Only for cloud printing or automatic firmware updates. Printers are otherwise kept off the internet.' }),
    P('staff-voice', 'Staff LAN to phones', { src: ST, dst: ['voice'], tier: 'optional', risk: 'medium', tags: ['voip'],
      why: 'Only if staff need to open the settings pages of the phones.' }),

    // ---- advice (nothing is generated; shown when it applies) ----
    D('advice-remote-vpn', 'Remote staff (IPsec VPN)', { tier: 'recommended', tags: ['remote-vpn'], when: (k, ctx) => !!(intakeOf(ctx).remote && intakeOf(ctx).remote.on),
      why: 'Remote staff reach the office through the VPN.',
      text: 'The VPN pool, split-tunnel list and the policies that let remote staff reach the ticked networks are built on the Remote tab, so they are not repeated here.' }),
    D('advice-site-vpn', 'Site-to-site VPN', { tier: 'recommended', tags: ['site-vpn'], when: (k, ctx) => !!intakeOf(ctx).siteVpn,
      why: 'Another site or head office is linked by an IPsec tunnel.',
      text: 'Not generated. Add a phase 1 and phase 2 tunnel, static routes to the far-end ranges and a pair of policies (office networks to tunnel, tunnel to office networks). Check the far end does not overlap the address block above.' }),
    D('advice-dual-wan', 'Dual WAN and failover', { tier: 'recommended', tags: ['dual-wan'], when: (k, ctx) => !!intakeOf(ctx).dualWan,
      why: 'Two internet lines keep the office online if one fails.',
      text: 'Not generated. Put both WAN ports in one SD-WAN zone and use that zone as the internet interface in the policies instead of the single WAN placeholder. Add health checks for failover.' }),
    D('advice-voice-qos', 'Prioritise phone traffic', { tier: 'recommended', tags: ['voip'], when: k => k.has('voice'),
      why: 'Calls break up when a big download fills the line.',
      text: 'Not generated. Add traffic shaping for the Voice network (high priority, reserved bandwidth) so calls stay clear when the line is busy.' }),
    D('advice-guest-isolation', 'Isolate guests on the Wi-Fi', { tier: 'recommended', tags: ['guest', 'wifi-ap'], when: k => k.has('guest'),
      why: 'Guests should not see each other either.',
      text: 'Not generated. Turn on client isolation for the guest SSID so guest devices cannot reach one another, and consider a captive portal or time limit.' }),
    D('advice-ap-mgmt', 'Wi-Fi access point management', { tier: 'recommended', tags: ['wifi-ap', 'management'], when: (k, ctx) => k.has('mgmt') && (!!intakeOf(ctx).wifi || Number((intakeOf(ctx).counts || {}).wifi) > 0),
      why: 'Access points need a safe way to be managed.',
      text: 'Put access points in the Management network. FortiAP units are managed by the FortiGate itself, which is local traffic and needs no firewall policy. Third-party access points need their controller or cloud service reachable from Management (covered by the Management to the internet rule).' }),
    D('advice-pos-logging', 'Log card-payment traffic', { tier: 'recommended', tags: ['pos-pci'], when: k => k.has('pos'),
      why: 'Card-data rules expect an audit trail.',
      text: 'Not generated. Keep logging on for the card-terminal policies and send logs to a log server. Card-data rules ask for logs to be kept for around a year (check the current standard and your acquirer).' }),
    D('advice-cloud-only', 'Cloud-only applications', { tier: 'recommended', tags: ['staff-lan'], when: (k, ctx) => intakeOf(ctx).serversWhere === 'cloud',
      why: 'No on-site servers were reported, so staff reach their applications over the internet.',
      text: 'Staff to the internet carries all the work traffic. Consider web filtering and certificate inspection on that policy, and check the Servers network is really needed.' }),
  ];

  const BY_ID = {}; LIBRARY.forEach((c, i) => { c.order = i; BY_ID[c.id] = c; });
  const byId = id => BY_ID[id] || null;

  // Which pairs of networks does this policy card apply to in this plan?
  function pairsOf(card, nets) {
    if (card.type !== 'policy') return [];
    const hasInternal = nets.some(Access.isInternal);
    const kindIn = (n, list) => list.indexOf(Access.kindOf(n)) >= 0;
    const srcs = nets.filter(n => kindIn(n, card.src));
    let dsts;
    if (card.dst === 'internet') dsts = ['internet'];
    else if (card.dst === 'internal') dsts = hasInternal ? ['internal'] : [];
    else dsts = nets.filter(n => kindIn(n, card.dst));
    const out = [];
    srcs.forEach(f => dsts.forEach(t => { if (t !== f) out.push({ from: f, to: t }); }));
    return out;
  }
  const kindsOf = nets => new Set(nets.map(Access.kindOf));
  const netsOf = allocs => (allocs || []).filter(Access.hasPolicy);

  // ctx.webFilter switches on the preset web filter profile for accept-to-internet policies; ctx.intake.industry adjusts it.
  function toPolicy(card, pair, ctx) {
    const dst = pair.to === 'internet' || pair.to === 'internal' ? pair.to : pair.to.name;
    const pol = {
      card: card.id, name: card.action === 'deny' ? `${pair.from.name} to ${dst} (block)` : '', src: pair.from.name, dst, service: card.service,
      action: card.action, nat: card.action === 'accept' && dst === 'internet', log: true,
    };
    if (ctx && ctx.webFilter && pol.action === 'accept' && dst === 'internet' && /HTTPS|ALL/.test(card.service)) {
      const preset = Webcat.presetForKind(Access.kindOf(pair.from), pair.from.name);
      if (preset) pol.webf = Webcat.profile(preset, (ctx.intake && ctx.intake.industry) || 'office');
    }
    return pol;
  }

  // Default state of one card: baseline is always on, recommended on, optional off. suggest.js can overrule tier, on and because.
  // ctx: { intake, sel: { id: { tier, on, because } }, toggles: { id: true|false } }
  function stateOf(card, ctx) {
    const s = (ctx && ctx.sel && ctx.sel[card.id]) || {};
    const tier = TIERS.indexOf(s.tier) >= 0 ? s.tier : card.tier;
    let on = typeof s.on === 'boolean' ? s.on : tier !== 'optional';
    const t = ctx && ctx.toggles && ctx.toggles[card.id];
    if (typeof t === 'boolean') on = t;
    if (tier === 'baseline') on = true;
    return { tier, on, because: s.because || '' };
  }

  // Every card that applies to this plan, with its state. -> [{ card, tier, on, because, count }]
  function library(allocs, ctx) {
    const nets = netsOf(allocs), kinds = kindsOf(nets), out = [];
    LIBRARY.forEach(card => {
      let count = 0;
      if (card.type === 'policy') { count = pairsOf(card, nets).length; if (!count) return; }
      else if (!(card.when && card.when(kinds, ctx))) return;
      out.push(Object.assign({ card, count }, stateOf(card, ctx)));
    });
    return out;
  }

  const rank = p => (p.card && BY_ID[p.card] && BY_ID[p.card].exception ? 0 : p.action === 'deny' ? 1 : 2);

  // The ordered policies for this plan: narrow exceptions, then explicit denies, then allows (by source network, internet first).
  function build(allocs, ctx) {
    const nets = netsOf(allocs), idx = n => nets.indexOf(n), rows = [];
    LIBRARY.forEach(card => {
      if (card.type !== 'policy' || !stateOf(card, ctx).on) return;
      pairsOf(card, nets).forEach(pair => rows.push({ pol: toPolicy(card, pair, ctx), key: [idx(pair.from), pair.to === 'internet' ? 0 : 1, pair.to === 'internet' || pair.to === 'internal' ? 0 : idx(pair.to), card.order] }));
    });
    const cmp = (a, b) => {
      const ra = rank(a.pol), rb = rank(b.pol); if (ra !== rb) return ra - rb;
      // denies: by source, then card; allows: by source, internet first, then destination
      const ka = ra === 1 ? [a.key[0], a.key[3], a.key[2]] : a.key, kb = rb === 1 ? [b.key[0], b.key[3], b.key[2]] : b.key;
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      return 0;
    };
    return rows.sort(cmp).map(r => r.pol);
  }

  // The policies one card would add to a plan (used when a card is switched on in a list the engineer has already edited).
  function policiesFor(id, allocs, ctx) {
    const card = BY_ID[id]; if (!card || card.type !== 'policy') return [];
    return pairsOf(card, netsOf(allocs)).map(pair => toPolicy(card, pair, ctx));
  }

  return { TIERS, RISKS, SCENARIOS, LIBRARY, byId, library, build, policiesFor, stateOf };
}));
