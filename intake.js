/* SubnetPal - client intake -> suggested plan. Pure, no DOM. window.Intake / Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'), require('./calc6.js'));
  else root.Intake = factory(root.Calc, root.Calc6);
}(typeof self !== 'undefined' ? self : this, function (Calc, Calc6) {
  'use strict';

  const GROWTH = { none: 25, soon: 50, big: 100 };
  const EXPANSION_LABEL = { none: 'None', soon: 'Soon', big: 'Big growth' };
  const VLAN_IDS = { mgmt: 10, staff: 20, servers: 30, voice: 40, cameras: 50, iot: 60, guest: 70, dmz: 80 };
  const COUNT_FIELDS = ['staff', 'wired', 'wifi', 'voice', 'cameras', 'iot', 'servers', 'guest', 'dmz'];
  const OPTIONAL = [ // kind, count key, requirement key, name, role, fold-into when not planned
    { kind: 'voice', key: 'voice', name: 'Voice', role: 'LAN', foldTo: 'staff' },
    { kind: 'cameras', key: 'cameras', name: 'Cameras', role: 'LAN', foldTo: 'staff' },
    { kind: 'iot', key: 'iot', name: 'IoT', role: 'LAN', foldTo: 'staff' },
    { kind: 'guest', key: 'guest', name: 'Guest', role: 'Guest', foldTo: 'staff' },
    { kind: 'dmz', key: 'dmz', name: 'DMZ', role: 'DMZ', foldTo: 'servers' },
  ];

  const uid = () => Math.random().toString(36).slice(2, 9);
  const num = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };

  function newIntake() {
    const counts = {}; COUNT_FIELDS.forEach(k => { counts[k] = 0; });
    return { counts, existing: '', expansion: 'none', req: { guest: false, dmz: false, voice: false, cameras: false, iot: false }, wanNote: '' };
  }
  function newClient(name) {
    return {
      id: uid(), name: name || 'New client', site: '', date: new Date().toISOString().slice(0, 10),
      intake: newIntake(), parent: '', parentAuto: true, networks: [], v6: { enabled: true, prefix: Calc6.generateUla() },
      opts: Object.assign({}, Calc.DEFAULT_OPTS), ifName: 'PORT_CHANGE_ME', planEdited: false, genNotes: [],
    };
  }

  // "10.0.0.0/8, 192.168.1.0/24" or one per line -> ['10.0.0.0/8', '192.168.1.0/24']
  function parseExisting(text) { return String(text || '').split(/[\s,;]+/).filter(Boolean); }

  // Auto-pick a private /16 that overlaps none of the existing ranges. Prefers 10.x.0.0/16.
  function pickParent(existingList) {
    const ex = (existingList || []).map(Calc.parseCidr).filter(e => !e.error);
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

  // intake -> { networks, notes }
  function suggestNetworks(intake) {
    const c = intake.counts || {}, req = intake.req || {};
    const notes = [];
    const host = { staff: num(c.staff) + num(c.wired) + num(c.wifi), servers: num(c.servers) };
    const optional = [];
    OPTIONAL.forEach(o => {
      const n = num(c[o.key]);
      if (req[o.key] && n > 0) optional.push({ o, n });
      else if (req[o.key]) notes.push(`${o.name} was ticked but the count is 0, so no ${o.name} network was added.`);
      else if (n > 0) { host[o.foldTo] += n; notes.push(`${n} ${o.name.toLowerCase()} device${n === 1 ? '' : 's'} added to the ${o.foldTo === 'staff' ? 'Staff LAN' : 'Servers network'} because ${o.name} separation was not ticked.`); }
    });
    const mk = (kind, name, hosts, role, extra) => Object.assign({ name, hosts, vlan: VLAN_IDS[kind] || '', role, kind }, extra || {});
    const nets = [
      mk('mgmt', 'Management', 10 + Math.ceil(num(c.wifi) / 30), 'Mgmt', { dhcp: false }),
      mk('staff', 'Staff LAN', Math.max(host.staff, 2), 'LAN'),
      mk('servers', 'Servers', Math.max(host.servers, 2), 'LAN', { dhcp: false }),
    ];
    optional.forEach(({ o, n }) => nets.push(mk(o.kind, o.name, n, o.role, o.kind === 'dmz' ? { dhcp: false } : {})));
    nets.push(mk('transit', 'Transit', 2, 'Transit'), mk('loopback', 'Loopback', 1, 'Loopback'));
    return { networks: nets, notes };
  }

  // Mutates client: networks, growth, parent (when auto), notes.
  function applyIntake(client) {
    const it = client.intake;
    const s = suggestNetworks(it);
    client.networks = s.networks;
    client.opts = Object.assign({}, Calc.DEFAULT_OPTS, client.opts, { growth: GROWTH[it.expansion] || GROWTH.none });
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

  const SAMPLES = {
    'Office 20 staff + guest': {
      site: 'Head office', expansion: 'none', wanNote: 'Single broadband line. No site-to-site VPN.',
      counts: { staff: 20, wired: 5, wifi: 20, servers: 1, guest: 15 }, req: { guest: true }, existing: '',
    },
    'Small branch with DMZ': {
      site: 'Branch office', expansion: 'soon', wanNote: 'Fibre primary, 4G backup. IPsec tunnel to HQ (10.20.0.0/16).',
      counts: { staff: 25, wired: 8, wifi: 25, voice: 20, cameras: 8, iot: 6, servers: 3, guest: 10, dmz: 2 },
      req: { guest: true, dmz: true, voice: true, cameras: true }, existing: '10.20.0.0/16\n192.168.1.0/24',
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

  return { GROWTH, EXPANSION_LABEL, VLAN_IDS, COUNT_FIELDS, SAMPLES, newIntake, newClient, parseExisting, pickParent, suggestNetworks, applyIntake, sampleClient, toProject };
}));
