# SubnetPal

Offline-first installable PWA that plans IP address ranges (VLSM) for firewall builds. FortiGate CLI export first, generic text otherwise. Vanilla HTML/CSS/JS, no framework, no build step, no dependencies.

## How to use (5 lines)

1. **Plan tab:** enter the parent block (e.g. `10.20.0.0/16`), or pick a preset to start a new project.
2. Add networks (name, hosts needed, optional VLAN and role); reorder with the arrows. Set gateway position, growth %, static reserve and DHCP offset.
3. The plan recalculates as you type. Errors (bad CIDR, 0 hosts, duplicate names, doesn't fit) show at the top with the offending field in red.
4. **Results / Map / Handover tabs:** per-network detail (cards on phones), the colour-coded address bar with free space hatched, and a client-ready table (Copy Markdown or Print).
5. **Export tab:** set the interface name placeholder once, then copy CSV, Markdown, FortiOS CLI or generic text. Projects save automatically on this device; use the project bar for multiple named projects.

## Install on iPhone

1. Deploy it (below) and open the `https://<you>.github.io/subnetpal/` URL **in Safari** (not Chrome).
2. Wait for the green **Offline ready** pill at the top.
3. Tap Share, then **Add to Home Screen**, then Add. Launch it from the icon; it runs full-screen and works in airplane mode.

## Run locally

```
node calc.test.js          # unit tests
node tools/serve.js 8080   # http://localhost:8080
node tools/make-icons.js   # regenerate icons (only if you change the design)
```

## Deploy to GitHub Pages

From this folder in PowerShell (needs [GitHub CLI](https://cli.github.com): `winget install GitHub.cli`, then `gh auth login` once):

```powershell
git init -b main; git add .; git commit -m "SubnetPal"
gh repo create subnetpal --public --source=. --push
gh api -X POST "repos/{owner}/subnetpal/pages" -f "source[branch]=main" -f "source[path]=/"
```

The site is live at `https://<your-github-username>.github.io/subnetpal/` after about a minute. Without `gh`: create an empty repo named `subnetpal` on github.com, `git remote add origin https://github.com/<you>/subnetpal.git`, `git push -u origin main`, then Settings, Pages, Deploy from branch `main` / root.

**Netlify alternative:** drag this folder onto https://app.netlify.com/drop and open the URL it gives you.

**Shipping changes:** bump `CACHE` in `sw.js` (e.g. `subnetpal-v2`), commit and push. Installed copies update on their next online open (cache-first with background refresh, so the new version appears on the launch after).

## Assumptions

- **Sizing:** needed = hosts + ceil(hosts x growth%) + network + broadcast + gateway; round up to a power of two; smallest block is /30. Growth buffer is not applied to /31 or /32.
- **/31 and /32:** role **Transit** with 2 or fewer hosts gets a /31 (RFC 3021: both addresses usable, no gateway, no broadcast). I added a **Loopback** role (1 host) that gets a /32. Transit with more than 2 hosts is sized as a normal subnet, with a warning.
- **Allocation:** largest first, ties keep list order, each block aligned to its own size. Results are shown in address order. Because blocks are placed largest-first, free space ends up at the end of the parent block, so "gaps between allocations" only appear when allocations leave a hole (the gap detector handles that generally and is unit-tested directly).
- **"Parent block overlaps itself"** is interpreted as: a parent with host bits set (e.g. `10.20.0.5/16`) is rejected with the corrected network suggested, and an internal overlap check runs over every plan. Overlap detection (`findOverlaps`) is unit-tested.
- **Static range:** the first N addresses of the host range after the gateway (default 10). With gateway *last*, the static range starts at the first usable address. Clamped to the network size with a warning.
- **DHCP range:** starts after the static reserve plus the DHCP offset and runs to the last host address (excluding a last-position gateway). Only **LAN, Guest and un-roled** networks get DHCP. DMZ, Mgmt, WAN, Transit and Loopback get static addressing only. Small networks (/29 and under) can end up with no DHCP room; a warning says so.
- **Usable hosts** = total - 2 (the gateway counts as usable); /31 = 2; /32 = 1.
- **FortiOS snippet:** one placeholder (`PORT_CHANGE_ME` by default) is the parent port for VLAN sub-interfaces (named `vlan<ID>`), or the interface name for non-VLAN networks (numbered if there are several). Roles map as LAN/Guest/Mgmt to `lan`, DMZ to `dmz`, WAN to `wan`, Transit/Loopback to `undefined`. `allowaccess` is `ping https ssh` for LAN/Mgmt, `ping` for the rest. Always verify against the FortiOS 8.0 docs; the snippet is a planning aid and has not been tested on a device.
- **Validation:** hosts must be a whole number of at least 1; VLAN 1-4094; names required and unique (case-insensitive); growth 0-500%. Duplicate VLAN IDs and non-RFC1918 parents are warnings, not errors. IPv4 only.
- **Storage:** projects live in `localStorage` on the device (nothing is sent anywhere). Clearing Safari website data deletes them; use Export to keep copies. The last-edited project reopens on launch.
- **Offline:** service worker precaches all 11 files; cache-first with background refresh. iOS may evict site data for PWAs unused for a long time.
