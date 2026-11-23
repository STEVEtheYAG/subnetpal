/* SubnetPal - "how to set this up on the FortiGate" guidance for a network card and for the remote-staff VPN card.
   Mirrors the FortiOS interface form (Name, Alias, Type, Role, Address, Administrative Access, DHCP Server, Network, Status). Pure, no DOM. window.Guide / Node.
   FortiOS menu names and field names are from memory and UNVERIFIED. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./access.js'), require('./format.js'), require('./remote.js'));
  else root.Guide = factory(root.Access, root.Fmt, root.Remote);
}(typeof self !== 'undefined' ? self : this, function (Access, Fmt, Remote) {
  'use strict';

  const NOTE = 'Menu and field names are from memory and unverified (FortiOS 8.0). ' + Fmt.FORTI_NOTE;
  const ROLE_LABEL = { lan: 'LAN', dmz: 'DMZ', wan: 'WAN', undefined: 'Undefined' };
  const ACCESS_OPTS = [['https', 'HTTPS'], ['ping', 'PING'], ['ssh', 'SSH']];
  const DEVICE_DETECT = ['staff', 'lan', 'guest', 'voice', 'cameras', 'iot', 'other', 'printers', 'pos'];
  const R = (k, v, why, extra) => Object.assign({ k, v: String(v), why: why || '' }, extra);

  function adminWhy(kind, list) {
    if (kind === 'mgmt') return 'Administrators manage the firewall from here, so HTTPS and SSH are on. Nothing else.';
    if (!list.length) return 'Nothing on the firewall needs to answer here. Devices on this network only need a gateway and DHCP, which work without any of these boxes.';
    return 'PING lets you test the gateway. The admin pages (HTTPS, SSH) stay off so only the Management network can log in to the firewall.';
  }
  function leaseOf(a) { return Access.kindOf(a) === 'guest' ? 28800 : 604800; }

  // One network -> { name, groups: [{ title, rows: [{ k, v, why, chips? }] }], cli, note }
  function iface(result, project, idx) {
    const allocs = result.allocations, a = allocs[idx];
    if (!a) return null;
    const ph = (project && project.ifName && String(project.ifName).trim()) || 'PORT_CHANGE_ME';
    const name = Fmt.ifaceNames(allocs, ph)[idx], kind = Access.kindOf(a);
    const isVlan = a.vlan !== '' && a.role !== 'Loopback', isLoop = a.role === 'Loopback';
    const role = Fmt.FORTI_ROLE[a.role] || 'lan', acc = Access.adminAccess(a);
    const ip = `${a.gateway ? a.gateway : a.firstUsable}/${a.netmask}`;
    const dev = DEVICE_DETECT.indexOf(kind) >= 0;
    const top = [R('Name', name, isVlan ? 'Built from the VLAN ID. You can rename it; keep the same name in the CLI and in policies.' : isLoop ? 'A loopback has its own name.' : `Use the real port name (for example port3) in place of ${ph}.`),
      R('Alias', a.name, 'The friendly name shown in policies and logs.'),
      R('Type', isLoop ? 'Loopback' : isVlan ? 'VLAN' : 'Physical interface', isVlan ? 'One cable (trunk) carries several networks, each on its own VLAN.' : '')];
    if (isVlan) top.push(R('VLAN protocol', '802.1Q', 'The standard way to tag VLANs. The switch port must carry this VLAN tagged.'), R('Interface', ph, 'The parent port that carries the VLAN. Replace the placeholder with your real port.'), R('VLAN ID', a.vlan, 'Must match the VLAN ID on the switch and access points.'), R('VRF ID', '0', 'Leave at 0 unless you are splitting routing tables.'));
    top.push(R('Role', ROLE_LABEL[role] || 'LAN', role === 'dmz' ? 'DMZ marks a network that holds public-facing servers.' : role === 'wan' ? 'WAN marks the internet side.' : role === 'undefined' ? 'No special role for links and loopbacks.' : 'LAN marks an internal network. Guests and devices are still kept apart by policy.'));
    const groups = [{ title: 'Interface', rows: top }];
    const addr = [R('Addressing mode', 'Manual', 'A fixed address. The firewall is the default gateway for this network.'), R('IP/Netmask', ip, 'First usable address in the range is the firewall; devices use it as their gateway.')];
    if (a.v6) addr.push(R('IPv6', `${a.v6.address}/${a.v6.prefix}`, 'The firewall address in this network’s /64. Enable IPv6 under System > Feature Visibility if the box is hidden.'));
    groups.push({ title: 'Address', rows: addr });
    groups.push({ title: 'Administrative Access', rows: [R('IPv4', acc.length ? acc.map(x => x.toUpperCase()).join(', ') : 'None', adminWhy(kind, acc), { chips: ACCESS_OPTS.map(([k, t]) => ({ t, on: acc.indexOf(k) >= 0 })) })] });
    if (a.dhcpStart) {
      groups.push({ title: 'DHCP Server', rows: [R('DHCP status', 'Enabled', 'Hands out addresses so people do not type them in.'),
        R('Address range', `${a.dhcpStart} - ${a.dhcpEnd}`, 'The pool of addresses given to devices. The rest of the network is kept for static devices.'),
        R('Netmask', a.netmask, 'Same as the interface.'), R('Default gateway', 'Same as Interface IP', 'Devices send their traffic to the firewall.'),
        R('DNS server', 'Same as System DNS', 'Devices use the firewall’s DNS settings (System > DNS). Choose Specify only for a local DNS server.'),
        R('Lease time', `${leaseOf(a)} seconds`, kind === 'guest' ? '8 hours. Guests come and go, so addresses are handed back quickly.' : '7 days (the FortiOS default). Fine for office devices that stay put.')] });
    }
    groups.push({ title: 'Network', rows: [R('Device detection', dev ? 'On' : 'Off', dev ? 'Lets the firewall name the devices it sees (phones, laptops, printers).' : 'Not useful on a network of servers, equipment or links.'),
      R('Proxy ARP', 'Off', 'Only needed in special cases.'), R('Security mode', 'Off', kind === 'guest' ? 'Off. Turn on a captive portal only if you want guests to click through a login page.' : 'Off. Not needed here.')] });
    groups.push({ title: 'Status', rows: [R('Status', 'Enabled', 'The interface is up.')] });

    const L = ['# ' + NOTE, '', 'config system interface'];
    const lines = Fmt.ifaceLines(a, name, ph);
    if (dev) lines.splice(lines.length - 1, 0, '        set device-identification enable');
    L.push(...lines, 'end');
    if (a.dhcpStart) L.push('', 'config system dhcp-server', ...Fmt.dhcpLines(a, name, 100, leaseOf(a)), 'end', '# DHCP server ID 100 is a placeholder: use any free ID on your FortiGate.');
    return { name, alias: a.name, groups, cli: L.join('\n') + '\n', note: NOTE };
  }

  // Remote staff VPN -> { steps: [{ title, where, rows, why }], cli, note }
  function vpn(result, project) {
    const pool = Remote.plan(result, project);
    if (!pool || !pool.ok) return null;
    const ph = (project && project.ifName && String(project.ifName).trim()) || 'PORT_CHANGE_ME';
    const names = Fmt.ifaceNames(result.allocations, ph), reach = Remote.reachList(result, project);
    const obj = a => 'SP_' + (Fmt.fname(a.name) || 'net');
    const steps = [];
    steps.push({ title: '1. Users and group', where: 'User & Authentication > User Definition, then User Groups',
      why: 'Each remote person gets their own login, so one leaver can be switched off without touching anyone else.',
      rows: [R('Local users', `${pool.staff || 'One per'} remote staff`, 'Create one local user per person. Use strong passwords and, if you can, two-factor (FortiToken).'),
        R('Group name', 'VPN_USERS_CHANGE_ME', 'Put all the users in this group. The VPN tunnel only accepts members of it.')] });
    steps.push({ title: '2. Address objects', where: 'Policy & Objects > Addresses',
      why: 'Named ranges the tunnel and the policies refer to.',
      rows: [R('SP_VPN_POOL', `${pool.network}/${pool.netmask}`, 'The pool remote staff are given an address from. It sits outside every office network.')]
        .concat(reach.map(a => R(obj(a), `${a.network}/${a.netmask}`, `${a.name}: a network remote staff can reach.`)))
        .concat(reach.length ? [R('SP_VPN_SPLIT (group)', reach.map(obj).join(', '), 'Only these networks go through the tunnel. Everything else stays on the person’s own internet.')] : []) });
    steps.push({ title: '3. IPsec tunnel', where: 'VPN > IPsec Tunnels > Create New > Custom (the wizard also has a Remote Access template)',
      why: 'The tunnel remote staff connect to. One dial-up tunnel serves everyone.',
      rows: [R('Name', 'SP_VPN', 'Used by the policies below.'), R('Remote gateway', 'Dialup User', 'Staff connect from anywhere, so no fixed peer address.'),
        R('Interface', Fmt.WAN_IF, 'The internet-facing port. Change it if yours is not called ' + Fmt.WAN_IF + '.'),
        R('Mode config', 'Enabled', 'Lets the firewall hand the client its VPN address and the split-tunnel list.'),
        R('Client address range', `${pool.first} - ${pool.last}`, `${pool.usable.toLocaleString()} addresses for ${pool.staff || 'the'} remote staff plus ${pool.growth}% growth. Netmask ${pool.netmask}.`),
        R('Split tunnel', reach.length ? 'SP_VPN_SPLIT' : 'None', reach.length ? 'Only office traffic goes through the VPN.' : 'No office network is ticked on the Remote tab, so nothing is sent through the tunnel.'),
        R('IKE version', '2', 'The current, more reliable version of the key exchange.'),
        R('Authentication method', 'Pre-shared key (PSK_CHANGE_ME)', 'Replace with a long random key. Staff need it in FortiClient.'),
        R('User group', 'VPN_USERS_CHANGE_ME', 'Only this group may connect.'),
        R('Phase 1 proposal', 'aes256-sha256, DH group 14', 'Strong encryption that FortiClient supports.'),
        R('Phase 2 proposal', 'aes256-sha256', 'Same strength for the data tunnel.'),
        R('Dead peer detection', 'On idle', 'Tidies up when a laptop vanishes without disconnecting.')] });
    steps.push({ title: '4. Firewall policy', where: 'Policy & Objects > Firewall Policy',
      why: 'The tunnel only brings people to the firewall. Policies decide what they can reach.',
      rows: reach.length ? reach.map(a => R(`SP_VPN to ${a.name}`, `SP_VPN > ${names[result.allocations.indexOf(a)]}`, `Source SP_VPN_POOL, destination ${obj(a)}, service ALL, NAT off, log all traffic.`))
        : [R('No policy', 'None', 'Tick at least one network on the Remote tab to give remote staff somewhere to go.')] });
    steps.push({ title: '5. FortiClient on the laptop', where: 'FortiClient > Remote Access > Configure VPN',
      why: 'What each remote person enters once.',
      rows: [R('VPN', 'IPsec VPN', ''), R('Connection name', 'Office VPN', 'Anything the person will recognise.'),
        R('Remote gateway', 'Your WAN IP or domain name', 'The public address of the FortiGate.'),
        R('Authentication method', 'Pre-shared key', 'Enter the same key as the tunnel.'),
        R('Authentication', 'Prompt on login', 'The person types their own username and password.'),
        R('Advanced', 'IKE version 2, mode config', 'Must match the tunnel. Phase 1 and 2 proposals: aes256 / sha256 / DH 14.'),
        R('Test', `Address from ${pool.first} - ${pool.last}`, 'Connect, check the assigned address, then ping the gateway of an allowed network.')] });
    return { steps, cli: Fmt.toRemoteFortiOS(result, project, project && project.ifName), note: NOTE };
  }

  return { NOTE, iface, vpn };
}));
