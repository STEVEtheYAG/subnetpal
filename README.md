# SubnetPal

Offline-first installable PWA for client-intake-driven IP planning (VLSM) on firewall builds. It turns a client intake into a network plan, a plain-language client report and a FortiOS CLI snippet. Vanilla HTML/CSS/JS, no framework, no build step, no dependencies.

## How to use

SubnetPal is one page. On a tablet or desktop the intake is a fixed left panel and the results scroll on the right, updating live as you type. On a phone the intake is a top section that collapses to a one-line summary ("Client: Acme · 5 networks") once you tap **Done**; tap the line to reopen it.

1. **Intake (left):** client name, site, staff count and expected growth (None 25% / Soon 50% / Big growth 100% buffer). Tick **Guest wifi, Servers, DMZ, Voice / phones, Cameras or IoT** to add that network; a count box appears only when the box is ticked. **+ Other** adds your own device pool (a name and a count, up to 10): each becomes its own network on the next free VLAN (90, 100, 110...), internet-only like IoT, reachable from Management, with a blank name becoming "Other n" and a blank count sized for 2. Staff LAN, Management and Transit/loopback are always planned. **More detail** holds existing IP ranges, the WAN/VPN note (client report only), the addressing style, an address block override and IPv6.
2. **Results (right)** are five tabs ("bookmarks") along the top, showing one section at a time: **Plan** (address map plus one card per network; tap a card for DHCP, static, broadcast, wildcard and host counts; tap any IP on a card to copy it), **Diagram** (the network diagram, SVG download or copy), **Policies** (firewall policies, below), **Remote** (IPsec remote access, below) and **Export** (the **Generate client documentation** button, plus FortiOS CLI, CSV and text, each with a Copy button).
3. The tab bar (Plan, Diagram, Export) stays pinned to the top of the results on desktop; there is no floating bar and nothing collapses. Plan is shown on load.
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

`topology.js` network map SVG · `calc.js` subnet maths (no DOM) · `calc6.js` IPv6 layer (BigInt, no DOM) · `intake.js` intake to networks, parent auto-pick, sample clients · `access.js` network kinds, access rules, "why" lines · `format.js` CSV, text, FortiOS · `report.js` plain-language client report (printable HTML, no DOM) · `policy.js` policy model, defaults and tagline parser (no DOM) · `remote.js` home ranges, VPN pool, split tunnel (no DOM) · `app.js` UI · `sw.js` offline · `calc.test.js` tests.

## Assumptions

**Planning**
- **Sizing:** needed = hosts + ceil(hosts x growth%) + network + broadcast + gateway, rounded up to a power of two; smallest block /30. Growth is not applied to /31 or /32.
- **Expansion:** None = 25%, Soon = 50%, Big growth = 100% (sets the growth buffer; it is used for sizing in packed style and for the "room to grow" figures in the client report).
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

