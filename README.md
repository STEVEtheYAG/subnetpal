# SubnetPal

Offline-first installable PWA for client-intake-driven IP planning (VLSM) on firewall builds. It turns a client intake into a network plan, a client handover document and a FortiOS CLI snippet. Vanilla HTML/CSS/JS, no framework, no build step, no dependencies.

## How to use

SubnetPal is one page. On a tablet or desktop the intake is a fixed left panel and the results scroll on the right, updating live as you type. On a phone the intake is a top section that collapses to a one-line summary ("Client: Acme · 5 networks") once you tap **Done**; tap the line to reopen it.

1. **Intake (left):** client name, site, staff count and expected growth (None 25% / Soon 50% / Big growth 100% buffer). Tick **Guest wifi, Servers, DMZ, Voice / phones, Cameras or IoT** to add that network; a count box appears only when the box is ticked. Staff LAN, Management and Transit/loopback are always planned. **More detail** holds existing IP ranges, the WAN/VPN note (handover only), the addressing style, an address block override and IPv6.
2. **Results (right)** are four collapsed sections, one open at a time: **Plan** (address map plus one card per network; tap a card for DHCP, static, broadcast, wildcard and host counts), **Diagram** (the network diagram, SVG download or copy), **Handover** (document for the client, Copy Markdown or HTML, Print / PDF) and **Export** (FortiOS CLI, CSV, text, each with a Copy button).
3. The floating **Jump to:** bar at the bottom (Plan, Diagram, Handover, Export) opens a section and smooth-scrolls to it.
4. The client menu at the top of the intake switches clients. Duplicate, delete and sample clients are under it. Everything saves on the device automatically and works offline after the first load.
5. One warning banner appears at the top of the results only when something is wrong (an overlap with an existing range, the plan does not fit, or the addressing style had to fall back).

## Install on iPhone

1. Open the deployed `https://<you>.github.io/subnetpal/` URL **in Safari** (not Chrome).
2. Wait for the green **Offline ready** pill.
3. Tap Share, then **Add to Home Screen**, then Add. It opens full-screen and works in airplane mode.

## Run locally

```
node calc.test.js          # unit tests (53)
node tools/serve.js 8080   # http://localhost:8080
node tools/make-icons.js   # regenerate icons (only if you change the design)
```

## Deploy to GitHub Pages

```powershell
git add .; git commit -m "Client intake flow"; git push
```

First-time setup (once): install GitHub CLI (`winget install GitHub.cli`, reopen PowerShell, `gh auth login`), then `gh repo create subnetpal --public --source=. --push` and `gh api -X POST "repos/{owner}/subnetpal/pages" -f "source[branch]=main" -f "source[path]=/"`. Live at `https://<your-github-username>.github.io/subnetpal/`. Netlify alternative: drag this folder onto https://app.netlify.com/drop.

Installed copies update on their next online open (cache-first with background refresh, so the new version shows on the launch after). When you ship changes, bump `CACHE` in `sw.js` (currently `subnetpal-v3`).

## Files

`topology.js` network map SVG · `calc.js` subnet maths (no DOM) · `calc6.js` IPv6 layer (BigInt, no DOM) · `intake.js` intake to networks, parent auto-pick, sample clients · `access.js` network kinds, access rules, "why" lines · `format.js` CSV, text, FortiOS, handover doc · `app.js` UI · `sw.js` offline · `calc.test.js` tests.

## Assumptions

**Planning**
- **Sizing:** needed = hosts + ceil(hosts x growth%) + network + broadcast + gateway, rounded up to a power of two; smallest block /30. Growth is not applied to /31 or /32.
- **Expansion:** None = 25%, Soon = 50%, Big growth = 100% (sets the growth buffer; it is used for sizing in packed style and for the spare-host notes in the handover).
- **Allocation:** largest first, each block aligned to its own size, placed in the lowest free spot that avoids existing ranges. Results display in address order.
- **/31 and /32:** role Transit with 2 or fewer hosts is a /31 (no gateway, no broadcast). Role Loopback (1 host) is a /32.
- **Existing ranges:** they are reserved wherever they fall inside the parent block. If the parent overlaps one (only possible when you override the parent), the plan still avoids it and shows a red warning. Existing ranges that overlap each other give a warning.
- **Parent auto-pick:** first free `10.x.0.0/16`, trying 10.20 upward then 10.2 to 10.19, then 10.0 and 10.1, then 172.16 to 172.31, then 192.168.0.0/16. If every option clashes, enter one manually. Typing an address block under More detail switches to manual; clearing it switches back to auto. Changing existing ranges on Intake re-picks an auto parent live.
- **Intake to networks:** Management, Staff LAN, Transit (/31) and Loopback (/32) are always planned. Servers, Guest, DMZ, Voice, Cameras and IoT are planned only when ticked. Servers is no longer always on.
  - Staff LAN = staff count. Every ticked network is sized from its count (minimum 2). Management = 10 hosts. DMZ and Servers get no DHCP range.
  - An unticked box is not planned, and any count typed earlier is ignored (the count box is hidden). A ticked box with no count is planned for 2 devices and a note says so (shown under "Unused space and notes").
  - The older wired and Wi-Fi counts are gone from the form. Clients saved earlier keep them and they are still added to the Staff LAN. Older clients keep Servers only if they had a servers count.
