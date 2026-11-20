/* SubnetPal - firewall policy model: defaults from the plan, offline tagline parser, ordering. Pure, no DOM. window.Policy / Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./access.js'));
  else root.Policy = factory(root.Access);
}(typeof self !== 'undefined' ? self : this, function (Access) {
  'use strict';

  const NOTE = 'Generated, untested. Verify profile and setting names against the FortiOS 8.0 docs and the lab VM before applying. Starter policies are not production.';

  // value = comma list of FortiOS predefined service names
  const SERVICES = [
    { v: 'ALL', l: 'All services' }, { v: 'DNS,HTTP,HTTPS', l: 'Web + DNS' }, { v: 'HTTP,HTTPS', l: 'Web (HTTP, HTTPS)' },
    { v: 'DNS', l: 'DNS' }, { v: 'HTTP', l: 'HTTP' }, { v: 'HTTPS', l: 'HTTPS' }, { v: 'SSH', l: 'SSH' }, { v: 'RDP', l: 'RDP' },
    { v: 'SMB', l: 'SMB (file sharing)' }, { v: 'SMTP', l: 'SMTP (email)' }, { v: 'PING', l: 'Ping' }, { v: 'FTP', l: 'FTP' }, { v: 'NTP', l: 'NTP' },
  ];
  // FortiGuard web category and application category IDs. Unverified: check them on the lab VM.
  const WEB_CATS = [
    { id: 26, l: 'Malicious Websites' }, { id: 61, l: 'Phishing' }, { id: 59, l: 'Proxy Avoidance' }, { id: 37, l: 'Social Networking' },
    { id: 17, l: 'Gambling' }, { id: 20, l: 'Games' }, { id: 75, l: 'Streaming Media and Download' },
  ];
  const APP_CATS = [
    { id: 2, l: 'P2P' }, { id: 3, l: 'VoIP' }, { id: 5, l: 'Video/Audio' }, { id: 6, l: 'Proxy' }, { id: 7, l: 'Remote.Access' },
    { id: 8, l: 'Game' }, { id: 22, l: 'Storage.Backup' }, { id: 23, l: 'Social.Media' },
  ];

  const uid = () => 'p' + Math.random().toString(36).slice(2, 8);
  const blankProfile = () => ({ mode: '' });
  const mkPolicy = o => Object.assign({
    id: uid(), name: '', src: '', dst: 'internet', service: 'ALL', action: 'accept', nat: false, log: true,
    web: { mode: '', sites: '', cats: [] }, app: { mode: '', cats: [] },
  }, o);
  const dstLabel = p => (p.dst === 'internet' ? 'internet' : p.dst === 'internal' ? 'internal' : p.dst);
  const policyName = p => p.name || `${p.src} to ${dstLabel(p)}${p.action === 'deny' && p.dst === 'internal' ? ' (block)' : ''}`;

  // Sensible defaults: the access rules for this plan, as editable policies.
  function defaults(allocs) {
    return Access.policies(allocs || []).map(p => mkPolicy({
      name: p.name, src: p.from.name, dst: p.to === 'internet' || p.to === 'internal' ? p.to : p.to.name,
      service: p.services.join(','), action: p.action, nat: p.to === 'internet' && p.action === 'accept', log: true,
    }));
  }
  // Edited list wins; otherwise the defaults follow the plan.
  const effective = (project, allocs) => (project && project.pol && project.pol.edited ? project.pol.list : defaults(allocs));

  // Names usable as a source / destination in the dropdowns.
  const policyNets = allocs => (allocs || []).filter(Access.hasPolicy).map(a => a.name);

  // ---- tagline parser ----
  const KIND_ALIASES = {
    guest: ['guest', 'guests', 'guest wifi', 'guest wi-fi', 'visitors', 'visitor'],
    staff: ['staff', 'staff lan', 'employees', 'users', 'office'],
    servers: ['servers', 'server'],
    voice: ['voice', 'phones', 'phone', 'voip'],
    cameras: ['cameras', 'camera', 'cctv'],
    iot: ['iot', 'smart devices'],
    dmz: ['dmz', 'public servers'],
    mgmt: ['management', 'mgmt', 'admin network'],
  };
  const INTERNET_ALIASES = ['the internet', 'internet', 'wan', 'outside'];
  const SERVICE_WORDS = {
    https: 'HTTPS', http: 'HTTP', web: 'HTTP,HTTPS', dns: 'DNS', ssh: 'SSH', rdp: 'RDP', 'remote desktop': 'RDP', smb: 'SMB',
    'file sharing': 'SMB', ping: 'PING', icmp: 'PING', smtp: 'SMTP', email: 'SMTP', mail: 'SMTP', ftp: 'FTP', ntp: 'NTP', all: 'ALL', everything: 'ALL', any: 'ALL',
  };
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function aliasTable(allocs) {
    const rows = [];
    (allocs || []).filter(Access.hasPolicy).forEach(a => {
      const n = a.name.toLowerCase().trim();
      [n, n.replace(/s$/, ''), n + 's'].forEach(x => rows.push({ alias: x, target: a.name }));
      ((KIND_ALIASES[Access.kindOf(a)]) || []).forEach(x => rows.push({ alias: x, target: a.name }));
    });
    INTERNET_ALIASES.forEach(x => rows.push({ alias: x, target: 'internet' }));
    return rows.filter(r => r.alias).sort((a, b) => b.alias.length - a.alias.length);
  }
  function mentions(clause, table) {
    const used = [], out = [];
    table.forEach(({ alias, target }) => {
      const re = new RegExp('(^|[^a-z0-9])(' + esc(alias) + ')(?![a-z0-9])', 'g'); let m;
      while ((m = re.exec(clause))) {
        const s = m.index + m[1].length, e = s + alias.length;
        if (used.some(u => s < u[1] && e > u[0])) continue;
        used.push([s, e]); out.push({ pos: s, target });
      }
    });
    return out.sort((a, b) => a.pos - b.pos).map(x => x.target);
  }
  function serviceOf(clause) {
    const m = /\b(?:on|using|over|via)\s+(.+)$/.exec(clause);
    if (!m) return { service: 'ALL', rest: clause };
    const toks = m[1].split(/\s*(?:,|\+|\/|&|\band\b)\s*/).map(t => t.replace(/^(?:the|port|ports|protocol|protocols)\s+/, '').trim()).filter(Boolean);
    const names = [];
    for (const t of toks) { if (!SERVICE_WORDS[t]) return { error: `service "${t}" is not recognised` }; names.push(SERVICE_WORDS[t]); }
    const uniq = Array.from(new Set(names.join(',').split(',')));
    return { service: uniq.indexOf('ALL') >= 0 ? 'ALL' : uniq.join(','), rest: clause.slice(0, m.index).trim() };
  }

  // -> { policies:[{...policy, replaceSrc?}], unparsed:[{ text, why }] }
  function parse(text, allocs) {
    const table = aliasTable(allocs), policies = [], unparsed = [];
    const clean = String(text || '').toLowerCase().replace(/[‘’`]/g, "'")
      .replace(/,\s*(?:but|and)\s+(nothing|no)\b/g, ' but $1');
    clean.split(/[.;\n]+|,\s+/).map(s => s.trim()).filter(Boolean).forEach(raw => {
      const sv = serviceOf(raw);
      if (sv.error) { unparsed.push({ text: raw, why: sv.error }); return; }
      const clause = sv.rest, ms = mentions(clause, table);
      const hasNet = ms.filter(t => t !== 'internet');
      const netOk = t => (allocs || []).some(a => a.name === t && Access.hasPolicy(a));
      if (/internet only|only (?:the )?internet|only (?:access|reach|get|go to) (?:the )?internet|nothing else|no (?:other|internal) access/.test(clause) && hasNet.length && netOk(hasNet[0])) {
        const n = hasNet[0], k = Access.kindOf((allocs || []).find(a => a.name === n));
        policies.push(mkPolicy({ src: n, dst: 'internet', service: k === 'guest' ? 'DNS,HTTP,HTTPS' : 'ALL', action: 'accept', nat: true, replaceSrc: true }));
        policies.push(mkPolicy({ src: n, dst: 'internal', service: 'ALL', action: 'deny', nat: false, name: `${n} to internal (block)` }));
        return;
      }
      if (ms.length < 2) { unparsed.push({ text: raw, why: ms.length ? 'needs a second network or "the internet"' : 'no network names from the plan were found' }); return; }
      const [src, dst] = ms;
      if (src === 'internet') { unparsed.push({ text: raw, why: 'the source must be a network, not the internet' }); return; }
      if (/\b(can'?t|cannot|can not|can never|must not|mustn'?t|should not|shouldn'?t|may not|not allowed|isn'?t allowed|aren'?t allowed|no access|blocked|denied|deny|block|isolate|prevent)\b/.test(clause)) {
        policies.push(mkPolicy({ src, dst, service: sv.service, action: 'deny', nat: false })); return;
      }
      if (/\b(can|could|may|allowed|able|access|reach|talk to|connect)\b/.test(clause)) {
        policies.push(mkPolicy({ src, dst, service: sv.service, action: 'accept', nat: dst === 'internet' })); return;
      }
      unparsed.push({ text: raw, why: 'no recognised phrase (try "X can\'t reach Y", "X can reach Y on https", "X blocked from Y" or "X internet only")' });
    });
    return { policies, unparsed };
  }

  // Merge parsed policies into a list: same source+destination is replaced, denies go first, then accepts, then the rest.
  function apply(list, parsed) {
    let rest = list.slice();
    const done = new Set();
    parsed.policies.forEach(p => { if (p.replaceSrc && !done.has(p.src)) { done.add(p.src); rest = rest.filter(x => x.src !== p.src); } });
    parsed.policies.forEach(p => { rest = rest.filter(x => !(x.src === p.src && x.dst === p.dst)); });
    const clean = parsed.policies.map(p => { const c = Object.assign({}, p); delete c.replaceSrc; return c; });
    return clean.filter(p => p.action === 'deny').concat(clean.filter(p => p.action !== 'deny'), rest);
  }

  // List -> the shape the FortiOS exporter uses. Policies naming a network that is not in the plan are skipped.
  function resolve(list, allocs) {
    const by = new Map((allocs || []).filter(Access.hasPolicy).map(a => [a.name, a]));
    const pols = [], skipped = [];
    list.forEach(p => {
      const from = by.get(p.src), to = p.dst === 'internet' || p.dst === 'internal' ? p.dst : by.get(p.dst);
      if (!from || !to) { skipped.push(policyName(p)); return; }
      pols.push({
        id: p.id, name: policyName(p), action: p.action === 'deny' ? 'deny' : 'accept', from, to,
        services: String(p.service || 'ALL').split(',').map(s => s.trim()).filter(Boolean), nat: !!p.nat, log: p.log !== false,
        web: p.web && p.web.mode ? p.web : null, app: p.app && p.app.mode ? p.app : null,
      });
    });
    return { pols, skipped };
  }

  return { NOTE, SERVICES, WEB_CATS, APP_CATS, mkPolicy, policyName, defaults, effective, policyNets, parse, apply, resolve, blankProfile };
}));