**Access rules (client report grid and FortiOS starter policies)**
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
- **Other pools:** stored in `intake.others` (`{name, count}`), names trimmed to 20 characters and made unique, so a pool never clashes with a built-in network. Their policy is fixed to the IoT rule (internet only, no access to other networks); change it by hand in FortiOS if a pool needs more.
- **Tap-to-copy:** each IP on a network card (usable range start and end, port/gateway IP, netmask) is a button. A tap copies it and shows a short "Copied" toast (the address itself does not change or animate). It uses `navigator.clipboard` and falls back to a hidden textarea and `execCommand('copy')`, so it works offline and on plain http. If both are blocked it says so. The extra detail rows (DHCP, static, broadcast, IPv6) are not tappable.
- **Policies tab:** a policy is Source, Destination (a network, "All internal networks" or the Internet), Service, Action, NAT, Log, plus optional website and application profiles. Until you edit anything the list is the default access rules for the plan (the old starter policies) and follows the plan; the first edit freezes it as your own list (stored in `client.pol`), and **Reset to defaults** goes back. Policies are ordered, first match wins, and a fixed `SP_Final_deny` is always last. A policy naming a network that is no longer in the plan stays in the list, is flagged, and is skipped in the CLI with a comment. The old fixed starter policies are gone from the FortiOS export: it now exports this list (IPv6 mirrors it without profiles). **Copy policy CLI** copies just the address objects, profiles and policies; the full snippet is under Export.
- **Tagline parser (offline, rule-based, `policy.js`):** clauses are split on full stops, semicolons, commas and new lines. Network names are matched against the plan (case-insensitive, plural/singular, plus aliases such as guests/visitors, phones/voice, cctv, "the internet"). The first network named is always the source and the second the destination. Templates: "X internet only" / "...but nothing else" (accept to the internet plus a deny to internal, and it replaces X's other policies), "X can't / cannot / must not reach Y", "X blocked from Y", "X can reach Y [on https, ssh, web, dns, rdp, smb, email, ping...]". A service word it does not know, a single network name, or no known phrase makes the clause "not understood": it is listed with the reason, nothing is guessed, and you build the policy with the dropdowns. Parsed denies are put at the top, then accepts, replacing any existing policy with the same source and destination. "X and Y can ..." (two sources in one clause) is not supported.
- **Website and application profiles:** websites are a block-list or an allow-list (allow-list adds a final `*` block entry) built as a URL filter table plus web filter profile; applications are a category block-list or allow-list (allow-list ends with a catch-all block entry). They attach to Accept policies only, with `utm-status enable` and `certificate-inspection`. **FortiGuard web category IDs and application category IDs are from memory and unverified**, and the profile/table names (`SP_Web_n`, `SP_App_n`, URL filter table ids 101+) may clash with existing ones on a real unit. All policy output carries the "Generated, untested. Verify profile and setting names..." note.
- **Remote staff:** a "Remote staff (IPsec VPN)" tick in the intake with a count. VPN type is fixed to IPsec (IKEv2 dial-up, FortiGate as the server, local-user XAuth plus pre-shared key placeholders). An unticked box means no VPN output at all; ticked with no count sizes the pool for 2.
- **Home-range avoidance:** the list is in `remote.js` (`HOME_RANGES`: 192.168.0/1/2/10/100.0/24, 10.0.0.0/24, 10.0.1.0/24, 10.1.1.0/24, 172.16.0.0/24). The /16 auto-pick treats them as reserved, so it never picks 10.0.0.0/16, 10.1.0.0/16, 172.16.0.0/16 or 192.168.0.0/16 (the last-resort fall-backs the old picker could return). If you enter an office block by hand, or existing ranges, that overlap one of them, a "Remote-worker clash" banner appears, but only when Remote staff is ticked. It is a warning, not a block.
- **VPN pool:** remote staff plus the growth buffer (None 25%, Soon 50%, Big 100%), rounded up to the smallest block that holds it (minimum a /28, so 14 usable), taken from the top of the office /16 downwards, aligned, and outside every office network, existing range and home range. If the office block is full it uses a separate private /16 (shown as "separate block"). It is drawn as one card in Plan and as a dashed "Remote staff (VPN)" box in the Diagram, but not on the address-map bar. It is not an interface or a VLAN.
- **Split tunnel:** a tick list of the internal office networks (Staff and Servers ticked by default; Management and others available; Guest, DMZ, Transit and Loopback are never offered). Only those networks are pushed to remote staff (`ipv4-split-include`) and get a matching `SP_VPN_to_<network>` policy. Unticking everything removes the split-tunnel list and policies.
- **IPsec CLI:** phase1-interface (type dynamic, IKEv2, `aes256-sha256`, DH group 14, mode-cfg pool), phase2-interface, address objects, split-tunnel group and policies from `SP_VPN` to each ticked network, with PSK_CHANGE_ME and VPN_USERS_CHANGE_ME placeholders and the generated-untested note. It assumes the internet-facing interface is `wan1` like the policies do. Setting names are unverified: test on the lab VM.
- **Client report:** the VPN pool also appears in "What you asked for", the networks table and a plain-language "Remote working" section (who can reach what, home-network note and a gentle clash warning) when remote staff are ticked.
- **Client report (original notes):** the Handover section was removed. **Generate client documentation** (Export section) opens a separate printable page in a new tab (a blob page, so it works offline); use its Print / Save as PDF button. It is written for a non-technical reader: cover, what was asked for, the map, networks table (who it is for, address range, "exit point" = the gateway), a Yes/No grid of who can reach what, room to grow, and the WAN/VPN note. It has no VLAN IDs, masks, DHCP ranges or CLI; those stay in the Copy exports. The WAN/VPN note appears there only and is never planned. Purpose wording per network type is fixed text in `report.js`. If the browser blocks the new tab as a pop-up, allow pop-ups for the site. The old Markdown/HTML handover functions remain in `format.js` (tested) but have no button.
- **IPv6 (dual stack):** on by default for new clients; untick it on Intake for IPv4 only. Older saved clients without the setting stay IPv4 only until you tick it.
- **IPv6 site prefix:** a random private ULA `/48` (`fdxx:xxxx:xxxx::/48`, RFC 4193) is generated and kept with the client. Paste an ISP-delegated prefix to replace it. It must be `/56` or shorter. There is no existing-range avoidance for IPv6, because a random ULA does not clash in practice.
- **IPv6 numbering:** every network gets one `/64`, the standard size, so there is no IPv6 sizing or growth buffer. The subnet number is the VLAN written as hex digits, so VLAN 20 is `...:20::/64` and VLAN 70 is `...:70::/64`. Networks without a usable VLAN take the first free number and a warning says so. Transit is a `/127` in subnet `fe` and Loopback is a `/128` in subnet `ff`. The firewall takes `::1` on each network.
- **IPv6 hosts:** client networks (the ones that get DHCP in IPv4) send router advertisements so devices self-configure (SLAAC). No DHCPv6 is generated, and no static IPv6 reserve is planned.
- **IPv6 FortiOS:** adds `config ipv6` on each interface, `firewall address6`, `addrgrp6` and a `firewall policy6` mirror of the IPv4 starter policies (no NAT). `policy6` is assumed to exist in FortiOS 8.0, which is untested. If your build merges IPv6 into `firewall policy`, adapt that block. Same "Generated, untested" note applies.
- **IPv6 limits:** no IPv6 in the gaps list or the unused-space numbers, no inbound DMZ policy, no prefix delegation to downstream routers, and no IPv6 WAN address plan (the WAN note is free text).

- **Plan cards:** each card shows only name, type (VLAN n, Port, Transit or Loopback), usable range, port/gateway IP and netmask, with no CIDR and no device counts. DHCP, static, broadcast, wildcard, host counts and (when IPv6 is on) the IPv6 subnet are behind a tap. CIDR notation stays in the address-block summary, the unused-space detail and the exports.
- **Phone layout:** the intake collapses by itself on load only if the client already has a name and a staff count. The Done button collapses it at any time. Breakpoint is 900px: wider is the two-panel layout.
- **Tabs:** replaced the collapsible boxes and the floating "Jump to:" bar. Exactly one tab is always selected (Plan by default); the choice is not remembered between visits. On a phone the tab bar sits at the top of the results and scrolls with the page.