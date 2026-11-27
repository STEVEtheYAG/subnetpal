/* SubnetPal - network folders. Sorts each network into a group by its kind (or role). Pure, no DOM. window.Groups / Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Groups = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // One line-icon set (lucide-style, 1.5 stroke); strings only, so this file stays DOM-free.
  const svg = d => '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
  const ICON = {
    users: svg('<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/>'),
    servers: svg('<rect x="4" y="3" width="16" height="7" rx="1.5"/><rect x="4" y="14" width="16" height="7" rx="1.5"/><path d="M8 6.5h.01M8 17.5h.01"/>'),
    devices: svg('<path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7"/>'),
    infra: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    all: svg('<path d="M12 3 3 8l9 5 9-5-9-5zM3 13l9 5 9-5"/>'),
  };
  const GROUPS = [
    { id: 'users', icon: ICON.users, name: 'Users' },
    { id: 'servers', icon: ICON.servers, name: 'Servers' },
    { id: 'devices', icon: ICON.devices, name: 'Devices' },
    { id: 'infra', icon: ICON.infra, name: 'Infrastructure' },
  ];
  const BY_KIND = { mgmt: 'users', staff: 'users', guest: 'users', servers: 'servers', dmz: 'servers', voice: 'devices', cameras: 'devices', iot: 'devices', printers: 'devices', pos: 'devices' };
  const BY_ROLE = { Mgmt: 'users', Guest: 'users', DMZ: 'servers', Transit: 'infra', Loopback: 'infra' };
  // Role wins for Transit/Loopback; then kind; then role; anything unknown lands in Users.
  function groupId(net) {
    const role = (net && net.role) || '', kind = (net && net.kind) || '';
    if (role === 'Transit' || role === 'Loopback') return 'infra';
    return BY_KIND[kind] || BY_ROLE[role] || 'users';
  }
  const get = id => GROUPS.find(g => g.id === id) || GROUPS[0];
  return { GROUPS, ICON, groupId, get };
}));