- **Addressing style (default one /24 per VLAN):** each network with a VLAN gets `<parent base>.<VLAN ID>.0/24`, so VLAN 20 in `10.20.0.0/16` is `10.20.20.0/24` with the gateway on `.1`. Transit (/31) and Loopback (/32) have no VLAN and share the third-octet-0 block (`10.20.0.0/31`, `10.20.0.2/32`). Every VLAN network is a /24 whatever its size, so the DHCP range simply fills the /24.
- **Fallback to packed VLSM:** if one /24 per VLAN is not possible, the plan uses the old packed VLSM and the warning banner says why. The reasons are: the parent is smaller than a /16, a VLAN ID is missing, above 255 or used twice, a network needs more than a /24 (over about 200 hosts with growth), or the /24 for a VLAN overlaps an existing range. You can also pick Packed yourself under More detail.
- **VLAN IDs:** Mgmt 10, Staff 20, Servers 30, Voice 40, Cameras 50, IoT 60, Guest 70, DMZ 80; Transit and Loopback none. All editable. Generating again resets them.
- **Static and DHCP:** static reserve is the first N addresses after the gateway (default 10, clamped on small networks with a warning). DHCP follows the static reserve plus the offset. DHCP is offered on Staff LAN, Voice, Cameras, IoT and Guest, and not on Management, Servers, DMZ, Transit or Loopback.
- **No row editing:** the plan is always generated from the intake, live, so the Plan section has no editable rows (VLAN IDs, names and per-network options are not editable). Changing the intake replaces the plan. The only manual override is the address block under More detail. Clients saved earlier are regenerated from their intake when opened, so hand-edited rows from the previous version are not kept.

**Access rules (handover matrix and FortiOS starter policies)**
- Staff: internet, Servers, DMZ. Servers: internet only. Voice: internet and Servers. Cameras: Servers only (no internet). IoT and Guest: internet only (Guest limited to DNS/HTTP/HTTPS). DMZ: internet only, explicitly blocked from internal networks. Guest is also explicitly blocked from internal networks.
- **Management restricted** is interpreted as: nothing else can reach Management; Management can reach internet and all other internal networks to administer them. Add an admin-workstation rule if admins connect from elsewhere.
- No inbound internet-to-DMZ policy is generated (it needs a VIP/port-forward decision). Transit and Loopback get no policies.

**FortiOS output (generated, untested)**
- Includes interfaces, DHCP servers, one firewall address object per subnet (`SP_<name>`), an `SP_INTERNAL` address group and starter policies, with the note "Generated, untested. Verify against FortiOS 8.0 docs and the lab VM before applying. Starter policies are not production rules." at the top and bottom.
- One placeholder field (`PORT_CHANGE_ME` by default) is the parent port for VLAN interfaces (named `vlan<ID>`) or the interface name for non-VLAN networks. The internet interface in policies is assumed to be `wan1`.
- `allowaccess` is `ping https ssh` for LAN and Mgmt and `ping` for the rest. Roles map to `lan`, `dmz`, `wan` or `undefined`. Deny policies come first; allow policies use NAT toward the internet and `logtraffic all`.

**App**
- **Storage:** clients live in `localStorage` (key `subnetpal.v2`) on the device. Nothing is sent anywhere. Clearing Safari website data deletes them, so copy outputs you need. The earlier "named projects" data (key `subnetpal.v1`) is not migrated.
- **Validation:** hosts at least 1, VLAN 1-4094, names required and unique (case-insensitive), growth 0-500%, CIDRs strict (host bits set is an error). Duplicate VLAN IDs and non-RFC1918 parents are warnings. The IPv4 plan is the source of truth; IPv6 is added on top (see below).
- **Handover doc:** Markdown for pasting, printable HTML for PDF via Print. The WAN/VPN note appears there only and is never planned.
- **IPv6 (dual stack):** on by default for new clients; untick it on Intake for IPv4 only. Older saved clients without the setting stay IPv4 only until you tick it.
- **IPv6 site prefix:** a random private ULA `/48` (`fdxx:xxxx:xxxx::/48`, RFC 4193) is generated and kept with the client. Paste an ISP-delegated prefix to replace it. It must be `/56` or shorter. There is no existing-range avoidance for IPv6, because a random ULA does not clash in practice.
- **IPv6 numbering:** every network gets one `/64`, the standard size, so there is no IPv6 sizing or growth buffer. The subnet number is the VLAN written as hex digits, so VLAN 20 is `...:20::/64` and VLAN 70 is `...:70::/64`. Networks without a usable VLAN take the first free number and a warning says so. Transit is a `/127` in subnet `fe` and Loopback is a `/128` in subnet `ff`. The firewall takes `::1` on each network.
- **IPv6 hosts:** client networks (the ones that get DHCP in IPv4) send router advertisements so devices self-configure (SLAAC). No DHCPv6 is generated, and no static IPv6 reserve is planned.
- **IPv6 FortiOS:** adds `config ipv6` on each interface, `firewall address6`, `addrgrp6` and a `firewall policy6` mirror of the IPv4 starter policies (no NAT). `policy6` is assumed to exist in FortiOS 8.0, which is untested. If your build merges IPv6 into `firewall policy`, adapt that block. Same "Generated, untested" note applies.
- **IPv6 limits:** no IPv6 in the gaps list or the unused-space numbers, no inbound DMZ policy, no prefix delegation to downstream routers, and no IPv6 WAN address plan (the WAN note is free text).

- **Plan cards:** each card shows only name, type (VLAN n, Port, Transit or Loopback), usable range, port/gateway IP and netmask, with no CIDR and no device counts. DHCP, static, broadcast, wildcard, host counts and (when IPv6 is on) the IPv6 subnet are behind a tap. CIDR notation stays in the address-block summary, the unused-space detail and the exports.
- **Phone layout:** the intake collapses by itself on load only if the client already has a name and a staff count. The Done button collapses it at any time. Breakpoint is 900px: wider is the two-panel layout.
- **Accordion:** the four result sections start collapsed and one opens at a time. Tapping a Jump to item opens that section (closing the others) and scrolls to it.