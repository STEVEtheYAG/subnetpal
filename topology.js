/* SubnetPal - graphical network map (SVG string). Pure, no DOM. window.Topology / Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./access.js'));
  else root.Topology = factory(root.Access);
}(typeof self !== 'undefined' ? self : this, function (Access) {
  'use strict';

  const THEMES = {
    dark: { bg: '', card: '#1f2832', line: '#44546a', text: '#e7edf3', mute: '#93a1b0', fw: '#173a5e', fwLine: '#4aa3ff', inet: '#22303d' },
    light: { bg: '#ffffff', card: '#f4f7fa', line: '#8796a6', text: '#111111', mute: '#555555', fw: '#dbeafe', fwLine: '#2563eb', inet: '#e5e7eb' },
  };
  const ZONE_COLOR = { internal: '#4aa3ff', guest: '#f5b942', dmz: '#ff6b6b', link: '#93a1b0' };
  const SECTIONS = [
    { key: 'internal', title: 'INTERNAL NETWORKS', zones: ['internal'] },
    { key: 'isolated', title: 'ISOLATED: INTERNET ONLY / DMZ', zones: ['guest', 'dmz'] },
    { key: 'links', title: 'LINKS', zones: ['link'] },
  ];

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

  function zoneOf(a) {
    const k = Access.kindOf(a);
    if (k === 'loopback') return null; // drawn inside the firewall box
    if (k === 'guest') return 'guest';
    if (k === 'dmz') return 'dmz';
    if (k === 'transit' || k === 'wan') return 'link';
    return 'internal';
  }

  // o: { cols, theme:'dark'|'light', color:(index)=>css, standalone:boolean }
  function build(result, project, o) {
    o = o || {};
    const T = THEMES[o.theme] || THEMES.dark;
    const colorOf = o.color || (() => '#4aa3ff');
    const names = ((project && project.networks) || []).map(n => String(n.name).trim());
    const cols = Math.max(1, Math.min(3, o.cols || 1));
    const plain = !!o.plain; // client-report mode: names and address ranges only, no VLAN/CIDR/gateway/IPv6 detail
    const cardW = cols === 1 ? 320 : 270, cardH = plain ? 62 : result.v6 ? 106 : 88, gap = 16, pad = 16, spineGap = 26;
    const x0 = pad + spineGap, gridW = cols * cardW + (cols - 1) * gap, W = x0 + gridW + pad;
    const cx = x0 + gridW / 2;
    const lo = plain ? null : result.allocations.find(a => Access.kindOf(a) === 'loopback');
    const fwH = lo ? 66 : 52, fwY = 92, fwW = 230;

    const out = [];
    const edges = [], nodes = [];
    // internet + firewall
    nodes.push(`<g><rect x="${cx - 80}" y="12" width="160" height="38" rx="19" fill="${T.inet}" stroke="${T.line}"/><text x="${cx}" y="36" text-anchor="middle" font-size="15" font-weight="700" fill="${T.text}">Internet</text></g>`);
    edges.push(`<path d="M${cx} 50 V${fwY}" stroke="${T.line}" stroke-width="2" fill="none"/><text x="${cx + 8}" y="76" font-size="11" fill="${T.mute}">${plain ? 'Internet connection' : 'WAN'}</text>`);
    nodes.push(`<g><rect x="${cx - fwW / 2}" y="${fwY}" width="${fwW}" height="${fwH}" rx="10" fill="${T.fw}" stroke="${T.fwLine}" stroke-width="2"/>` +
      `<text x="${cx}" y="${fwY + 24}" text-anchor="middle" font-size="16" font-weight="700" fill="${T.text}">Firewall</text>` +
      (lo ? `<text x="${cx}" y="${fwY + 46}" text-anchor="middle" font-size="12" fill="${T.mute}" font-family="monospace">Loopback ${esc(lo.network)}/32</text>` : plain ? '' : `<text x="${cx}" y="${fwY + 42}" text-anchor="middle" font-size="12" fill="${T.mute}">${esc(result.parent.cidr)}</text>`) + '</g>');

    let y = fwY + fwH + 22;
    const spineX = pad + 6;
    let lastBus = null;
    const spineTop = fwY + fwH;
    let anyRow = false;
    SECTIONS.forEach(sec => {
      if (plain && sec.key === 'links') return;
      const items = result.allocations.filter(a => sec.zones.indexOf(zoneOf(a)) >= 0);
      if (!items.length) return;
      const title = plain ? (sec.key === 'internal' ? 'YOUR NETWORKS' : 'KEPT APART FOR SAFETY') : sec.title;
      nodes.push(`<text x="${x0}" y="${y + 6}" font-size="11" font-weight="700" letter-spacing="1" fill="${T.mute}">${esc(title)}</text>`);
      y += 22;
      for (let r = 0; r < items.length; r += cols) {
        const row = items.slice(r, r + cols);
        const busY = y + 6;
        y += 20;
        const lastCx = x0 + (row.length - 1) * (cardW + gap) + cardW / 2;
        edges.push(`<path d="M${spineX} ${busY} H${lastCx}" stroke="${T.line}" stroke-width="2" fill="none"/>`);
        lastBus = busY; anyRow = true;
        row.forEach((a, i) => {
          const x = x0 + i * (cardW + gap), zone = zoneOf(a), zc = ZONE_COLOR[zone];
          const ci = Math.max(0, names.indexOf(a.name));
          edges.push(`<path d="M${x + cardW / 2} ${busY} V${y}" stroke="${zc}" stroke-width="2" fill="none"${zone === 'link' ? ' stroke-dasharray="5 4"' : ''}/>`);
          const max = Math.floor((cardW - 34) / 7.6);
          const sub = a.prefix === 31 ? 'Point-to-point /31' : `GW ${a.gateway || '-'} · ${a.hosts} planned`;
          const tag = `${a.vlan !== '' ? 'VLAN ' + a.vlan : 'No VLAN'}${a.role ? ' · ' + a.role : ''}`;
          if (plain) {
            const lastOct = String(a.lastUsable || '').split('.').pop();
            const rangeTxt = a.prefix === 32 ? a.firstUsable : `${a.firstUsable} to .${lastOct}`;
            nodes.push(`<g><rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="10" fill="${T.card}" stroke="${zc}" stroke-width="1.5"/>` +
              `<rect x="${x}" y="${y}" width="9" height="${cardH}" rx="4" fill="${colorOf(ci)}"/>` +
              `<text x="${x + 22}" y="${y + 26}" font-size="15" font-weight="700" fill="${T.text}">${esc(clip(a.name, max))}</text>` +
              `<text x="${x + 22}" y="${y + 47}" font-size="13" font-family="monospace" fill="${T.mute}">${esc(clip(rangeTxt, max + 6))}</text></g>`);
            return;
          }
          nodes.push(`<g><title>${esc(a.name)} ${esc(a.cidr)}${a.v6 ? ' ' + esc(a.v6.cidr) : ''}</title><rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="10" fill="${T.card}" stroke="${zc}" stroke-width="1.5"/>` +
            `<rect x="${x}" y="${y}" width="9" height="${cardH}" rx="4" fill="${colorOf(ci)}"/>` +
            `<text x="${x + 22}" y="${y + 23}" font-size="14" font-weight="700" fill="${T.text}">${esc(clip(a.name, max))}</text>` +
            `<text x="${x + 22}" y="${y + 41}" font-size="11.5" fill="${T.mute}">${esc(clip(tag, max + 4))}</text>` +
            `<text x="${x + 22}" y="${y + 60}" font-size="14" font-weight="700" font-family="monospace" fill="${T.text}">${esc(a.cidr)}</text>` +
            `<text x="${x + 22}" y="${y + 78}" font-size="11" font-family="monospace" fill="${T.mute}">${esc(clip(sub, max + 6))}</text>` +
            (a.v6 ? `<text x="${x + 22}" y="${y + 96}" font-size="11" font-family="monospace" fill="${T.mute}">${esc(clip('v6 ' + a.v6.cidr, max + 6))}</text>` : '') + '</g>');
        });
        y += cardH + 14;
      }
      y += 4;
    });
    if (anyRow) edges.unshift(`<path d="M${cx} ${spineTop} V${spineTop + 12} H${spineX} V${lastBus}" stroke="${T.line}" stroke-width="2" fill="none"/>`);
    const H = y + pad - 4;
    const size = o.standalone ? ` width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"` : ` style="width:100%;height:auto;max-width:${W}px;display:block;margin:0 auto"`;
    out.push(`<svg viewBox="0 0 ${W} ${H}"${size} role="img" aria-label="${plain ? 'Network map' : 'Network map of ' + esc(result.parent.cidr)}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">`);
    if (T.bg) out.push(`<rect width="${W}" height="${H}" fill="${T.bg}"/>`);
    out.push(edges.join(''), nodes.join(''), '</svg>');
    return out.join('');
  }

  return { build, zoneOf, ZONE_COLOR };
}));
