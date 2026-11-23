/* SubnetPal - network folders. Sorts each network into a group by its kind (or role). Pure, no DOM. window.Groups / Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Groups = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const GROUPS = [
    { id: 'users', emoji: '👤', name: 'Users' },
    { id: 'servers', emoji: '🖥️', name: 'Servers' },
    { id: 'devices', emoji: '🖨️', name: 'Devices' },
    { id: 'infra', emoji: '🔗', name: 'Infrastructure' },
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
  return { GROUPS, groupId, get };
}));
