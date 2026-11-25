/* SubnetPal - "how to set this up on the FortiGate" guidance for a network card and for the remote-staff VPN card.
   Mirrors the FortiOS interface form (Name, Alias, Type, Role, Address, Administrative Access, DHCP Server, Network, Status). Pure, no DOM. window.Guide / Node.
   Field names, order and values follow Bob's FortiOS 8.0.2 guide (VM capture). Anything not captured from the VM is flagged approx. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./access.js'), require('./format.js'), require('./remote.js'));
  else root.Guide = factory(root.Access, root.Fmt, root.Remote);
}(typeof self !== 'undefined' ? self : this, function (Access, Fmt, Remote) {
  'use strict';

  const NOTE = 'Field names and order follow the FortiOS 8.0.2 GUI capture; items tagged "approximate" were not captured. ' + Fmt.FORTI_NOTE;
  const LOG_NOTE = 'Traffic logging is not an interface option. Set it on the firewall policy that uses this network: Log allowed traffic = All sessions.';
  const ROLE_LABEL = { lan: 'LAN', dmz: 'DMZ', wan: 'WAN', undefined: 'Undefined' };
  const ipInt = s => String(s).split('.').reduce((n, x) => n * 256 + Number(x), 0);
  // Administrative Access boxes in the order the FortiOS form shows them. HTTP is greyed out on the VM (needs a deliberate choice), so it is never ticked here.
  const ACCESS_OPTS = [['https', 'HTTPS'], ['http', 'HTTP', 1], ['ping', 'PING'], ['fgfm', 'FMG-Access'], ['ssh', 'SSH'], ['snmp', 'SNMP'], ['ftm', 'FTM'], ['radius-acct', 'RADIUS Accounting'], ['probe-response', 'Security Fabric Connection'], ['speed-test', 'Speed Test'], ['scim', 'SCIM']];
  const DEVICE_DETECT = ['staff', 'lan', 'guest', 'voice', 'cameras', 'iot', 'other', 'printers', 'pos', 'servers'];
  const R = (k, v, why, extra) => Object.assign({ k, v: String(v), why: why || '' }, extra);

  function adminWhy(kind, list) {
    if (kind === 'mgmt') return 'Administrators manage the firewall from here, so HTTPS, SSH and PING are on. Add SNMP or FMG-Access only if you use them.';
    if ((kind === 'staff' || kind === 'lan') && list.indexOf('https') < 0) return 'PING only. Admins manage the firewall from the Management network (HTTPS, SSH there, plus trusted hosts on the admin account).';
    if (kind === 'staff' || kind === 'lan') return 'No Management network in this plan, so staff and IT manage the firewall from here (HTTPS, SSH, PING). Add a Management network to take admin access off Staff.';
    if (kind === 'guest') return 'Guests must never reach the admin GUI. No admin boxes (PING at most).';
    if (kind === 'printers' || kind === 'iot') return 'None. Weak devices are isolated; tick PING only while troubleshooting.';
    if (kind === 'wan') return 'WAN = PING only, or nothing. Never HTTP, HTTPS or SSH on the WAN: manage from the LAN.';
    if (!list.length) return 'Nothing on the firewall needs to answer here. Devices on this network only need a gateway and DHCP, which work without any of these boxes.';
    return 'PING lets you test the gateway. The admin pages (HTTPS, SSH) stay off here.';
  }
  function dhcpOffWhy(kind) {
    if (kind === 'mgmt') return 'Disabled. Switches, access points and admin PCs on Management are given fixed addresses so you can always find them.';
    if (kind === 'servers' || kind === 'dmz') return 'Disabled. Servers use fixed addresses, so nothing should hand them out.';
    if (kind === 'transit' || kind === 'loopback') return 'Disabled. A point-to-point link or loopback has no devices to configure.';
    return 'Disabled. The plan gives this network no DHCP range, so devices here use fixed addresses.';
  }
  function leaseOf(a) { return Access.kindOf(a) === 'guest' ? 14400 : 604800; }

  // Pre-display checks (guide 1.2). -> [{ ok, t }]
  function checks(allocs, a, ph) {
    const out = [], kind = Access.kindOf(a), lanLike = ['transit', 'loopback', 'wan'].indexOf(kind) < 0;
    out.push({ ok: !lanLike || a.prefix <= 30, t: lanLike ? 'LAN prefix is /30 or shorter (a /31 or /32 has no host range for DHCP).' : 'Links and loopbacks may be /31 or /32.' });
    const clash = allocs.filter(o => o !== a && o.start <= a.end && o.end >= a.start);
    out.push({ ok: !clash.length, t: clash.length ? `The subnet overlaps ${clash.map(o => o.name).join(', ')}. FortiGate refuses this with "The IP address overlaps with interface X".` : 'The subnet overlaps no other card.' });
    if (a.vlan !== '' && a.role !== 'Loopback') {
      const v = Number(a.vlan), dup = allocs.filter(o => o !== a && String(o.vlan) === String(a.vlan) && o.role !== 'Loopback');
      out.push({ ok: v >= 1 && v <= 4094 && !dup.length, t: v >= 1 && v <= 4094 ? (dup.length ? `VLAN ${a.vlan} is also used by ${dup.map(o => o.name).join(', ')} on the same parent port.` : `VLAN ${a.vlan} is 1-4094 and unique on ${ph}.`) : 'VLAN ID must be 1-4094.' });
    }
    if (a.dhcpStart) {
      const s = ipInt(a.dhcpStart), e = ipInt(a.dhcpEnd), bad = [a.network, a.broadcast, a.gateway].filter(x => x && ipInt(x) >= s && ipInt(x) <= e);
      out.push({ ok: !bad.length, t: bad.length ? `The DHCP pool contains ${bad.join(', ')}.` : 'The DHCP pool excludes the gateway, network and broadcast addresses.' });
    }
    return out;
  }

  // Common-mistake hints (guide 1.5), picked for this card and filled with its own values.
  function hints(a, kind, allocs) {
    const h = [];
    h.push(`Gateway is network + 1 (${a.gateway || a.firstUsable}), not ${a.network}.`);
    if (a.dhcpStart) h.push(`Start the pool at gateway + 1 and end it at broadcast - 1 (${a.dhcpStart} - ${a.dhcpEnd}).`);
    if (a.vlan !== '' && a.role !== 'Loopback') h.push('VLAN ID 1-4094, unique per parent port.');
    if ((kind === 'staff' || kind === 'lan') && !(allocs || []).some(x => Access.kindOf(x) === 'mgmt')) h.push('Caution: consider a Management network for HTTPS/SSH, plus trusted hosts on the admin account, instead of the whole staff network.');
    if (kind === 'servers') h.push('Caution: category web blocking on the Servers network can break OS and vendor updates. Test updates, and allow update sites if needed.');
    if (kind === 'voice') h.push('Phones usually need DHCP option 66 (provisioning server) or 150 (Cisco TFTP): add it to this DHCP server if the phone system provisions that way.');
    if (a.dhcpStart && kind !== 'guest') h.push('DNS: if devices join a Windows domain, set the domain controller as the DHCP DNS server (box at the top of this card), not System DNS.');
    h.push('Each card needs its own subnet.', 'Role: WAN for the uplink, LAN for internal. Never leave it Undefined.', 'Leave "Create address object" on: policies need the subnet object.', 'Name: max 15 characters, no spaces.', 'Logging lives on the policy, not on the interface.');
    if (kind === 'wan') h.unshift('WAN = PING only. Manage from the LAN.');
    if (kind === 'guest') h.unshift('Guests: PING only (or nothing), never HTTPS.');
    if (kind === 'servers') h.unshift('Servers are static: DHCP off.');
    return h;
  }

  // One network -> { name, groups: [{ title, rows: [{ k, v, why, chips?, approx? }], approx? }], checks, hints, notes, cli, note }
  function iface(result, project, idx) {
    const allocs = result.allocations, a = allocs[idx];
    if (!a) return null;
    const ph0 = (project && project.ifName && String(project.ifName).trim()) || 'PORT_CHANGE_ME';
    const ph = Fmt.parentPort(allocs, ph0, project), name = Fmt.ifaceNames(allocs, ph0, project)[idx], kind = Access.kindOf(a);
    const isVlan = a.vlan !== '' && a.role !== 'Loopback', isLoop = a.role === 'Loopback', isWan = kind === 'wan';
    const role = Fmt.FORTI_ROLE[a.role] || 'lan', acc = Access.adminAccess(a, allocs);
    const ip = `${a.gateway ? a.gateway : a.firstUsable}/${a.netmask}`;
    const dev = DEVICE_DETECT.indexOf(kind) >= 0, obj = ('SP_' + (Fmt.fname(a.name) || 'net')).slice(0, 79);
    const top = [R('Name', name, isVlan ? 'Built from the VLAN ID. You can rename it; keep the same name in the CLI and in policies. Max 15 characters, no spaces.' : isLoop ? 'A loopback has its own name.' : (Fmt.portPool(project).length ? `Assigned from the ports available. Change it with the Port picker at the top of this card.` : `Use the real port name (for example port3) in place of ${ph}.`)),
      R('Alias', a.name, 'The friendly name shown in policies and logs.'),
      R('Type', isLoop ? 'Loopback Interface' : isVlan ? 'VLAN' : 'Physical Interface', isVlan ? 'One cable (trunk) carries several networks, each on its own VLAN.' : isWan ? 'The WAN is the physical port, not a VLAN. Use Edit on the existing port.' : isLoop ? 'Always up, unlike a physical port.' : '')];
    if (isVlan) top.push(R('VLAN protocol', '802.1Q', 'The standard way to tag VLANs. The switch port must carry this VLAN tagged.'), R('Interface', ph, 'The parent port that carries the VLAN. Replace the placeholder with your real port.'), R('VLAN ID', a.vlan, 'Must match the VLAN ID on the switch and access points.'), R('VRF ID', '0', 'Leave at 0 unless you are splitting routing tables.'));
    top.push(R('Role', ROLE_LABEL[role] || 'LAN', role === 'dmz' ? 'DMZ marks a network that holds public-facing servers.' : role === 'wan' ? 'WAN enables WAN behaviour and the right policy defaults.' : role === 'undefined' ? 'No special role for links and loopbacks.' : 'LAN marks an internal network. Guests and devices are still kept apart by policy.'));
    if (!isVlan && !isLoop) top.push(R('Dedicated Management Port', kind === 'mgmt' ? 'On' : 'Off', kind === 'mgmt' ? 'Takes the port out of routing and policies. Physical ports only.' : 'Off. Only a physical management port uses this.'));
    const groups = [{ title: 'Interface', rows: top }];
    let addr;
    if (isWan) addr = [R('Addressing mode', 'DHCP', 'Most ISPs hand out the address. Choose Manual instead if the ISP gave a static IP.'),
      R('Retrieve default gateway from server', 'On', 'Creates the default route.'), R('Distance', '5', 'The default.'), R('Override internal DNS', 'On', 'Uses the ISP DNS (the default).'),
      R('If Manual: IP/Netmask', ip, 'Use the ISP-supplied address. A static route 0.0.0.0/0 to the ISP gateway is also needed (Network > Static Routes).')];
    else {
      addr = [R('Addressing mode', 'Manual', isLoop ? 'A loopback is Manual only.' : 'A fixed address. The firewall is the default gateway for this network.'), R('IP/Netmask', ip, isLoop ? 'A single /32 host address, the one place a /32 is correct.' : 'First usable address (network + 1) is the firewall; devices use it as their gateway. The GUI shows it as address/netmask.')];
      addr.push(R('Create address object matching subnet', 'On', 'Makes a firewall address object for this network so policies can use it.'), R('Name', obj, 'The firewall address object the policies in the export refer to.'), R('Destination', a.cidr, 'The whole network.'), R('Secondary IP address', 'Off', 'Off. Not needed here.'));
    }
    if (a.v6) addr.push(R('IPv6', `${a.v6.address}/${a.v6.prefix}`, 'The firewall address in this network’s /64. Enable IPv6 under System > Feature Visibility if the box is hidden.'));
    groups.push({ title: 'Address', rows: addr });
    groups.push({ title: 'Administrative Access', rows: [R('IPv4', acc.length ? acc.map(x => x.toUpperCase()).join(', ') : 'None', adminWhy(kind, acc), { chips: ACCESS_OPTS.map(([k, t, dis]) => ({ t, on: acc.indexOf(k) >= 0, dis: !!dis })) })] });
    if (!a.dhcpStart) {
      const rows = [R('DHCP status', 'Disabled', dhcpOffWhy(kind))];
      if (kind === 'servers' || kind === 'dmz') rows.push(R('Static range', a.staticStart ? `${a.staticStart} - ${a.staticEnd}` : `${a.firstUsable} - ${a.lastUsable}`, 'Usable range minus the gateway. Give each server a fixed address here, and create a /32 address object per server.'));
      groups.push({ title: 'DHCP Server', rows });
    } else {
      const lease = leaseOf(a), dns = Fmt.dnsOf(project, a);
      const rows = [R('DHCP status', 'Enabled', 'Hands out addresses so people do not type them in.'),
        R('Address range', `${a.dhcpStart} - ${a.dhcpEnd}`, 'Starts after the gateway (or the static block) and ends at broadcast - 1. The rest is kept for static devices.'),
        R('Netmask', a.netmask, 'Same as the interface.'), R('Default gateway', 'Same as Interface IP', 'Devices send their traffic to the firewall.'),
        dns.server ? R('DNS server', 'Specify: ' + dns.server, 'Devices use this local DNS server (set below). Windows domains need the domain controller here.' + (dns.domain ? ' DNS domain: ' + dns.domain + '.' : '')) : R('DNS server', 'Same as System DNS', 'Devices use the firewall’s DNS settings (System > DNS). Windows domains usually need the domain controller instead: enter it in the box at the top of this card.'),
        R('Lease time', `${lease} seconds`, kind === 'guest' ? '4 hours (guests: 3600-14400 s). Guests come and go, so short leases free up addresses.' : '7 days (the FortiOS default). Fine for office devices that stay put.')];
      if (kind === 'printers') rows.push(R('IP address assignment rules', 'Reserve each printer by MAC', `Printers need a fixed IP. Reserve them by MAC, or keep them in the static block${a.staticStart ? ` (${a.staticStart} - ${a.staticEnd})` : ''} and start the pool after it.`, { approx: true }));
      groups.push({ title: 'DHCP Server', rows, approx: true });
    }
    groups.push({ title: 'Network', rows: [R('Device detection', dev ? 'On' : 'Off', dev ? 'Lets the firewall name the devices it sees (phones, laptops, printers).' : isWan ? 'Off. Do not scan the internet side.' : 'Not useful on a network of equipment or links.'),
      R('Proxy ARP', 'Off', 'Only needed in special cases.'), R('Security mode', 'Off', kind === 'guest' ? 'Off. Turn on a captive portal only if the client wants a login page; it needs a portal setup (approximate).' : 'Off. Not needed here.', kind === 'guest' ? { approx: true } : undefined)] });
    groups.push({ title: 'Traffic Shaping', rows: [R('Outbound shaping profile', 'Off', kind === 'voice' ? 'Off for now. Phone traffic is best prioritised with a shaping profile once the network is running (see the voice advice on the Policies tab).' : 'Off. Not needed to start with.'), R('Outbound bandwidth', 'Off', 'Off. Set a limit only if this network must not use the whole line.')] });
    const comment = `SubnetPal: ${a.name} ${a.cidr}`;
    groups.push({ title: 'Miscellaneous', rows: [R('Comments', comment, 'Optional note (up to 255 characters) that shows in the interface list.'), R('Status', 'Enabled', 'The interface is up.')] });

    const L = ['# ' + NOTE, '', 'config system interface'];
    const lines = Fmt.ifaceLines(a, name, ph);
    if (isWan) lines.splice(lines.findIndex(x => /^\s+set ip /.test(x)), 1, '        set mode dhcp');
    lines.splice(lines.length - 1, 0, ...(dev ? ['        set device-identification enable'] : []), `        set description ${JSON.stringify(comment)}`);
    L.push(...lines, 'end', '', 'config firewall address', `    edit ${JSON.stringify(obj)}`, `        set subnet ${a.network} ${a.netmask}`, `        set comment ${JSON.stringify(a.name + ' (' + a.cidr + ')')}`, '    next', 'end');
    if (a.dhcpStart) L.push('', '# Check existing DHCP servers first (show system dhcp server): IDs start at 101 and stay fixed per network, so pasting twice overwrites instead of adding.', 'config system dhcp server', ...Fmt.dhcpLines(a, name, Fmt.dhcpId(allocs, a), leaseOf(a), Fmt.dnsOf(project, a)), 'end');
    return { name, alias: a.name, groups, checks: checks(allocs, a, ph), hints: hints(a, kind, allocs), notes: [LOG_NOTE], cli: Fmt.cliOnly(L.join('\n')) + '\n', cliNotes: Fmt.notesOnly(L.join('\n')), note: NOTE };
  }

  // Tunnel name: at most 13 characters, no spaces (the wizard adds suffixes to it). From the client name, else a default.
  function tunnelName(project) {
    const w = String((project && project.name) || '').trim().split(/\s+/)[0].replace(/[^A-Za-z0-9]+/g, '');
    return (w ? w.slice(0, 9) : 'SP') + '-FCT';
  }

  // Remote staff VPN (FortiClient IPsec) -> { computed, steps: [{ title, where, rows, why, approx? }], table, mistakes, cli, note }
  function vpn(result, project) {
    const pool = Remote.plan(result, project);
    if (!pool || !pool.ok) return null;
    const ph = (project && project.ifName && String(project.ifName).trim()) || 'PORT_CHANGE_ME';
    const reach = Remote.reachList(result, project), tn = tunnelName(project);
    const subnets = reach.map(a => a.cidr).join(', ') || 'None ticked';
    const dnsV = reach.map(x => Fmt.dnsOf(project, x)).find(d => d.server), first = reach[0], grp = 'RemoteStaff', staff = pool.staff || 'One per';
    const computed = { title: 'Values to use', rows: [
      R('Tunnel name', tn, 'At most 13 characters, no spaces: the wizard adds suffixes to it.'),
      R('Client address range', `${pool.first} - ${pool.last}`, `A new block that overlaps no office network: ${pool.usable.toLocaleString()} addresses for ${pool.staff || 'the'} remote staff plus ${pool.growth}% growth.`),
      R('Pre-shared key', 'Generate 12+ random characters', 'Share it securely. SubnetPal never stores it.'),
      R('Local subnets', subnets, 'Only what remote staff need, not everything.'),
      R('Users', `${staff} remote staff`, 'One local user per person.'),
      R('VPN client DNS', dnsV ? dnsV.server : 'Set one', 'Remote staff need the office DNS (the domain controller on Windows sites) to find servers by name. In the wizard review or phase 1, set the IPv4 DNS server (ipv4-dns-server1).')] };
    const steps = [
      { title: '1. Users', where: 'User & Authentication > User Definition > Create new', why: 'Run the Users/Groups Creation Wizard once per person, so one leaver can be switched off alone.',
        rows: [R('Step 1: User Type', 'Local User', ''), R('Step 2', 'Username + Password', 'Strong password for each person.'), R('Steps 3-4', 'Contact Info optional, User Account Status Enabled, two-factor if licensed', 'Not captured from the VM.', { approx: true })] },
      { title: '2. User group', where: 'User & Authentication > User Groups > Create new', why: 'The tunnel only accepts members of this group.',
        rows: [R('Name', grp, ''), R('Type', 'Firewall', ''), R('Members', 'The users from step 1', '')] },
      { title: '3. VPN Wizard', where: 'VPN > VPN Wizard', why: 'Start the tunnel.',
        rows: [R('Tunnel name', tn, 'At most 13 characters.'), R('Template', 'FortiClient remote access', ''), R('Then', 'Click Begin', '')] },
      { title: '4. Wizard: Authentication', where: 'VPN Wizard, Authentication step', approx: true, why: 'Who connects and how. Not captured from the VM.',
        rows: [R('Incoming Interface', `WAN port (${Fmt.wanIf(project)})`, 'Change it if your internet port is called something else.'), R('Authentication method', 'Pre-shared Key', 'Use the key from "Values to use".'), R('User Group', grp, '')] },
      { title: '5. Wizard: Policy & Routing', where: 'VPN Wizard, Policy & Routing step', approx: true, why: 'What they can reach. Not captured from the VM.',
        rows: [R('Local interface', first ? first.name : 'The servers (or staff) network', 'The network remote staff need most.'), R('Local subnets', subnets, 'Only what is needed.'), R('Client address range', `${pool.first} - ${pool.last}`, `Netmask ${pool.netmask}.`),
          R('Enable IPv4 split tunnel', reach.length ? 'On' : 'On (no office network is ticked on the Remote tab)', 'Only company traffic goes through the tunnel; the rest stays on the person’s own internet.')] },
      { title: '6. Wizard: Review', where: 'VPN Wizard, Review', why: 'Check, then create.',
        rows: [R('The table lists', 'Tunnel, address objects (<name>_local, <name>_range), firewall policy, routes', ''), R('Then', 'Click Create', '')] },
      { title: '7. Harden phase 1', where: 'VPN > VPN Tunnels > edit the tunnel', why: 'The wizard defaults are wide. Tighten them.',
        rows: [R('Phase 1 proposal', 'Remove anything with DES, 3DES, MD5, SHA1', 'Keep e.g. AES256-SHA256 / AES256GCM-PRFSHA384.'), R('Diffie-Hellman groups', '20, 21', 'Nothing below 14.'), R('IKE version', 'Leave what the wizard chose', 'Do not force a version. SubnetPal assumes the FortiClient template gives IKEv1 + XAuth (confirm on the VM).')] },
      { title: '8. Tighten the policy', where: 'Policy & Objects > Firewall Policy', why: 'The wizard policy is too wide.',
        rows: [R('Name', 'RemoteStaff-to-' + (first ? Fmt.fname(first.name) : 'Servers'), ''), R('Source', `${pool.first} - ${pool.last} + ${grp}`, 'Client range plus the group.'), R('Destination', subnets, 'The local subnets.'),
          R('Service', 'Only what is needed (e.g. SMB, HTTPS, RDP)', 'Not ALL.'), R('Action / NAT', 'ACCEPT / NAT off', ''), R('Log allowed traffic', 'All sessions', 'Logging is set on the policy.')] },
      { title: '9. WAN interface', where: 'Network > Interfaces (WAN)', why: 'No change needed.',
        rows: [R('Administrative Access', 'PING only', 'IPsec does not need HTTPS or SSH on the WAN.')] },
      { title: '10. FortiClient on each laptop', where: 'FortiClient, new connection', approx: true, why: 'What each remote person enters once. Not captured from the VM.',
        rows: [R('VPN', 'IPsec VPN', ''), R('Remote Gateway', 'WAN public IP (or DDNS name)', 'The public address of the FortiGate.'), R('Authentication', 'Pre-shared key', 'The key from the checklist.'), R('Then', 'Username + password from step 1', ''),
          R('Test', `Address from ${pool.first} - ${pool.last}`, 'Connect, check the assigned address, then reach an allowed network.')] }];
    const table = { title: 'What to check', rows: [
      R('Tunnel is up when a user connects', 'VPN > VPN Tunnels', 'Status Up, the user is listed.'),
      R('IKE/IPsec SAs', 'get vpn ipsec tunnel summary; diagnose vpn ike gateway list', 'The tunnel is shown with selectors up.'),
      R('User can reach the server', 'diagnose debug flow (filter on the client IP), or Policy Match', 'Matches the RemoteStaff policy, not the implicit deny (0).'),
      R('No access beyond scope', 'Policy Match: client IP to staff/guest subnet', 'Denied.'),
      R('Logs recorded', 'Log & Report > Forward Traffic; System Events (VPN events)', 'Sessions show the policy ID and the user.', { approx: true }),
      R('Weak crypto gone', 'Edit tunnel > Phase 1 proposal', 'No SHA1/DES/MD5, DH 14 or higher.')] };
    const mistakes = ['Licensing: the free FortiClient VPN-only app has limited IPsec support (check the current FortiClient licence and version, a paid FortiClient may be needed).', 'The client range overlaps a LAN: pick an unused block.', 'Split tunnel off by accident: all home traffic goes through the office.', 'The policy service is left as ALL: narrow it to what staff use.', 'The user is not in the group: the user cannot log in.', 'A short pre-shared key: use 12+ random characters.'];
    return { computed, steps, table, mistakes, cli: Fmt.toRemoteFortiOS(result, project, project && project.ifName), cliNotes: Fmt.remoteNotes(result, project, project && project.ifName), note: NOTE };
  }

  return { NOTE, iface, vpn, checks, tunnelName };
}));
