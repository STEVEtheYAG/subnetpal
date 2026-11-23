/* SubnetPal - plain-language client report (printable HTML, "Save as PDF" friendly). Pure, no DOM. window.ClientReport / Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./access.js'), require('./remote.js'), require('./policy.js'), require('./webcat.js'), require('./cards.js'));
  else root.ClientReport = factory(root.Access, root.Remote, root.Policy, root.Webcat, root.Cards);
}(typeof self !== 'undefined' ? self : this, function (Access, Remote, Policy, Webcat, Cards) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n).toLocaleString('en-GB');
  const n0 = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;

  // Plain-English wording for each kind of network. No technical terms.
  const KIND = {
    staff: { label: 'Staff', who: 'Your staff and the computers, laptops and phones they use every day.' },
    lan: { label: 'Staff', who: 'Your staff and the computers, laptops and phones they use every day.' },
    servers: { label: 'Servers', who: 'Your on-site servers. Staff can use them, but guests and the internet cannot.' },
    guest: { label: 'Guests', who: 'Visitors using your guest Wi-Fi. They get internet only and cannot see your own systems.' },
    dmz: { label: 'Public servers', who: 'Servers that the outside world needs to reach, such as a website. Kept apart so a problem here cannot spread to your own systems.' },
    voice: { label: 'Phones', who: 'Your office phones. Kept separate so calls stay clear and are not affected by other traffic.' },
    cameras: { label: 'Cameras', who: 'Security cameras. Kept off the staff network and only able to talk to the recording server.' },
    iot: { label: 'Smart devices', who: 'Smart or connected gadgets such as sensors and displays. Isolated so one weak device cannot reach staff or servers.' },
    printers: { label: 'Printers', who: 'Your printers and copiers. Staff can print to them, but the printers cannot reach anything else.' },
    pos: { label: 'Card payments', who: 'Your card terminals. Kept completely apart from everything else, with access to the payment provider only.' },
    mgmt: { label: 'Network equipment', who: 'The firewall, switches and Wi-Fi access points. Locked down so only administrators can reach them.' },
    transit: { label: 'Link to other equipment', who: 'A small private link that joins the firewall to your internet provider’s or another site’s equipment.' },
    loopback: { label: 'Firewall identity', who: 'A private address that gives the firewall a fixed identity on the network. No devices connect here.' },
  };
  const kindInfo = a => Access.kindOf(a) === 'other'
    ? { label: a.name, who: `A separate network for your ${a.name} devices. Kept apart from staff and servers, with internet access only.` }
    : KIND[Access.kindOf(a)] ||{ label: a.name, who: 'Added to suit your site.' };

  const EXP_PLAIN = {
    none: 'No major growth expected. A small safety margin was added.',
    soon: 'Growth is expected soon. Extra room was added to each network.',
    big: 'Big growth is expected. Each network was sized to roughly double.',
  };
  const COUNT_PLAIN = { staff: ['staff member', 'staff'], wired: ['wired device', 'wired devices'], wifi: ['Wi-Fi device', 'Wi-Fi devices'], voice: ['phone', 'phones'], cameras: ['camera', 'cameras'], iot: ['smart device', 'smart devices'], servers: ['server', 'servers'], guest: ['guest user', 'guest users'], dmz: ['public-facing server', 'public-facing servers'], printers: ['printer', 'printers'], pos: ['card terminal', 'card terminals'] };
  const SEP_PLAIN = { guest: 'Separate guest Wi-Fi', dmz: 'Servers the public can reach, kept apart', voice: 'Separate phone network', cameras: 'Separate camera network', iot: 'Separate network for smart devices', printers: 'Separate network for printers', pos: 'Card payments kept completely separate' };

  // ---- the firewall rules, in plain words ----
  const SERVICE_PLAIN = { ALL: 'all kinds of traffic', DNS: 'name lookups', HTTP: 'web browsing', HTTPS: 'web browsing', NTP: 'clock synchronisation', SSH: 'secure remote administration', RDP: 'remote desktop',
    SMB: 'file sharing', SMTP: 'sending email', PING: 'connection tests', FTP: 'file transfer', MYSQL: 'database traffic', 'MS-SQL': 'database traffic' };
  function servicesPlain(list) {
    const out = []; (list || []).forEach(s => { const t = SERVICE_PLAIN[s] || s.toLowerCase(); if (out.indexOf(t) < 0) out.push(t); });
    if (!out.length || out.indexOf(SERVICE_PLAIN.ALL) >= 0) return '';
    return out.length === 1 ? out[0] : out.slice(0, -1).join(', ') + ' and ' + out[out.length - 1];
  }
  const webPlain = g => { // "dangerous websites and adult content blocked; time-wasters shown with a warning"
    const gs = Webcat.normGroups(g), by = a => Webcat.GROUPS.filter(x => gs[x.id] === a).map(x => x.plain.toLowerCase());
    const join = l => (l.length > 1 ? l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1] : l[0]);
    const parts = []; if (by('block').length) parts.push(join(by('block')) + ' blocked'); if (by('warn').length) parts.push(join(by('warn')) + ' shown with a warning');
    return parts.join('; ');
  };
  // One row per firewall rule: what it does, why it is there, and the website checks on it. [] when the list is empty.
  function rulesRows(allocs, project) {
    const label = a => (a === 'internet' ? 'the internet' : a === 'internal' ? 'all your internal networks' : kindInfo(a).label);
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    return Policy.resolve(Policy.effective(project, allocs), allocs).pols.map(p => {
      const card = p.card && Cards.byId(p.card), svc = servicesPlain(p.services);
      const does = p.action === 'deny' ? `${cap(label(p.from))} cannot reach ${label(p.to)}` : `${cap(label(p.from))} can reach ${label(p.to)}${svc ? ', for ' + svc + ' only' : ''}`;
      const web = p.action === 'accept' && p.to === 'internet' && p.webf && Webcat.entries(p.webf.groups).length ? webPlain(p.webf.groups) : '';
      return { allowed: p.action === 'accept', does, why: card ? card.why : 'Added to suit your site.', web };
    });
  }

  const range = a => (a.prefix === 32 ? a.firstUsable : `${a.firstUsable} to ${a.lastUsable}`);
  const exitPoint = a => a.gateway || 'Not needed';

  // "In short" sentence for one source network.
  function shortSays(row, names) {
    const to = [];
    if (row.internet) to.push('the internet');
    row.cells.forEach((c, i) => { if (c === true) to.push(names[i]); });
    if (!to.length) return 'Can only talk to itself';
    if (to.length === 1) return to[0] === 'the internet' ? 'Internet only' : `${to[0][0].toUpperCase()}${to[0].slice(1)} only`;
    return `Can reach ${to.slice(0, -1).join(', ')} and ${to[to.length - 1]}`;
  }

  function table(head, rows, cls) {
    return `<table class="${cls || ''}"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>` +
      rows.map(r => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${c}</th>` : `<td>${c}</td>`)).join('')}</tr>`).join('') + '</tbody></table>';
  }

  const CSS = `
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1d2433;background:#eef1f6}
.bar{position:sticky;top:0;background:#1d2433;color:#fff;padding:10px 16px;display:flex;gap:12px;align-items:center;justify-content:space-between;z-index:5}
.bar span{font-size:14px;opacity:.85}
.bar button{font:inherit;font-weight:600;border:0;border-radius:8px;padding:9px 16px;background:#4da3ff;color:#06203f;cursor:pointer}
.page{max-width:820px;margin:16px auto;background:#fff;padding:40px 44px;box-shadow:0 2px 12px rgba(0,0,0,.12)}
.cover{min-height:620px;display:flex;flex-direction:column;justify-content:center}
.cover .kicker{letter-spacing:.12em;text-transform:uppercase;color:#4a5876;font-size:14px;font-weight:600}
.cover h1{font-size:40px;line-height:1.15;margin:12px 0 8px}
.cover .meta{margin-top:28px;font-size:18px;color:#3a4660}
.cover .meta b{display:inline-block;min-width:80px;color:#1d2433}
h2{font-size:24px;margin:0 0 12px;padding-bottom:6px;border-bottom:2px solid #1d2433}
h3{font-size:17px;margin:20px 0 6px}
p{margin:8px 0}
.note{color:#4a5876;font-size:14px}
table{width:100%;border-collapse:collapse;margin:10px 0;font-size:15px}
th,td{border:1px solid #c9d1e0;padding:8px 10px;text-align:left;vertical-align:top}
thead th{background:#e8edf6}
tbody th{font-weight:600;background:#f6f8fc}
table.grid td,table.grid thead th:not(:first-child){text-align:center}
.yes{color:#0b7a3b;font-weight:700}.no{color:#8a93a6}
dl.req{display:grid;grid-template-columns:200px 1fr;gap:6px 16px;margin:0}
dl.req dt{font-weight:600}dl.req dd{margin:0}
.map{margin:12px 0;text-align:center}
.map svg{max-width:100%;height:auto}
ul{padding-left:22px;margin:8px 0}
.mono{font-family:ui-monospace,Consolas,Menlo,monospace;font-size:14px;white-space:nowrap}
section.page h2{margin-top:0}
@media (max-width:640px){.page{padding:24px 18px;margin:0}dl.req{grid-template-columns:1fr}.cover h1{font-size:30px}table{font-size:14px}.wide{overflow-x:auto}}
@page{size:A4;margin:16mm}
@media print{
  body{background:#fff;font-size:11pt}
  .bar{display:none}
  .page{max-width:none;margin:0;padding:0;box-shadow:none;page-break-after:always;break-after:page}
  .page:last-child{page-break-after:auto;break-after:auto}
  .cover{min-height:240mm}
  table,tr,.map,ul{page-break-inside:avoid;break-inside:avoid}
  thead{display:table-header-group}
  h2,h3{page-break-after:avoid;break-after:avoid}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}`;

  // svg = standalone light-theme SVG string for the map (optional).
  function build(result, project, svg) {
    project = project || {};
    const it = project.intake || {};
    const c = it.counts || {}, req = it.req || {};
    const allocs = result.allocations || [];
    const nets = allocs.filter(a => Access.hasPolicy(a));
    const name = (project.name || '').trim() || 'Your organisation';
    const site = (project.site || '').trim();
    const date = (project.date || '').trim();
    const expKey = it.expansion || 'none';

    // What you asked for
    const counts = Object.keys(COUNT_PLAIN).filter(k => n0(c[k]) > 0).map(k => plural(n0(c[k]), COUNT_PLAIN[k][0], COUNT_PLAIN[k][1]));
    (it.others || []).forEach(o => { if (n0(o && o.count) > 0 && String(o.name || '').trim()) counts.push(`${n0(o.count)} ${String(o.name).trim()}`); });
    const sep = Object.keys(SEP_PLAIN).filter(k => req[k]).map(k => SEP_PLAIN[k]);
    const existing = project.existing || [];
    const reqRows = [
      ['Devices to connect', counts.length ? counts.join(', ') : 'Not recorded'],
      ['Separate areas requested', sep.length ? sep.join('; ') : 'None beyond the standard set-up'],
      ['Room to grow', EXP_PLAIN[expKey] || EXP_PLAIN.none],
      ['Address space used', `${result.parent.cidr} (a private block, not used on the public internet)`],
      ['Existing addresses avoided', existing.length ? existing.join(', ') : 'None'],
      ['Newer internet addressing (IPv6)', result.v6 ? 'Included' : 'Not included'],
    ];

    // Networks table
    const netRows = allocs.map(a => [esc(a.name), esc(kindInfo(a).who), `<span class="mono">${esc(range(a))}</span>`, `<span class="mono">${esc(exitPoint(a))}</span>`]);

    // Who can reach what
    const m = Access.matrixFromPolicies(allocs, Policy.resolve(Policy.effective(project, allocs), allocs).pols);
    const names = m.cols;
    const mark = v => (v === 'self' ? '<span class="no">–</span>' : v ? '<span class="yes">Yes</span>' : '<span class="no">No</span>');
    const matrixRows = m.rows.map(r => [esc(r.name), esc(shortSays(r, names)), mark(r.internet)].concat(r.cells.map(mark)));
    const matrixHead = ['From', 'In short', 'Internet'].concat(names);

    // Room to grow
    const s = result.summary;
    const growRows = nets.map(a => {
      const spare = Math.max(0, a.usableHosts - (a.gateway ? 1 : 0) - a.hosts);
      return [esc(a.name), esc(`${num(a.hosts)} planned`), esc(`Room for about ${num(spare)} more`)];
    });

    const wan = (it.wanNote || '').trim();

    // Remote working (only when remote staff were ticked)
    const vpn = Remote.plan(result, project);
    // Sections after "4. Who can reach what" are numbered in order, whichever of them apply to this client.
    const polRows = rulesRows(allocs, project);
    let sn = 4; const rulesNo = polRows.length ? ++sn : 0, growNo = ++sn;
    let remoteSec = '', remoteNo = 0;
    if (vpn && vpn.ok) {
      remoteNo = ++sn;
      reqRows.splice(3, 0, ['Remote staff', `${num(vpn.staff)} ${vpn.staff === 1 ? 'person' : 'people'} working away from the office, over a secure connection`]);
      netRows.push([esc('Remote staff'), esc('People working from home or on the road. They connect over the secure link and are given an address from this reserved range.'),
        `<span class="mono">${esc(vpn.first)} to ${esc(vpn.last)}</span>`, '<span class="mono">Not needed</span>']);
      const clash = Remote.warnings(result, project);
      remoteSec = `<section class="page">
  <h2>${remoteNo}. Remote working</h2>
  <p>${esc(plural(vpn.staff || 2, 'person', 'people'))} will work away from the office. They connect over a secure, encrypted link (a VPN). Each person is given an address from a reserved range, <b class="mono">${esc(vpn.first)} to ${esc(vpn.last)}</b>. It has room for about ${esc(num(vpn.usable))} people, which includes a ${esc(vpn.growth)}% allowance for growth.</p>
  <p><b>What remote staff can reach:</b> ${vpn.reach.length ? esc(vpn.reach.join(', ')) : 'nothing inside the office yet'}. Only traffic for those areas travels through the secure link. Everything else, such as ordinary web browsing, uses their own home internet.</p>
  <p><b>Home networks:</b> we avoid the address ranges most home routers use (for example ${esc(Remote.HOME_RANGES.slice(0, 3).join(', '))}), so a person's home network does not get in the way when they connect.</p>
  ${clash.length ? '<p class="note"><b>One thing to check:</b> part of your existing set-up uses an address range that many home routers also use. Staff whose home network uses the same range may have trouble reaching it and might need to change their home router’s range.</p>' : ''}
</section>`;
    }

    // Web protection (only when some network has a web filter profile)
    const webPols = Policy.resolve(Policy.effective(project, allocs), allocs).pols.filter(p => p.action === 'accept' && p.to === 'internet' && p.webf && Webcat.entries(p.webf.groups).length);
    let webSec = '';
    const webNo = webPols.length ? ++sn : 0, wanNo = ++sn;
    if (webPols.length) {
      const rows = webPols.map(p => [esc(p.from.name)].concat(Webcat.GROUP_IDS.map(g => { const a = p.webf.groups[g]; return `<span class="${a === 'block' ? 'no' : a === 'warn' ? '' : 'yes'}">${esc(Webcat.ACTION_PLAIN[a])}</span>`; })));
      const ind = Webcat.INDUSTRY_WHY[it.industry];
      webSec = `<section class="page">
  <h2>${webNo}. Web protection</h2>
  <p>The firewall checks the type of website before a device is allowed to visit it, so risky and unwanted sites are stopped before they load. Each kind of site belongs to one of five groups, and each area of your network is set differently:</p>
  <ul>${Webcat.GROUPS.map(g => `<li><b>${esc(g.plain)}:</b> ${esc(g.says)}</li>`).join('')}</ul>
  <div class="wide">${table(['Network'].concat(Webcat.GROUPS.map(g => g.plain)), rows, 'grid')}</div>
  <p>${esc(Webcat.ACTION_PLAIN.warn)} means the person sees a warning first and can choose to carry on.</p>
  ${ind ? `<p><b>Set for your type of site:</b> ${esc(ind)}</p>` : ''}
  <p class="note">Website checking relies on a subscription to the firewall maker’s website rating service, and the final choices will be agreed with you before they are switched on.</p>
</section>`;
    }

    const sub = [site, date].filter(Boolean).join(' · ');
    return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(name)} - Network design summary</title><style>${CSS}</style></head><body>
<div class="bar"><span>Use Save as PDF in the print window to keep a copy.</span><button type="button" id="printBtn">Print / Save as PDF</button></div>

<section class="page cover">
  <div class="kicker">Network design summary</div>
  <h1>${esc(name)}</h1>
  <div class="meta">
    <p><b>Client</b> ${esc(name)}</p>
    <p><b>Site</b> ${esc(site || 'Not recorded')}</p>
    <p><b>Date</b> ${esc(date || 'Not recorded')}</p>
  </div>
  <p class="note" style="margin-top:40px">This document explains, in plain language, how your network has been planned: which areas it has, who they are for, and what each can reach.</p>
</section>

<section class="page">
  <h2>1. What you asked for</h2>
  <dl class="req">${reqRows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
</section>

<section class="page">
  <h2>2. Your network map</h2>
  <p>Everything connects through the firewall, which protects the network and links it to the internet. Each box below is a separate area of your network.</p>
  <div class="map">${svg || '<p class="note">The map is not available.</p>'}</div>
</section>

<section class="page">
  <h2>3. Your networks</h2>
  <p>Each area of the network has its own range of addresses. Every device is given one address from its area. The <b>exit point</b> is the address devices use to leave their own area, for example to reach the internet.</p>
  <div class="wide">${table(['Network', 'Who it is for', 'Address range', 'Exit point'], netRows)}</div>
</section>

<section class="page">
  <h2>4. Who can reach what</h2>
  <p>This shows what each area is allowed to connect to. Keeping areas apart limits the damage if one device has a problem.</p>
  <div class="wide">${table(matrixHead, matrixRows, 'grid')}</div>
  <p class="note">These are the starting rules. The final rules will be agreed with you before they are switched on.</p>
</section>

${polRows.length ? `<section class="page">
  <h2>${rulesNo}. The firewall rules, in plain language</h2>
  <p>The firewall decides what is allowed through. Its rules are checked from top to bottom, and anything not listed is blocked. Each rule is below with the reason it is there.</p>
  <div class="wide">${table(['What the rule does', 'Why it is there'], polRows.map(r => [`<span class="${r.allowed ? 'yes' : 'no'}">${r.allowed ? 'Allowed' : 'Blocked'}</span> · ${esc(r.does)}${r.web ? `<br><span class="note">Website checks: ${esc(r.web)}.</span>` : ''}`, esc(r.why)]))}</div>
  <p class="note">These are the starting rules, chosen from what you told us about your site. The final rules will be agreed with you before they are switched on.</p>
</section>` : ''}

<section class="page">
  <h2>${growNo}. Room to grow</h2>
  <p>${esc(EXP_PLAIN[expKey] || EXP_PLAIN.none)}</p>
  <div class="wide">${table(['Network', 'Devices planned', 'Spare space'], growRows)}</div>
  <p>Space is also held back for future areas: about <b>${esc(num(s.free))}</b> unused addresses${s.largestFree ? ' are still available' : ''}, so new areas such as another office or a new group of devices can be added without redoing what is here.</p>
  ${result.v6 ? '<p>Your networks are also ready for the newer style of internet addressing (IPv6). It has so much room that it never needs a growth allowance.</p>' : ''}
</section>

${remoteSec}
${webSec}
<section class="page">
  <h2>${wanNo}. Internet connection and remote access</h2>
  ${wan ? `<p>${esc(wan).replace(/\r?\n/g, '<br>')}</p>` : '<p>No details about your internet connection or remote-access (VPN) needs have been recorded yet. These will be added once they are confirmed.</p>'}
  <p class="note">The internet connection is not part of the address plan above. It is set up using the details your internet provider gives us.</p>
</section>
<script>document.getElementById('printBtn').addEventListener('click',function(){window.print()})</script>
</body></html>`;
  }

  return { build, KIND, shortSays };
}));
