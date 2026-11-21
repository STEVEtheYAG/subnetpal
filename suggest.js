/* SubnetPal - rule engine that picks policy cards for a site from the intake answers and the plan. Pure functions, no DOM.
   It only seeds the Policies list: once the engineer edits, the list is frozen as before. window.Suggest / Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./access.js'), require('./cards.js'));
  else root.Suggest = factory(root.Access, root.Cards);
}(typeof self !== 'undefined' ? self : this, function (Access, Cards) {
  'use strict';

  const INDUSTRIES = [
    { v: 'office', l: 'Office' }, { v: 'clinic', l: 'Clinic' }, { v: 'school', l: 'School' }, { v: 'retail', l: 'Retail' },
  ];
  const SERVERS = [{ v: 'onprem', l: 'On-site servers' }, { v: 'cloud', l: 'Cloud only' }];
  const WIFI = [{ v: 'fortiap', l: 'FortiAP (managed by the FortiGate)' }, { v: 'thirdparty', l: 'Third-party access points' }];
  const VOIP = [{ v: 'hosted', l: 'Hosted (cloud) phone system' }, { v: 'onprem', l: 'On-site phone system (PBX)' }];
  const SIZE_LABEL = { small: 'small', medium: 'medium', large: 'large' };
  const SMALL_MAX = 15, MEDIUM_MAX = 75;   // staff counts: up to 15 small, 16 to 75 medium, over 75 large

  const n0 = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
  const labelOf = (list, v) => { const x = list.find(i => i.v === v); return x ? x.l : ''; };

  function sizeOf(staff) { return staff <= SMALL_MAX ? 'small' : staff <= MEDIUM_MAX ? 'medium' : 'large'; }

  // Everything the rules look at, in one place.
  function facts(allocs, intake) {
    const it = intake || {}, c = it.counts || {};
    const nets = (allocs || []).filter(Access.hasPolicy);
    const staff = n0(c.staff) || (n0(c.wired) + n0(c.wifi));
    const ind = INDUSTRIES.some(i => i.v === it.industry) ? it.industry : 'office';
    return {
      staff, size: sizeOf(staff), industry: ind, industrySet: ind === it.industry,
      kinds: new Set(nets.map(Access.kindOf)), ifaces: nets.length,
      servers: it.serversWhere === 'onprem' || it.serversWhere === 'cloud' ? it.serversWhere : '',
      wifi: it.wifi === 'fortiap' || it.wifi === 'thirdparty' ? it.wifi : '',
      voip: it.voip === 'hosted' || it.voip === 'onprem' ? it.voip : '',
      dualWan: !!it.dualWan, siteVpn: !!it.siteVpn, remote: !!(it.remote && it.remote.on),
      req: it.req || {},
    };
  }

  // The input that triggers a card, in plain words: "Guest wifi ticked".
  const TRIGGER = { guest: 'Guest wifi ticked', dmz: 'DMZ ticked', servers: 'Servers ticked', voice: 'Voice / phones ticked', cameras: 'Cameras ticked', iot: 'IoT ticked', printers: 'Printers ticked', pos: 'Card payments (POS) ticked', other: 'a custom device pool was added' };
  function baseBecause(card) {
    if (card.type === 'advice') return ADVICE_TRIGGER[card.id] || '';
    const kinds = card.src.concat(Array.isArray(card.dst) ? card.dst : []);
    const hits = []; kinds.forEach(k => { if (TRIGGER[k] && hits.indexOf(TRIGGER[k]) < 0) hits.push(TRIGGER[k]); });
    return hits.length ? hits.join(', ') : 'every plan has this network';
  }
  const ADVICE_TRIGGER = {
    'advice-remote-vpn': 'Remote staff ticked', 'advice-site-vpn': 'Site-to-site VPN ticked', 'advice-dual-wan': 'Dual WAN ticked', 'advice-voice-qos': 'Voice / phones ticked',
    'advice-guest-isolation': 'Guest wifi ticked', 'advice-ap-mgmt': 'Wi-Fi answered or Wi-Fi devices counted', 'advice-pos-logging': 'Card payments (POS) ticked', 'advice-cloud-only': 'Servers: cloud only',
  };

  // Rules that change a card's tier. Later rules win; every matching rule adds its reason to "because".
  // set: { tier }   why: (facts) => short reason
  const RULES = [
    { card: 'mgmt-lockdown', when: f => f.size === 'small' && f.industry === 'office' && f.ifaces < 8, set: { tier: 'optional' }, why: f => `small site (${f.staff} staff, ${f.ifaces} networks): admin is usually one person` },
    { card: 'mgmt-lockdown', when: f => f.size !== 'small', set: { tier: 'recommended' }, why: f => `${SIZE_LABEL[f.size]} site (${f.staff} staff)` },
    { card: 'mgmt-lockdown', when: f => f.industry === 'clinic' || f.industry === 'school', set: { tier: 'recommended' }, why: f => `${f.industry} site: protect the equipment` },
    { card: 'mgmt-lockdown', when: f => f.ifaces >= 8, set: { tier: 'recommended' }, why: f => `${f.ifaces} networks in the plan` },
    { card: 'voice-servers', when: f => f.voip === 'hosted', set: { tier: 'optional' }, why: () => 'phones are hosted in the cloud, so they need no on-site server' },
    { card: 'voice-servers', when: f => f.voip === 'onprem', set: { tier: 'recommended' }, why: () => 'on-site phone system (PBX)' },
    { card: 'staff-voice', when: f => f.voip === 'onprem' && f.size !== 'small', set: { tier: 'optional' }, why: () => 'on-site PBX: only if staff need handset admin pages' },
    { card: 'printers-internet', when: f => f.industry === 'clinic', set: { tier: 'optional' }, why: () => 'clinic: keep printers off the internet (patient documents)' },
    { card: 'pos-servers', when: f => f.industry === 'retail' && f.servers === 'onprem', set: { tier: 'optional' }, why: () => 'retail with on-site servers: tills sometimes need a back-office server (consider it, it widens card scope)' },
    { card: 'staff-mgmt-admin', when: f => f.size !== 'large' && f.wifi === 'thirdparty', set: { tier: 'optional' }, why: () => 'third-party access points: admins may manage them from the staff LAN' },
    { card: 'cameras-deny-internet', when: f => f.industry === 'school' || f.industry === 'clinic', set: { tier: 'recommended' }, why: f => `${f.industry} site: camera footage is sensitive` },
  ];

  // Things the cards cannot fix: a contradiction or a missing network. Plain sentences.
  function notesFor(f) {
    const n = [];
    if (f.servers === 'onprem' && !f.req.servers) n.push('On-site servers were reported but the Servers network is not ticked. Tick Servers so staff reach them on their own network.');
    if (f.servers === 'cloud' && f.req.servers) n.push('Servers are cloud only, yet the Servers network is ticked. Untick it unless something stays on site.');
    if (f.voip && !f.req.voice) n.push('A phone system was reported but Voice / phones is not ticked, so phones will sit on the staff network.');
    if (f.wifi && !f.req.guest) n.push('Wi-Fi was reported. If guests will use it, tick Guest wifi so they get their own network.');
    if (f.industry === 'retail' && f.industrySet && !f.req.pos) n.push('Retail sites usually take cards. Tick Card payments (POS) to isolate the terminals.');
    if (f.industry === 'clinic' && f.industrySet && !f.req.guest) n.push('Clinics usually have a waiting room. Tick Guest wifi if patients get Wi-Fi.');
    if (f.industry === 'school' && f.industrySet && !f.req.guest) n.push('Schools usually need a separate network for pupils or visitors. Tick Guest wifi or add an Other pool.');
    return n;
  }

  // -> { size, staff, industry, sel: { cardId: { tier, because } }, notes, facts }
  function run(allocs, intake) {
    const f = facts(allocs, intake), sel = {};
    Cards.LIBRARY.forEach(card => {
      const reasons = [baseBecause(card)].filter(Boolean);
      let tier = card.tier;
      RULES.forEach(r => {
        if (r.card !== card.id || !r.when(f)) return;
        tier = r.set.tier || tier; reasons.push(r.why(f));
      });
      if (card.id === 'advice-ap-mgmt' && f.wifi) reasons[0] = `Wi-Fi: ${labelOf(WIFI, f.wifi)}`;
      sel[card.id] = { tier, because: reasons.join('; ') };
    });
    return { size: f.size, staff: f.staff, industry: f.industry, sel, notes: notesFor(f), facts: f };
  }

  return { INDUSTRIES, SERVERS, WIFI, VOIP, SMALL_MAX, MEDIUM_MAX, RULES, sizeOf, facts, run, notesFor };
}));
