/* SubnetPal - network "kinds", who-can-talk-to-who rules, and plain-English reasons. Pure, no DOM. window.Access / Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Access = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ROLE_KIND = { LAN: 'lan', Guest: 'guest', DMZ: 'dmz', Mgmt: 'mgmt', WAN: 'wan', Transit: 'transit', Loopback: 'loopback', '': 'lan' };
  const INTERNAL = ['mgmt', 'staff', 'lan', 'servers', 'voice', 'cameras', 'iot', 'other', 'printers', 'pos'];
  const NO_POLICY = ['transit', 'loopback', 'wan'];

  // Starter rules, by source kind: may it reach the internet, and which kinds may it initiate to.
  // This drives the "who can talk to who" matrix. The firewall policies themselves come from the policy card
  // library (cards.js); a test keeps the two in step for the default selection.
  const RULES = {
    staff: { internet: true, to: ['servers', 'dmz', 'printers'] },
    lan: { internet: true, to: ['servers', 'dmz', 'printers'] },
    servers: { internet: true, to: [] },
    voice: { internet: true, to: ['servers'] },
    cameras: { internet: false, to: ['servers'] },
    iot: { internet: true, to: [] },
    other: { internet: true, to: [] },
    guest: { internet: true, to: [] },
    dmz: { internet: true, to: [] },
    printers: { internet: false, to: [] },
    pos: { internet: true, to: [] },
    mgmt: { internet: true, to: ['staff', 'lan', 'servers', 'voice', 'cameras', 'iot', 'other', 'printers', 'pos', 'dmz'] },
  };

  const kindOf = a => a.kind || ROLE_KIND[a.role || ''] || 'lan';
  const hasPolicy = a => NO_POLICY.indexOf(kindOf(a)) < 0;
  const isInternal = a => INTERNAL.indexOf(kindOf(a)) >= 0;

  // 'self' | true | false
  function allowed(from, to) {
    if (from === to) return 'self';
    const r = RULES[kindOf(from)];
    return !!(r && r.to.indexOf(kindOf(to)) >= 0);
  }
  const internetAllowed = from => !!(RULES[kindOf(from)] && RULES[kindOf(from)].internet);

  // allocations -> { cols:[names], rows:[{name, internet, cells:['self'|true|false...]}] }
  function matrix(allocs) {
    const nets = allocs.filter(hasPolicy);
    return {
      cols: nets.map(n => n.name),
      rows: nets.map(f => ({ name: f.name, internet: internetAllowed(f), cells: nets.map(t => allowed(f, t)) })),
    };
  }

  const n0 = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };

  // One plain-English line tying a network to the client's need.
  function why(a, intake) {
    const c = (intake && intake.counts) || {};
    const k = kindOf(a);
    const has = !!(intake && intake.counts);
    switch (k) {
      case 'mgmt': return 'Management network for the firewall, switches and access points. Kept separate and restricted so only administrators can reach the equipment.';
      case 'staff': return has ? `Main staff network for ${n0(c.staff)} staff and their ${n0(c.wired)} wired and ${n0(c.wifi)} Wi-Fi devices.` : 'Main staff network.';
      case 'servers': return has && n0(c.servers) ? `On-site servers (${n0(c.servers)}), reachable from staff but not exposed to guests or the internet.` : 'On-site servers, reachable from staff.';
      case 'voice': return has ? `Separate voice VLAN for ${n0(c.voice)} IP phones so call traffic can be prioritised and kept apart from other devices.` : 'Voice VLAN for IP phones.';
      case 'cameras': return has ? `Cameras VLAN for ${n0(c.cameras)} cameras, kept off the staff network and allowed to reach the recorder on the servers network only.` : 'Cameras VLAN.';
      case 'iot': return has ? `IoT VLAN for ${n0(c.iot)} smart or embedded devices, isolated so a compromised device cannot reach staff or servers.` : 'IoT VLAN.';
      case 'printers': return has && n0(c.printers) ? `Printers VLAN for ${n0(c.printers)} network printers and copiers. Staff can print to them, but the printers cannot start connections to anything else.` : 'Printers VLAN. Staff can print, printers cannot reach other networks.';
      case 'pos': return has && n0(c.pos) ? `Card payment network for ${n0(c.pos)} terminals, isolated from staff, guests and servers to keep card data out of scope as far as possible. Only the payment provider is reachable.` : 'Card payment (POS) network, isolated from everything else.';
      case 'other': return `Custom device pool "${a.name}" (${a.hosts} planned), kept on its own VLAN with internet access only.`;
      case 'guest': return has ? `Guest Wi-Fi separation requested: ${n0(c.guest)} guest users get internet access only, with no route to internal systems.` : 'Guest network with internet-only access.';
      case 'dmz': return has ? `DMZ for ${n0(c.dmz)} public-facing server${n0(c.dmz) === 1 ? '' : 's'}, isolated so a compromise cannot reach the internal network.` : 'DMZ for public-facing servers.';
      case 'transit': return 'Point-to-point /31 link for routing to the upstream router or another site.';
      case 'loopback': return 'Loopback address used as a stable management and routing identity for the firewall.';
      default: return `Added manually${a.role ? ` (${a.role})` : ''}.`;
    }
  }

  return { ROLE_KIND, INTERNAL, RULES, kindOf, hasPolicy, isInternal, allowed, internetAllowed, matrix, why };
}));
