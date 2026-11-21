/* SubnetPal - contract text -> intake fields. Rule-based and offline: pasted text or a .txt file only (PDF and Word are not supported in v1).
   Pure functions, no DOM, no storage, no network. The text is never kept: extract() returns only short snippets for the review screen.
   Never guesses: a field with no clear statement is simply not returned. window.Contract / Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Contract = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const INDUSTRIES = ['office', 'clinic', 'school', 'retail'];
  const FIELDS = [
    { key: 'name', label: 'Client name', type: 'text' },
    { key: 'site', label: 'Site address', type: 'text' },
    { key: 'staff', label: 'Staff', type: 'number' },
    { key: 'guest', label: 'Guest Wi-Fi', type: 'bool' },
    { key: 'guestCount', label: 'Guest devices', type: 'number' },
    { key: 'iot', label: 'IoT / smart devices', type: 'bool' },
    { key: 'iotCount', label: 'IoT device count', type: 'number' },
    { key: 'cameras', label: 'Cameras (CCTV)', type: 'bool' },
    { key: 'camerasCount', label: 'Camera count', type: 'number' },
    { key: 'serversWhere', label: 'Servers', type: 'enum', options: [['onprem', 'On-site servers'], ['cloud', 'Cloud only']] },
    { key: 'serversCount', label: 'Server count', type: 'number' },
    { key: 'remote', label: 'Remote staff', type: 'bool' },
    { key: 'remoteCount', label: 'Remote staff count', type: 'number' },
    { key: 'industry', label: 'Industry', type: 'enum', options: [['office', 'Office'], ['clinic', 'Clinic'], ['school', 'School'], ['retail', 'Retail']] },
    { key: 'pos', label: 'Card payments', type: 'bool' },
    { key: 'posCount', label: 'Card terminals', type: 'number' },
    { key: 'dualWan', label: 'Internet lines', type: 'bool', yes: 'Two lines (dual WAN)', no: 'One line' },
    { key: 'internetType', label: 'Internet type', type: 'text' },
    { key: 'voice', label: 'VoIP phones', type: 'bool' },
    { key: 'voip', label: 'Phone system', type: 'enum', options: [['hosted', 'Hosted (cloud)'], ['onprem', 'On-site phone system']] },
    { key: 'voiceCount', label: 'Phone count', type: 'number' },
    { key: 'printers', label: 'Printers', type: 'bool' },
    { key: 'printersCount', label: 'Printer count', type: 'number' },
    { key: 'siteVpn', label: 'Site-to-site VPN', type: 'bool' },
  ];
  const BY_KEY = {}; FIELDS.forEach(f => { BY_KEY[f.key] = f; });
  const MAX_CHARS = 400000, MAX_COUNT = 100000;

  // ---- numbers ----
  const UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const NUM = '(\\d{1,3}(?:,\\d{3})+|\\d+|(?:one hundred|a hundred|hundred)|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|nineteen|eighteen|seventeen|sixteen|fifteen|fourteen|thirteen|twelve|eleven|ten|nine|eight|seven|six|five|four|three|two|one|zero)';
  function toNum(s) {
    s = String(s).toLowerCase().replace(/,/g, '').trim();
    if (/^\d+$/.test(s)) return Number(s);
    if (/hundred/.test(s)) return 100;
    let n = 0; s.split(/[- ]/).forEach(p => { n += TENS[p] || UNITS[p] || 0; }); return n;
  }

  // ---- text -> sentences (no lookbehind, so it also parses on older iPhones) ----
  function sentences(text) {
    const out = [];
    String(text || '').replace(/\r/g, '').split('\n').forEach(line => {
      line.replace(/[ \t]+/g, ' ').replace(/([.!?;])\s+(?=[A-Z0-9"“(])/g, '$1\u0001').split('\u0001').forEach(s => { s = s.trim(); if (s) out.push(s); });
    });
    return out;
  }
  const lines = text => String(text || '').replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
  const clip = (s, i, n) => { // a short window around the match, with the matched words kept for highlighting
    const hit = s.substr(i, n); if (s.length <= 220) return { snippet: s, hit };
    const a = Math.max(0, i - 90), b = Math.min(s.length, i + n + 90);
    return { snippet: (a > 0 ? '…' : '') + s.slice(a, b) + (b < s.length ? '…' : ''), hit };
  };

  const NEG_BEFORE = /\b(no|not|without|excluding|excluded|exclude|never|none)\b[^.]{0,30}$/i;
  const NEG_AFTER = /^[^.]{0,30}\b(not required|not needed|not included|not part|out of scope|excluded|is not|are not|will not|won['’]t|isn['’]t|aren['’]t|not applicable|n\/a)\b/i;
  const COND = /\b(optional|if required|if needed|if necessary|may be|might|future|phase (?:2|two|ii)|subject to|tbc|to be confirmed|potential(?:ly)?|possible|option(?:al)?)\b/i;
  const REQ = /\b(require[sd]?|need[sd]?|must|shall|will (?:be )?(?:provide|have|need)|include[sd]?|provide[sd]?|scope|deliverables?|supply|install|set ?up|configure|support)\b/i;
  const HEDGE = /\b(approx(?:imately|\.)?|around|about|circa|c\.|roughly|estimated|up to|over|more than|at least|some|~)\s*$/i;
  const negated = (s, i, n) => NEG_BEFORE.test(s.slice(Math.max(0, i - 40), i)) || NEG_AFTER.test(s.slice(i + n, i + n + 45));

  const matches = (S, re) => { // every match in every sentence: [{ s, m }]
    const out = []; const g = new RegExp(re.source, 'gi');
    S.forEach(s => { let m; g.lastIndex = 0; while ((m = g.exec(s))) { out.push({ s, m }); if (m[0] === '') g.lastIndex++; } });
    return out;
  };
  const found = (h, extra) => Object.assign(clip(h.s, h.m.index, h.m[0].length), extra || {});

  // A yes/no feature. Positive and negative mentions that disagree make it low confidence (never silently one or the other).
  function feature(S, re) {
    const all = matches(S, re); if (!all.length) return null;
    const pos = [], neg = [];
    all.forEach(h => (negated(h.s, h.m.index, h.m[0].length) ? neg : pos).push(h));
    if (pos.length && neg.length) return found(pos[0], { value: true, conf: 'low', note: 'Another sentence says the opposite. Check the contract.', alts: [neg[0].s.slice(0, 160)] });
    if (neg.length) return found(neg[0], { value: false, conf: 'medium' });
    const h = pos[0], conf = COND.test(h.s) ? 'low' : REQ.test(h.s) ? 'high' : 'medium';
    return found(h, { value: true, conf, note: conf === 'low' ? 'Worded as optional or uncertain.' : '' });
  }
  // A count. Several different figures make it low confidence and list the others; a range uses the higher figure (flagged).
  function count(S, re, opts) {
    opts = opts || {};
    const vals = [];
    matches(S, re).forEach(h => {
      if (opts.skip && opts.skip.test(h.s.slice(Math.max(0, h.m.index - 32), h.m.index))) return;
      if (opts.skipAfter && opts.skipAfter.test(h.s.slice(h.m.index + h.m[0].length, h.m.index + h.m[0].length + 40))) return;
      const a = toNum(h.m[1]), b = h.m[2] !== undefined && h.m[2] !== '' ? toNum(h.m[2]) : 0, v = Math.max(a, b);
      if (!(v >= 1 && v <= MAX_COUNT)) return;
      vals.push({ h, v, range: !!b, hedge: HEDGE.test(h.s.slice(Math.max(0, h.m.index - 22), h.m.index + (h.m[0].length > 0 ? 0 : 0))) });
    });
    if (!vals.length) return null;
    const distinct = Array.from(new Set(vals.map(x => x.v))), f = vals[0];
    if (distinct.length > 1) return found(f.h, { value: f.v, conf: 'low', note: 'Different figures appear in the text: ' + distinct.join(', ') + '. Check which applies.', alts: distinct.filter(x => x !== f.v).map(String) });
    const conf = f.range || f.hedge ? 'medium' : 'high';
    return found(f.h, { value: f.v, conf, note: f.range ? 'A range was given: the higher figure is used.' : f.hedge ? 'Worded as approximate.' : '' });
  }
  const labelText = (text, re, len) => { // a "Label: value" line
    const m = re.exec(lines(text).join('\n')); if (!m) return null;
    const v = m[1].replace(/\s*[(\[].*$/, '').replace(/[.;,\s]+$/, '').trim(); if (!v || v.length > len) return null;
    return { value: v, snippet: m[0].trim().slice(0, 200), hit: v };
  };

  // ---- the rules, one per field ----
  const NOUN_STAFF = '(?:members of staff|staff members|staff|employees|colleagues|seats|workstations|desks|users|people)';
  const EX = {
    name(S, text) {
      const l = labelText(text, /^\s*(?:client|customer|prepared for|company(?: name)?|organi[sz]ation|account name|end user|purchaser)(?: name)?\s*[:\-–]\s*(.{2,90})$/im, 80);
      if (l) return Object.assign(l, { conf: 'high' });
      const m = /([A-Z0-9][A-Za-z0-9&.,'’\- ]{1,60}?\b(?:Ltd|Limited|LLP|LLC|PLC|Inc|GmbH|Partners|Group|Associates|Practice|Clinic|School|Surgery|Academy|& Co))\b\.?[^()\n]{0,90}\(\s*(?:the\s+)?[“"'‘]?(?:Client|Customer|Buyer|Purchaser)[”"'’]?\s*\)/.exec(text);
      return m ? Object.assign(clip(m[0].replace(/\s+/g, ' '), 0, m[1].length), { value: m[1].replace(/\s+/g, ' ').trim(), conf: 'medium', note: 'Taken from where the contract defines the Client.' }) : null;
    },
    site(S, text) {
      const l = labelText(text, /^\s*(?:site address|installation address|site location|premises address|premises|service address|delivery address|address of (?:the )?(?:site|premises))\s*[:\-–]\s*(.{6,140})$/im, 140);
      if (l) return Object.assign(l, { conf: /\d|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/.test(l.value) ? 'high' : 'medium' });
      const m = /(?:install(?:ed|ation)?|supplied|delivered|located|based)\s+(?:at|to)\s+((?:\d+[A-Za-z]?,?\s+)?[A-Z][\w'’\- ]+(?:,\s*[\w'’\- ]+){1,3}\s+[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})/.exec(text);
      return m ? Object.assign(clip(m[0], 0, m[0].length), { value: m[1].replace(/\s+/g, ' ').trim(), conf: 'medium' }) : null;
    },
    staff(S) {
      const skip = /\b(remote|home|hybrid|guest|visitor|public|wi-?fi|wireless|temporary|contractor|vpn|iot|device|concurrent)\w*\W*$/i;
      const skipAfter = /^[^.]{0,30}\b(?:work(?:ing)?\s+from\s+home|remote(?:ly)?|wfh|hybrid|will\s+(?:visit|connect)|guests?|visitors?)\b/i;      // "five staff will work from home" is not the headcount
      const lab = count(S, new RegExp('\\b(?:number of|no\\.? of|total|headcount|head count)\\s*(?:' + NOUN_STAFF + ')?\\s*(?:[:=\\-–]|is|of|will be)?\\s*(?:approx(?:imately|\\.)?\\s*|circa\\s*|c\\.\\s*|around\\s*)?' + NUM + '(?!\\s*(?:%|per))'), { skip, skipAfter });
      if (lab && lab.conf === 'high') return lab;
      return count(S, new RegExp('\\b' + NUM + '(?:\\s*(?:-|–|to)\\s*' + NUM + ')?\\s+(?:full[- ]time\\s+|permanent\\s+|office[- ]based\\s+|office\\s+|on-?site\\s+)?' + NOUN_STAFF + '\\b'), { skip, skipAfter }) || lab;
    },
    guest: S => feature(S, /\b(?:guest|visitor|public)\s*(?:wi-?fi|wifi|wireless|network|access|internet|vlan|ssid)\b|\bseparate guest\b/),
    guestCount: S => count(S, new RegExp('\\b' + NUM + '\\s+(?:concurrent\\s+)?(?:guest|visitor)s?(?:\\s+(?:users|devices|clients))?\\b')),
    iot: S => feature(S, /\b(?:iot|internet of things|smart\s+(?:devices?|tvs?|displays?|thermostats?|sensors?|lighting|meters?|screens?)|building management system|bms|environmental sensors?)\b/),
    iotCount: S => count(S, new RegExp('\\b' + NUM + '\\s+(?:iot(?:\\s+devices?)?|smart\\s+(?:devices?|tvs?|displays?|thermostats?|sensors?|screens?)|sensors?)\\b')),
    cameras: S => feature(S, /\b(?:cctv|ip cameras?|security cameras?|surveillance cameras?|nvr)\b/),
    camerasCount: S => count(S, new RegExp('\\b' + NUM + '\\s+(?:ip\\s+|security\\s+|cctv\\s+|surveillance\\s+)?cameras?\\b')),
    serversWhere(S) {
      const cloud = matches(S, /\b(?:no|without)\s+(?:on-?(?:site|premises?|prem)|local)\s+servers?\b|\bcloud[- ]only\b|\bfully\s+(?:in\s+the\s+)?cloud\b/);
      const onprem = matches(S, /\b(?:on-?(?:site|premises?|prem)|local)\s+(?:file\s+|application\s+|database\s+|domain\s+)?servers?\b|\b(?:file server|domain controller|hyper-?v|vmware|esxi)\b/)
        .filter(h => !negated(h.s, h.m.index, h.m[0].length));
      if (cloud.length && onprem.length) return found(onprem[0], { value: 'onprem', conf: 'low', note: 'The text mentions both cloud-only and on-site servers. Check the contract.', alts: [cloud[0].s.slice(0, 160)] });
      if (cloud.length) return found(cloud[0], { value: 'cloud', conf: 'high' });
      if (onprem.length) return found(onprem[0], { value: 'onprem', conf: COND.test(onprem[0].s) ? 'low' : 'medium' });
      return null;
    },
    serversCount: S => count(S, new RegExp('\\b' + NUM + '\\s+(?:physical\\s+|virtual\\s+|windows\\s+|linux\\s+|on-?site\\s+|file\\s+)?servers\\b')),
    remote(S) {
      const strong = feature(S, /\b(?:remote\s+(?:staff|workers?|users?|employees|working)|work(?:ing)?\s+from\s+home|home[- ]?working|wfh|teleworkers?|hybrid\s+working)\b/);
      if (strong) return strong;
      const weak = feature(S, /\b(?:remote access|vpn)\b/);
      return weak && weak.value ? Object.assign(weak, { conf: 'low', note: 'Remote access or VPN is mentioned, but not remote staff. It may be site-to-site.' }) : weak;
    },
    remoteCount: S => count(S, new RegExp('\\b' + NUM + '\\s+(?:of\\s+(?:the\\s+)?)?(?:staff\\s+)?(?:will\\s+)?(?:work\\s+)?(?:remote(?:ly)?|from\\s+home|home)(?:[- ]?(?:work\\w*|staff|users|employees|workers))?\\b')),
    industry(S) {
      const sets = {
        clinic: /\b(?:clinic|dental|dentist|surgery|medical|patients?|healthcare|gp practice|physio\w*|optician|veterinary|vets?)\b/,
        school: /\b(?:school|academy|college|pupils?|students?|classrooms?|nursery|university|teachers?)\b/,
        retail: /\b(?:retail|shop|shops|boutique|epos|point[- ]of[- ]sale|tills?)\b/,
        office: /\b(?:accountan\w+|solicitors?|law firm|consultan\w+|estate agen\w+|architects?|insurance broker)\b/,
      };
      const score = INDUSTRIES.map(k => ({ k, hits: matches(S, sets[k]) })).sort((a, b) => b.hits.length - a.hits.length);
      if (!score[0].hits.length || (score[1].hits.length === score[0].hits.length)) return null;        // none, or a tie: not guessed
      return found(score[0].hits[0], { value: score[0].k, conf: score[0].hits.length >= 2 ? 'medium' : 'low', note: score[0].hits.length >= 2 ? `${score[0].hits.length} mentions.` : 'Only one mention.' });
    },
    pos: S => feature(S, /\b(?:card payments?|pci(?:[- ]dss)?|card terminals?|chip and pin|payment terminals?|pdq|epos|point[- ]of[- ]sale|pos terminals?|take(?:s)? cards?|credit cards?)\b/),
    posCount: S => count(S, new RegExp('\\b' + NUM + '\\s+(?:card|payment|pdq|pos|epos)\\s+(?:terminals?|machines?|devices?)\\b')),
    dualWan(S) {
      const two = matches(S, /\bdual[- ]wan\b|\btwo\s+(?:internet\s+)?(?:lines|connections|circuits|isps?|links)\b|\bsecond\s+(?:internet\s+)?(?:line|connection|circuit)\b|\b(?:4g|5g|lte)\s+(?:backup|failover)\b|\bbackup\s+(?:internet|line|connection|4g|5g|lte)\b|\bprimary and (?:backup|secondary)\b/);
      const one = matches(S, /\b(?:single|one)\s+(?:internet\s+)?(?:line|connection|circuit)\b/);
      if (two.length && one.length) return found(two[0], { value: true, conf: 'low', note: 'The text mentions both one and two internet lines.', alts: [one[0].s.slice(0, 160)] });
      if (two.length) return found(two[0], { value: true, conf: COND.test(two[0].s) ? 'low' : 'medium' });
      if (one.length) return found(one[0], { value: false, conf: 'medium' });
      const fo = matches(S, /\bfail-?over\b/);
      return fo.length ? found(fo[0], { value: true, conf: 'low', note: 'Failover is mentioned but it may mean firewall failover, not a second internet line.' }) : null;
    },
    internetType(S) {
      const all = matches(S, /\b(?:ftth|fttp|fttc|fibre|fiber|leased line|dedicated internet access|broadband|adsl|vdsl|dsl|cable|4g|5g|lte|starlink|satellite)\b/);
      if (!all.length) return null;
      const types = Array.from(new Set(all.map(h => h.m[0].toLowerCase().replace('fiber', 'fibre')))).slice(0, 3);
      const sp = matches(S.filter(s => /internet|line|broadband|fibre|fiber|connection|circuit/i.test(s)), new RegExp('\\b' + NUM + '(?:\\s*/\\s*' + NUM + ')?\\s*(?:mbps|mb/s|gbps|gb/s|meg)\\b'))[0];
      const speed = sp ? ` ${sp.m[0].replace(/\s+/g, ' ')}` : '';
      return found(all[0], { value: types.join(', ') + speed, conf: 'medium', note: sp ? '' : 'No speed found.' });
    },
    voice: S => feature(S, /\b(?:voip|sip trunks?|hosted (?:telephony|voice|phones?|pbx)|cloud (?:telephony|phones?|pbx)|ip phones?|ip telephony|pbx|unified communications|desk ?phones?|handsets?)\b/),
    voip(S) {
      const hosted = matches(S, /\b(?:hosted\s+(?:telephony|voice|phones?|pbx)|cloud\s+(?:telephony|phones?|pbx)|teams phones?|sip trunks?|ringcentral|8x8|zoom phone)\b/);
      const onprem = matches(S, /\bon-?(?:site|premises?|prem)\s+(?:pbx|phone system|telephony)\b|\blocal pbx\b|\basterisk\b|\bavaya\b/);
      if (hosted.length && onprem.length) return found(hosted[0], { value: 'hosted', conf: 'low', note: 'Both hosted and on-site phone systems are mentioned.', alts: [onprem[0].s.slice(0, 160)] });
      if (hosted.length) return found(hosted[0], { value: 'hosted', conf: COND.test(hosted[0].s) ? 'low' : 'medium' });
      return onprem.length ? found(onprem[0], { value: 'onprem', conf: COND.test(onprem[0].s) ? 'low' : 'medium' }) : null;
    },
    voiceCount: S => count(S, new RegExp('\\b' + NUM + '\\s+(?:ip\\s+)?(?:phones?|handsets?|extensions?|desk ?phones?)\\b')),
    printers: S => feature(S, /\b(?:printers?|copiers?|mfps?|multi-?function (?:devices?|printers?)|photocopiers?)\b/),
    printersCount: S => count(S, new RegExp('\\b' + NUM + '\\s+(?:network\\s+)?(?:printers?|copiers?|mfps?|photocopiers?)\\b')),
    siteVpn: S => feature(S, /\bsite[- ]to[- ]site\b|\bs2s\b|\bipsec tunnels?\b|\bvpn (?:tunnel|link) (?:to|between)\b/),
  };

  // ---- public API ----
  const fmt = (f, v) => (f.type === 'bool' ? (v ? (f.yes || 'Yes') : (f.no || 'No')) : f.type === 'enum' ? ((f.options.find(o => o[0] === v) || [v, v])[1]) : String(v));

  // text -> { ok, error?, fields:[{ key, label, type, options?, value, display, snippet, hit, conf, note, alts, checked }], missing:[{ key, label }] }
  function extract(text) {
    const t = String(text == null ? '' : text);
    if (!t.trim()) return { ok: false, error: 'Paste the contract text, or choose a .txt file.', fields: [], missing: [] };
    if (t.length > MAX_CHARS) return { ok: false, error: 'That text is very long (over 400,000 characters). Paste just the relevant parts.', fields: [], missing: [] };
    if (/^%PDF-|^PK\u0003\u0004/.test(t.slice(0, 8)) || (t.slice(0, 2000).match(/[\u0000-\u0008]/g) || []).length > 20) {
      return { ok: false, error: 'This looks like a PDF or Word file, which is not supported yet. Copy the text out of it and paste it here.', fields: [], missing: [] };
    }
    const S = sentences(t), fields = [], missing = [];
    FIELDS.forEach(f => {
      let r = null; try { r = EX[f.key](S, t); } catch (e) { r = null; }
      if (!r || r.value === undefined || r.value === '' || (f.type === 'number' && !(r.value >= 1))) { missing.push({ key: f.key, label: f.label }); return; }
      fields.push({ key: f.key, label: f.label, type: f.type, options: f.options, yes: f.yes, no: f.no, value: r.value, display: fmt(f, r.value), snippet: r.snippet || '', hit: r.hit || '',
        conf: r.conf || 'medium', note: r.note || '', alts: r.alts || [], checked: (r.conf || 'medium') !== 'low' });
    });
    return { ok: true, fields, missing };
  }

  // A value typed or chosen on the review screen -> a clean value, or null when it is not valid.
  function clean(key, raw) {
    const f = BY_KEY[key]; if (!f) return null;
    if (f.type === 'bool') return raw === true || raw === 'true' || raw === 'yes' ? true : raw === false || raw === 'false' || raw === 'no' ? false : null;
    if (f.type === 'number') { const n = Math.floor(Number(String(raw).replace(/,/g, ''))); return Number.isFinite(n) && n >= 1 && n <= MAX_COUNT ? n : null; }
    if (f.type === 'enum') return f.options.some(o => o[0] === raw) ? raw : null;
    const s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim(); return s && s.length <= 140 ? s : null;
  }

  const num = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
  // What the intake holds now for a field, for the "currently" column on the review screen.
  function current(client, key) {
    const it = (client && client.intake) || {}, c = it.counts || {}, r = it.req || {};
    const map = {
      name: client && client.name, site: client && client.site, staff: num(c.staff) || '', guest: r.guest, guestCount: num(c.guest) || '', iot: r.iot, iotCount: num(c.iot) || '', cameras: r.cameras, camerasCount: num(c.cameras) || '',
      serversWhere: it.serversWhere, serversCount: num(c.servers) || '', remote: it.remote && it.remote.on, remoteCount: it.remote && num(it.remote.count) || '', industry: it.industry, pos: r.pos, posCount: num(c.pos) || '',
      dualWan: it.dualWan, internetType: '', voice: r.voice, voip: it.voip, voiceCount: num(c.voice) || '', printers: r.printers, printersCount: num(c.printers) || '', siteVpn: it.siteVpn,
    };
    const v = map[key], f = BY_KEY[key];
    if (v === undefined || v === '' || v === null) return '';
    if (f.type === 'bool') return v ? (f.yes || 'Yes') : (f.no || 'No');
    return f.type === 'enum' ? fmt(f, v) : String(v);
  }

  // Apply confirmed fields to a client's intake: items = [{ key, value }]. Only listed keys change. Returns the changes made, as sentences.
  // Counts, text and choices go first so an explicit "No" for a yes/no field wins over a count that would have ticked it.
  const COUNT_OF = { staff: ['staff'], guestCount: ['guest', 'guest'], iotCount: ['iot', 'iot'], camerasCount: ['cameras', 'cameras'], serversCount: ['servers', 'servers'], posCount: ['pos', 'pos'], voiceCount: ['voice', 'voice'], printersCount: ['printers', 'printers'] };
  const BOOL_REQ = { guest: 'guest', iot: 'iot', cameras: 'cameras', pos: 'pos', voice: 'voice', printers: 'printers' };
  function apply(client, items) {
    const it = client.intake = client.intake || {}; it.counts = it.counts || {}; it.req = it.req || {}; const done = [];
    const list = (items || []).map(x => ({ key: x && x.key, value: clean(x && x.key, x && x.value) })).filter(x => BY_KEY[x.key] && x.value !== null);
    const first = list.filter(x => BY_KEY[x.key].type !== 'bool'), second = list.filter(x => BY_KEY[x.key].type === 'bool');
    first.forEach(({ key, value }) => {
      if (key === 'name') client.name = value;
      else if (key === 'site') client.site = value;
      else if (COUNT_OF[key]) { const [cf, rf] = COUNT_OF[key]; it.counts[cf] = value; if (rf) it.req[rf] = true; }
      else if (key === 'serversWhere') { it.serversWhere = value; if (value === 'onprem') it.req.servers = true; }
      else if (key === 'industry') it.industry = value;
      else if (key === 'voip') it.voip = value;
      else if (key === 'remoteCount') { it.remote = Object.assign({ on: true, reach: null }, it.remote, { count: value, on: true }); }
      else if (key === 'internetType') { const line = `Internet: ${value}.`; if (String(it.wanNote || '').indexOf(line) < 0) it.wanNote = (String(it.wanNote || '').trim() + (it.wanNote ? '\n' : '') + line).trim(); }
      done.push(`${BY_KEY[key].label}: ${fmt(BY_KEY[key], value)}`);
    });
    second.forEach(({ key, value }) => {
      if (BOOL_REQ[key]) it.req[BOOL_REQ[key]] = value;
      else if (key === 'remote') it.remote = Object.assign({ count: '', reach: null }, it.remote, { on: value });
      else if (key === 'dualWan') it.dualWan = value;
      else if (key === 'siteVpn') it.siteVpn = value;
      done.push(`${BY_KEY[key].label}: ${fmt(BY_KEY[key], value)}`);
    });
    return done;
  }

  return { FIELDS, BY_KEY, MAX_CHARS, sentences, toNum, extract, clean, current, apply };
}));
