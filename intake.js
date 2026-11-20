/* SubnetPal - client intake -> suggested plan. Pure, no DOM. window.Intake / Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'), require('./calc6.js'), require('./remote.js'));
  else root.Intake = factory(root.Calc, root.Calc6, root.Remote);
}(typeof self !== 'undefined' ? self : this, function (Calc, Calc6, Remote) {
  'use strict';

  const GROWTH = { none: 25, soon: 50, big: 100 };
  const EXPANSION_LABEL = { none: 'None', soon: 'Soon', big: 'Big growth' };
  const VLAN_IDS = { mgmt: 10, staff: 20, servers: 30, voice: 40, cameras: 50, iot: 60, guest: 70, dmz: 80 };
  const COUNT_FIELDS = ['staff', 'wired', 'wifi', 'voice', 'cameras', 'iot', 'servers', 'guest', 'dmz'];
  // Optional networks: planned only when their box is ticked. Unticked means not planned (the count is ignored).
  const OPTIONAL = [
    { kind: 'servers', key: 'servers', name: 'Servers', role: 'LAN', label: 'Servers', unit: 'servers' },
    { kind: 'guest', key: 'guest', name: 'Guest', role: 'Guest', label: 'Guest wifi', unit: 'guest devices' },
    { kind: 'dmz', key: 'dmz', name: 'DMZ', role: 'DMZ', label: 'DMZ (public servers)', unit: 'public servers' },
    { kind: 'voice', key: 'voice', name: 'Voice', role: 'LAN', label: 'Voice / phones', unit: 'phones' },
    { kind: 'cameras', key: 'cameras', name: 'Cameras', role: 'LAN', label: 'Cameras', unit: 'cameras' },
    { kind: 'iot', key: 'iot', name: 'IoT', role: 'LAN', label: 'IoT', unit: 'IoT devices' },
  ];

  const MAX_OTHERS = 10;
  const uid = () => Math.random().toString(36).slice(2, 9);
  const num = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };

  function newIntake() {
    const counts = {}; COUNT_FIELDS.forEach(k => { counts[k] = 0; });
    return { counts, existing: '', expansion: 'none', req: { servers: false, guest: false, dmz: false, voice: false, cameras: false, iot: false }, others: [], remote: { on: false, count: '', reach: null }, wanNote: '' };
  }
  function newClient(name) {
    return {
      id: uid(), name: name || 'New client', site: '', date: new Date().toISOString().slice(0, 10),
      intake: newIntake(), pol: { edited: false, list: [] }, tagline: '', parent: '', parentAuto: true, networks: [], v6: { enabled: true, prefix: Calc6.generateUla() },
      opts: Object.assign({}, Calc.DEFAULT_OPTS, { style: 'vlan24' }), ifName: 'PORT_CHANGE_ME', planEdited: false, genNotes: [],
    };
  }

  // "10.0.0.0/8, 192.168.1.0/24" or one per line -> ['10.0.0.0/8', '192.168.1.0/24']
  function parseExisting(text) { return String(text || '').split(/[\s,;]+/).filter(Boolean); }

  // Auto-pick a private /16 that overlaps none of the existing ranges. Prefers 10.x.0.0/16.
  // Never picks a /16 that overlaps a common home-router range (see Remote.HOME_RANGES), so remote workers do not clash.
  function pickParent(existingList) {
    const ex = (existingList || []).map(Calc.parseCidr).filter(e => !e.error);
    const home = Remote.HOME_RANGES.map(Calc.parseCidr);
    return Remote.pickSixteen(ex.concat(home));
  }

  // intake -> { networks, notes }
  function suggestNetworks(intake) {
    const c = intake.counts || {}, req = intake.req || {};
    const notes = [];
    const host = { staff: num(c.staff) + num(c.wired) + num(c.wifi) };
    const optional = [];
    OPTIONAL.forEach(o => {
      const n = num(c[o.key]);
      if (!req[o.key]) { if (n > 0) notes.push(`${o.name} is not planned because it is not ticked (its count of ${n} is ignored).`); return; }
      if (n > 0) optional.push({ o, n });
      else { optional.push({ o, n: 2 }); notes.push(`${o.name} was ticked with no count, so it was sized for 2 ${o.unit}.`); }
    });
    const mk = (kind, name, hosts, role, extra) => Object.assign({ name, hosts, vlan: VLAN_IDS[kind] || '', role, kind }, extra || {});
    const nets = [
      mk('mgmt', 'Management', 10 + Math.ceil(num(c.wifi) / 30), 'Mgmt', { dhcp: false }),
      mk('staff', 'Staff LAN', Math.max(host.staff, 2), 'LAN'),
    ];
    optional.forEach(({ o, n }) => nets.push(mk(o.kind, o.name, Math.max(n, 2), o.role, o.kind === 'dmz' || o.kind === 'servers' ? { dhcp: false } : {})));
    // Custom "Other" device pools: own VLAN (90, 100, ...), internet-only like IoT.
    const taken = nets.map(n => n.name.toLowerCase()).concat(['transit', 'loopback']);
    (intake.others || []).slice(0, MAX_OTHERS).forEach((o, i) => {
      let name = String((o && o.name) || '').trim().slice(0, 20) || `Other ${i + 1}`;
      const base = name; let k = 2;
      while (taken.indexOf(name.toLowerCase()) >= 0) name = `${base} ${k++}`;
      taken.push(name.toLowerCase());
      const n = num(o && o.count);
      if (!n) notes.push(`${name} had no device count, so it was sized for 2 devices.`);
      nets.push(mk('other', name, Math.max(n, 2), 'LAN', { vlan: 90 + 10 * i }));
    });
    nets.push(mk('transit', 'Transit', 2, 'Transit'), mk('loopback', 'Loopback', 1, 'Loopback'));
    return { networks: nets, notes };
  }

  // Mutates client: networks, growth, parent (when auto), notes.
  function applyIntake(client) {
    const it = client.intake;
    const s = suggestNetworks(it);
    client.networks = s.networks;
    client.opts = Object.assign({}, Calc.DEFAULT_OPTS, client.opts, { growth: GROWTH[it.expansion] || GROWTH.none, style: (client.opts && client.opts.style) === 'packed' ? 'packed' : 'vlan24' });
    client.genNotes = s.notes.slice();
    if (client.parentAuto !== false || !client.parent) {
      const p = pickParent(parseExisting(it.existing));
      client.parent = p ? p.cidr : '';
      client.parentAuto = true;
      if (!p) client.genNotes.push('No free private /16 was found. Enter a parent block manually.');
    }
    if (!client.v6) client.v6 = { enabled: false, prefix: '' };
    if (client.v6.enabled && !String(client.v6.prefix || '').trim()) client.v6.prefix = Calc6.generateUla();
    client.planEdited = false;
    return client;
  }

  // Bring an older saved client up to date (Servers used to be always on; IPv6 and style settings are newer).
  function migrate(client) {
    const it = client.intake = client.intake || newIntake();
    it.counts = Object.assign(newIntake().counts, it.counts);
    it.req = it.req || {};
    if (!Array.isArray(it.others)) it.others = [];
    if (!it.remote || typeof it.remote !== 'object') it.remote = { on: false, count: '', reach: null };
    if (!client.pol || !Array.isArray(client.pol.list)) client.pol = { edited: false, list: [] };
    if (typeof client.tagline !== 'string') client.tagline = '';
    if (it.req.servers === undefined) it.req.servers = num(it.counts.servers) > 0;
    if (!client.v6) client.v6 = { enabled: false, prefix: '' };
    client.opts = Object.assign({}, Calc.DEFAULT_OPTS, client.opts);
    if (!client.opts.style) client.opts.style = 'vlan24';
    return client;
  }

  const SAMPLES = {
    'Office 20 staff + guest': {
      site: 'Head office', expansion: 'none', wanNote: 'Single broadband line. No site-to-site VPN.',
      counts: { staff: 20, servers: 2, guest: 15 }, req: { servers: true, guest: true }, existing: '',
    },
    'Small branch with DMZ': {
      site: 'Branch office', expansion: 'soon', wanNote: 'Fibre primary, 4G backup. IPsec tunnel to HQ (10.20.0.0/16).',
      counts: { staff: 25, voice: 20, cameras: 8, iot: 6, servers: 3, guest: 10, dmz: 2 },
      req: { servers: true, guest: true, dmz: true, voice: true, cameras: true }, existing: '10.20.0.0/16\n192.168.1.0/24',
    },
  };
  function sampleClient(key) {
    const s = SAMPLES[key]; if (!s) return null;
    const c = newClient(key);
    c.site = s.site; c.intake.expansion = s.expansion; c.intake.wanNote = s.wanNote; c.intake.existing = s.existing;
    Object.assign(c.intake.counts, s.counts); Object.assign(c.intake.req, s.req);
    return applyIntake(c);
  }

  // Client -> the project object Calc.plan and Fmt expect.
  const toProject = client => Object.assign({}, client, { existing: parseExisting(client.intake && client.intake.existing) });

  return { GROWTH, EXPANSION_LABEL, VLAN_IDS, COUNT_FIELDS, OPTIONAL, MAX_OTHERS, SAMPLES, migrate, newIntake, newClient, parseExisting, pickParent, suggestNetworks, applyIntake, sampleClient, toProject };
}));
