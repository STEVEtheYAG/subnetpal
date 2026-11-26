/* SubnetPal - firewall policy model: defaults from the plan, offline tagline parser, ordering. Pure, no DOM. window.Policy / Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./access.js'), require('./cards.js'), require('./suggest.js'), require('./webcat.js'));
  else root.Policy = factory(root.Access, root.Cards, root.Suggest, root.Webcat);
}(typeof self !== 'undefined' ? self : this, function (Access, Cards, Suggest, Webcat) {
  'use strict';

  const NOTE = 'Generated, untested. Verify profile and setting names against the FortiOS 8.0 docs and the lab VM before applying. Starter policies are not production.';

  // value = comma list of FortiOS predefined service names
  const SERVICES = [
    { v: 'ALL', l: 'All services' }, { v: 'DNS,HTTP,HTTPS', l: 'Web + DNS' }, { v: 'HTTP,HTTPS', l: 'Web (HTTP, HTTPS)' },
    { v: 'DNS', l: 'DNS' }, { v: 'HTTP', l: 'HTTP' }, { v: 'HTTPS', l: 'HTTPS' }, { v: 'SSH', l: 'SSH' }, { v: 'RDP', l: 'RDP' },
    { v: 'SMB', l: 'SMB (file sharing)' }, { v: 'SMTP', l: 'SMTP (email)' }, { v: 'PING', l: 'Ping' }, { v: 'FTP', l: 'FTP' }, { v: 'NTP', l: 'NTP' },
    { v: 'SP_PRINT', l: 'Printing (TCP 9100, 631, 515)' },
    { v: 'DNS,HTTP,HTTPS,NTP,PING', l: 'Internet basics (web, DNS, NTP, ping)' },
    { v: 'SP_QUIC', l: 'QUIC (UDP 443): skips web filter, off by default' },
  ];
  // Custom service objects SubnetPal creates itself (no FortiOS predefined service covers them). Emitted by format.js.
  const CUSTOM_SERVICES = {
    SP_PRINT: { tcp: '9100 631 515', comment: 'Raw/JetDirect, IPP, LPD printing' },
    SP_QUIC: { udp: '443', comment: 'QUIC / HTTP3 (Google, Microsoft 365, video calls)' },
    SP_RTP: { udp: '10000-20000', comment: 'RTP voice media (check the phone system range)' },
  };
  // Security profiles every Accept-to-internet policy gets unless the engineer turns one off (built-in "default" profiles, certificate inspection; app control added after Bob's Harbourline review).
  const OUT_UTM = { av: true, web: true, dns: true, ips: true, app: true };
  const utmOf = p => (p.action === 'deny' ? {} : p.utm ? Object.assign({}, p.utm) : p.dst === 'internet' || p.to === 'internet' ? Object.assign({}, OUT_UTM) : {});
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
    id: uid(), card: '', name: '', src: '', dst: 'internet', service: 'ALL', action: 'accept', nat: false, log: true,
    web: { mode: '', sites: '', cats: [] }, app: { mode: '', cats: [] }, webf: null,
  }, o);
  const dstLabel = p => (p.dst === 'internet' ? 'internet' : p.dst === 'internal' ? 'internal' : p.dst);
  const policyName = p => p.name || `${p.src} to ${dstLabel(p)}${p.action === 'deny' && p.dst === 'internal' ? ' (block)' : ''}`;

  // What the card library needs from a saved client: the intake answers and the engineer's card switches.
  // The suggestion engine picks each card's tier from the intake answers, so the card context carries its result.
  function cardCtx(project, allocs) {
    const intake = project && project.intake;
    return { intake, toggles: project && project.pol && project.pol.toggles, sel: allocs ? Suggest.run(allocs, intake).sel : null, webFilter: !!(intake && intake.webFilter) };
  }

  // Sensible defaults: the policy cards that suit this plan, as editable policies. ctx: { intake, toggles, sel } (all optional).
  function defaults(allocs, ctx) {
    return Cards.build(allocs || [], ctx).map(mkPolicy);
  }
  // Edited list wins; otherwise the defaults follow the plan.
  const effective = (project, allocs) => (project && project.pol && project.pol.edited ? tidy(JSON.parse(JSON.stringify(project.pol.list || [])), allocs).list : defaults(allocs, cardCtx(project, allocs)));

  // The library for this plan as the Policies view shows it. Once the list is edited, a card counts as "on" when its policies are in the list.
  function cardView(project, allocs) {
    const lib = Cards.library(allocs || [], cardCtx(project, allocs || []));
    if (project && project.pol && project.pol.edited) {
      const have = new Set((project.pol.list || []).map(p => p.card).filter(Boolean));
      lib.forEach(e => { if (e.card.type === 'policy') e.on = have.has(e.card.id); });
    }
    return lib;
  }

  // Web filter profile on one policy (accept policies only use it). preset '' removes it; changing one group makes the profile "custom".
  function setWebPreset(p, preset, industry) { p.webf = preset && Webcat.PRESETS[preset] ? Webcat.profile(preset, industry || 'office') : null; }
  function setWebGroup(p, group, action) {
    if (Webcat.GROUP_IDS.indexOf(group) < 0 || !Webcat.ACTIONS.some(a => a.v === action)) return;
    p.webf = { preset: 'custom', groups: Webcat.normGroups(p.webf && p.webf.groups ? p.webf.groups : null) };
    p.webf.groups[group] = action;
  }

  // Switch one card on or off in a list the engineer has already edited: remove its policies, or add them in the right place.
  function setCardInList(list, id, on, allocs, ctx) {
    const rest = list.filter(p => p.card !== id);
    if (!on) return rest;
    const add = Cards.policiesFor(id, allocs, ctx).map(mkPolicy);
    const card = Cards.byId(id);
    if (card && (card.exception || card.action === 'deny')) { // above the allows: after the last exception (or deny) already there
      let at = 0; rest.forEach((p, i) => { const c = Cards.byId(p.card); if (p.action === 'deny' || (c && c.exception)) at = i + 1; });
      if (card.exception) at = 0;
      rest.splice(at, 0, ...add); return rest;
    }
    return rest.concat(add);
  }

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
    printers: ['printers', 'printer', 'copiers'],
    pos: ['pos', 'tills', 'card terminals', 'card machines', 'payment terminals'],
  };
  const INTERNET_ALIASES = ['the internet', 'internet', 'wan', 'outside'];
  const SERVICE_WORDS = {
    https: 'HTTPS', http: 'HTTP', web: 'HTTP,HTTPS', dns: 'DNS', ssh: 'SSH', rdp: 'RDP', 'remote desktop': 'RDP', smb: 'SMB',
    'file sharing': 'SMB', print: 'SP_PRINT', printing: 'SP_PRINT', ping: 'PING', icmp: 'PING', smtp: 'SMTP', email: 'SMTP', mail: 'SMTP', ftp: 'FTP', ntp: 'NTP', all: 'ALL', everything: 'ALL', any: 'ALL',
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
        policies.push(mkPolicy({ src: n, dst: 'internet', service: k === 'guest' ? 'DNS,HTTP,HTTPS' : 'DNS,HTTP,HTTPS,NTP,PING', action: 'accept', nat: true, replaceSrc: true }));
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

  // ---- tidy (Bob's Harbourline review): no duplicates, no allow hidden under a block ----
  const svcList = p => String(p.service || 'ALL').split(',').map(s => s.trim()).filter(Boolean);
  const covers = (big, small) => big.indexOf('ALL') >= 0 || small.every(s => big.indexOf(s) >= 0);
  // Settings that must match before two allows can share one policy (services are what gets merged).
  const sig = p => JSON.stringify([p.enabled !== false, p.sched || 'always', !!p.nat, p.insp || 'flow', utmOf(p), p.ssl || '', p.logmode || 'all', p.log !== false]);
  // Does deny d (same source) catch every packet of allow a? d to "internal" covers any network in the SP_INTERNAL group.
  const blocks = (d, a, internal) => d.action === 'deny' && d.enabled !== false && d.src === a.src && covers(svcList(d), svcList(a)) &&
    (d.dst === a.dst || (d.dst === 'internal' && a.dst !== 'internet' && a.dst !== 'internal' && (!internal || internal.has(a.dst))));
  // -> { list, merged, moved }. merged: later duplicates folded into the first policy with the same source, destination and action
  // (dropped when the first already has every service, services added when the settings match). moved: allows lifted above a block that hid them.
  function tidy(list, allocs) {
    const internal = allocs ? new Set((allocs || []).filter(a => Access.hasPolicy(a) && Access.isInternal(a)).map(a => a.name)) : null;
    const out = []; let merged = 0, moved = 0;
    (list || []).forEach(p => {
      const same = out.find(x => x.src === p.src && x.dst === p.dst && x.action === p.action && x.enabled !== false);
      if (same && p.enabled !== false) {
        const a = svcList(same), b = svcList(p);
        if (covers(a, b)) { merged++; return; }
        if (p.action === 'deny' || sig(same) === sig(p)) {
          const all = a.concat(b.filter(s => a.indexOf(s) < 0));
          same.service = all.indexOf('ALL') >= 0 ? 'ALL' : all.join(','); merged++; return;
        }
      }
      if (p.action !== 'deny' && p.enabled !== false) {
        const at = out.findIndex(d => blocks(d, p, internal));
        if (at >= 0) { out.splice(at, 0, p); moved++; return; }
      }
      out.push(p);
    });
    return { list: out, merged, moved };
  }

  // List -> the shape the FortiOS exporter uses. Policies naming a network that is not in the plan are skipped.
  function resolve(list, allocs) {
    const by = new Map((allocs || []).filter(Access.hasPolicy).map(a => [a.name, a]));
    const pols = [], skipped = [];
    list.forEach(p => {
      const from = by.get(p.src), to = p.dst === 'internet' || p.dst === 'internal' ? p.dst : by.get(p.dst);
      if (!from || !to) { skipped.push(policyName(p)); return; }
      pols.push({
        id: p.id, card: p.card || '', name: policyName(p), action: p.action === 'deny' ? 'deny' : 'accept', from, to,
        services: String(p.service || 'ALL').split(',').map(s => s.trim()).filter(Boolean), nat: !!p.nat && p.action !== 'deny' && p.dst === 'internet', log: p.log !== false,
        sched: p.sched || 'always', insp: p.insp === 'proxy' ? 'proxy' : 'flow', ippool: p.ippool === 'dynamic' ? 'dynamic' : 'outgoing',
        snat: ['always', 'never'].indexOf(p.snat) >= 0 ? p.snat : 'conflict', logmode: p.logmode === 'utm' ? 'utm' : 'all', logstart: !!p.logstart, capture: !!p.capture,
        comments: String(p.comments || '').slice(0, 1023), enabled: p.enabled !== false, ssl: p.ssl || '',
        utm: utmOf(p),
        web: p.web && p.web.mode ? p.web : null, app: p.app && p.app.mode ? p.app : null,
        webf: p.action !== 'deny' && p.webf && p.webf.groups ? { preset: p.webf.preset || 'custom', groups: Webcat.normGroups(p.webf.groups) } : null,
      });
    });
    return { pols, skipped };
  }

  return { NOTE, SERVICES, CUSTOM_SERVICES, OUT_UTM, utmOf, WEB_CATS, APP_CATS, mkPolicy, policyName, defaults, effective, cardCtx, cardView, setCardInList, setWebPreset, setWebGroup, policyNets, parse, apply, tidy, resolve, blankProfile, aliasTable, mentions, serviceOf };
}));
