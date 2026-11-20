# SubnetPal

Offline-first installable PWA for client-intake-driven IP planning (VLSM) on firewall builds. It turns a client intake into a network plan, a client handover document and a FortiOS CLI snippet. Vanilla HTML/CSS/JS, no framework, no build step, no dependencies.

## How to use (5 lines)

1. **Clients** (home): tap **New client**, or add a sample client to see how it works. Open, duplicate or delete saved clients here.
2. **Intake:** client name, site, date, device counts per segment, existing ranges in use (one CIDR per line), expansion (None / Soon / Big growth) and requirement ticks. Add a WAN/VPN note (handover only).
3. **Generate plan:** picks a free private /16, then suggests Management, Staff LAN, Servers, Transit and Loopback plus any ticked networks with a count above 0. On the **Plan** screen, edit rows, VLANs and options; it recalculates live. Overlap with existing ranges shows as a red warning.
4. **Outputs:** Handover (Markdown, HTML or Print), FortiOS CLI, CSV, generic text. Each has a Copy button. Set the interface name placeholder once on the FortiOS tab.
5. Everything saves on the device automatically and works offline after the first load.

## Install on iPhone

1. Open the deployed `https://<you>.github.io/subnetpal/` URL **in Safari** (not Chrome).
2. Wait for the green **Offline ready** pill.
3. Tap Share, then **Add to Home Screen**, then Add. It opens full-screen and works in airplane mode.

## Run locally

```
node calc.test.js          # unit tests (52)
node tools/serve.js 8080   # http://localhost:8080
node tools/make-icons.js   # regenerate icons (only if you change the design)
```

## Deploy to GitHub Pages

```powershell
git add .; git commit -m "Client intake flow"; git push
```

First-time setup (once): install GitHub CLI (`winget install GitHub.cli`, reopen PowerShell, `gh auth login`), then `gh repo create subnetpal --public --source=. --push` and `gh api -X POST "repos/{owner}/subnetpal/pages" -f "source[branch]=main" -f "source[path]=/"`. Live at `https://<your-github-username>.github.io/subnetpal/`. Netlify alternative: drag this folder onto https://app.netlify.com/drop.

Installed copies update on their next online open (cache-first with background refresh, so the new version shows on the launch after). When you ship changes, bump `CACHE` in `sw.js` (currently `subnetpal-v2`).

## Files

`calc.js` subnet maths (no DOM) · `intake.js` intake to networks, parent auto-pick, sample clients · `access.js` network kinds, access rules, "why" lines · `format.js` CSV, text, FortiOS, handover doc · `app.js` UI · `sw.js` offline · `calc.test.js` tests.

## Assumptions

**Planning**
- **Sizing:** needed = hosts + ceil(hosts x growth%) + network + broadcast + gateway, rounded up to a power of two; smallest block /30. Growth is not applied to /31 or /32.
- **Expansion:** None = 25%, Soon = 50%, Big growth = 100% (sets the Growth buffer option; you can still change it on the Plan screen).
- **Allocation:** largest first, each block aligned to its own size, placed in the lowest free spot that avoids existing ranges. Results display in address order.
- **/31 and /32:** role Transit with 2 or fewer hosts is a /31 (no gateway, no broadcast). Role Loopback (1 host) is a /32.
- **Existing ranges:** they are reserved wherever they fall inside the parent block. If the parent overlaps one (only possible when you override the parent), the plan still avoids it and shows a red warning. Existing ranges that overlap each other give a warning.
- **Parent auto-pick:** first free `10.x.0.0/16`, trying 10.20 upward then 10.2 to 10.19, then 10.0 and 10.1, then 172.16 to 172.31, then 192.168.0.0/16. If every option clashes, enter one manually. Typing a parent switches to manual; **Auto-pick parent** switches back. Changing existing ranges on Intake re-picks an auto parent live.
- **Intake to networks:** Management, Staff LAN, Servers, Transit (/31) and Loopback (/32) are always suggested. Voice, Cameras, IoT, Guest and DMZ are added only if ticked and the count is above 0.
  - Staff LAN = staff + wired + Wi-Fi devices. Servers = servers (minimum 2). Management = 10 + 1 per 30 Wi-Fi devices (access points). DMZ has its own count field ("Public servers (DMZ)"), which I added.
  - A count for something that is not ticked is added to the Staff LAN (to Servers for DMZ) and noted on the Plan screen, so nothing is silently dropped. A ticked box with a count of 0 adds nothing and says so.
- **VLAN IDs:** Mgmt 10, Staff 20, Servers 30, Voice 40, Cameras 50, IoT 60, Guest 70, DMZ 80; Transit and Loopback none. All editable. Generating again resets them.
- **Static and DHCP:** static reserve is the first N addresses after the gateway (default 10, clamped on small networks with a warning). DHCP follows the static reserve plus the offset. DHCP is offered on Staff LAN, Voice, Cameras, IoT and Guest, and not on Management, Servers, DMZ, Transit or Loopback.
- **Editing:** editing any row marks the plan as edited, and Generate or Regenerate then asks before replacing it.

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
- **Validation:** hosts at least 1, VLAN 1-4094, names required and unique (case-insensitive), growth 0-500%, CIDRs strict (host bits set is an error). Duplicate VLAN IDs and non-RFC1918 parents are warnings. IPv4 only.
- **Handover doc:** Markdown for pasting, printable HTML for PDF via Print. The WAN/VPN note appears there only and is never planned.
