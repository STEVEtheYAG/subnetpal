/* SubnetPal - Prepare tab: the 8-step reading order and brief flows (who, what, how) turned into a draft policy. Pure, no DOM. window.Prep / Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./policy.js'));
  else root.Prep = factory(root.Policy);
}(typeof self !== 'undefined' ? self : this, function (Policy) {
  'use strict';

  // tab: the results tab where the step is done (opened by its Go button), '' when it happens on paper or on this tab.
  const STEPS = [
    { id: 'nouns', title: 'Underline the nouns', text: 'Read the brief and underline every person, place, device and service. These become your networks, objects and flows.', tab: '' },
    { id: 'map', title: 'Draw the map', text: 'Sketch the internet, the firewall and each group of people or devices on the drawing board below.', tab: '' },
    { id: 'base', title: 'Base build', text: 'Interfaces, VLANs, addresses, DHCP, DNS and routes. Fill in the client info, then check the Plan tab.', tab: 'plan' },
    { id: 'flows', title: 'List the flows', text: 'Who needs to reach what, and how. One row per flow in the flows table below.', tab: '' },
    { id: 'pols', title: 'Policies', text: 'One policy per flow, most specific first, deny everything else last. Use Make policy on each flow.', tab: 'policies' },
    { id: 'admin', title: 'Admin', text: 'Admin access from Management only (trusted hosts), MFA, a backup admin, and a config backup. See the pre-flight checklist.', tab: 'export' },
    { id: 'vpn', title: 'VPN', text: 'Remote staff and site-to-site tunnels, and what each can reach.', tab: 'remote' },
    { id: 'prove', title: 'Prove it', text: 'Test every flow (allowed and blocked), check the logs, then hand over the report.', tab: 'export' },
  ];
  const MAX_FLOWS = 60;
  const DENY_WORDS = /\b(?:block|blocked|deny|denied|no|not|never|none|nothing)\b/;

  // Stored prep data is untrusted: keep only known fields and sane sizes.
  function normalize(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const steps = {};
    STEPS.forEach(s => { if (r.steps && r.steps[s.id] === true) steps[s.id] = true; });
    const s = v => String(v == null ? '' : v).slice(0, 200);
    const flows = (Array.isArray(r.flows) ? r.flows : []).slice(0, MAX_FLOWS).filter(f => f && typeof f === 'object').map(f => ({ who: s(f.who), what: s(f.what), how: s(f.how) }));
    return { steps, brief: String(r.brief == null ? '' : r.brief).slice(0, 20000), flows, board: r.board && typeof r.board === 'object' ? r.board : null };
  }
  const progress = steps => STEPS.filter(s => steps && steps[s.id]).length;

  // One flow -> a draft policy for the policy popup, plus what could not be worked out (the engineer fixes it in the popup).
  // who: a network from the plan. what: a network, "internet" or "all internal". how: services ("https, rdp"), or "block".
  function flowToPolicy(flow, allocs) {
    const f = flow || {}, why = [];
    const table = Policy.aliasTable(allocs), nets = Policy.policyNets(allocs);
    const low = v => String(v || '').toLowerCase().replace(/[‘’`]/g, "'").trim();
    const who = low(f.who), what = low(f.what), how = low(f.how);
    let src = Policy.mentions(who, table).filter(t => t !== 'internet')[0];
    if (!src) { src = nets[0] || ''; why.push(who ? `"${f.who}" is not a network in the plan: pick the source` : 'no "who": pick the source'); }
    let dst = /\b(?:all internal|internal|everything inside|all networks|lan)\b/.test(what) && !Policy.mentions(what, table).filter(t => t !== 'internet').length ? 'internal' : Policy.mentions(what, table)[0];
    if (!dst) { dst = 'internet'; why.push(what ? `"${f.what}" is not a network in the plan: pick the destination` : 'no "what": pick the destination'); }
    const deny = DENY_WORDS.test(how);
    const words = how.replace(new RegExp(DENY_WORDS.source, 'g'), ' ').replace(/\b(?:access|access to|to|only|allowed|allow|from)\b/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[,/+&\s]+|[,/+&\s]+$/g, '');
    let service = '';
    if (words) { const sv = Policy.serviceOf('on ' + words); if (sv.error) why.push(sv.error + ': pick the services'); else service = sv.service; }
    if (!service) service = deny ? 'ALL' : dst === 'internet' ? 'DNS,HTTP,HTTPS,NTP,PING,SP_QUIC' : 'PING';
    if (!deny && service === 'ALL') why.push('ALL services on an allow is wide open: narrow it down');
    if (!deny && !words && dst !== 'internet') why.push('no "how": pick the services');
    const p = Policy.mkPolicy({ src, dst, service, action: deny ? 'deny' : 'accept', nat: !deny && dst === 'internet',
      comments: `From the brief: ${[f.who, f.what, f.how].map(x => String(x || '').trim() || '?').join(' / ')}`.slice(0, 1023) });
    return { policy: p, why };
  }

  return { STEPS, normalize, progress, flowToPolicy };
}));
