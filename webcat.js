/* SubnetPal - FortiGuard web categories in five groups, preset web filter profiles per network type, industry adjustments. Pure, no DOM.
   ALL CATEGORY IDS ARE FROM MEMORY AND UNVERIFIED: check every id against its name on the lab VM before applying. window.Webcat / Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Webcat = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ACTIONS = [{ v: 'allow', l: 'Allow' }, { v: 'warn', l: 'Warn' }, { v: 'block', l: 'Block' }];
  const ACTION_PLAIN = { allow: 'Allowed', warn: 'Allowed after a warning', block: 'Blocked' };

  // id: FortiGuard category id (unverified), or null where there is no web category to put in the list.
  const GROUPS = [
    { id: 'always', label: 'Block always', plain: 'Dangerous websites', says: 'Sites known for viruses, scams, fake log-in pages and ways of getting round the filter.',
      cats: [{ id: 26, name: 'Malicious Websites' }, { id: 61, name: 'Phishing' }, { id: 62, name: 'Spam URLs' }, { id: 59, name: 'Proxy Avoidance' },
        { id: null, name: 'Botnets', note: 'Not a web category. Turn on botnet command-and-control blocking (IPS, DNS filter or botnet protection) separately.' }] },
    { id: 'most', label: 'Block for most', plain: 'Adult and risky content', says: 'Adult material, gambling, drugs, weapons, hacking and other content that has no place on a work network.',
      cats: [{ id: 13, name: 'Pornography' }, { id: 8, name: 'Other Adult Materials' }, { id: 12, name: 'Nudity and Risque' }, { id: 17, name: 'Gambling' }, { id: 4, name: 'Illegal or Unethical' },
        { id: 3, name: 'Hacking' }, { id: 1, name: 'Drug Abuse' }, { id: 6, name: 'Explicit Violence' }, { id: 15, name: 'Weapons (Sales)' }] },
    { id: 'productivity', label: 'Productivity', plain: 'Time-wasters', says: 'Social media, games, shopping, dating and entertainment sites.',
      cats: [{ id: 37, name: 'Social Networking' }, { id: 20, name: 'Games' }, { id: 35, name: 'Shopping' }, { id: 23, name: 'Entertainment' }, { id: 14, name: 'Dating' }] },
    { id: 'bandwidth', label: 'Bandwidth', plain: 'Heavy-bandwidth sites', says: 'Video and music streaming, peer-to-peer file sharing and large software downloads, which can slow everyone down.',
      cats: [{ id: 75, name: 'Streaming Media and Download' }, { id: 48, name: 'Peer-to-peer File Sharing' }, { id: 18, name: 'Freeware and Software Downloads' }] },
    { id: 'business', label: 'Business-critical allow', plain: 'Business tools', says: 'Online file storage, web email and cloud business applications.',
      cats: [{ id: 52, name: 'File Sharing and Storage' }, { id: 53, name: 'Web-based Email' }, { id: 54, name: 'Business' }, { id: 57, name: 'Information Technology' }] },
  ];
  const GROUP_IDS = GROUPS.map(g => g.id);
  const groupOf = id => GROUPS.find(g => g.id === id) || null;

  // Preset profiles per network type: the action for each group. allow = no filter entry, warn = warning page, block = blocked.
  const PRESETS = {
    staff: { label: 'Staff', groups: { always: 'block', most: 'block', productivity: 'warn', bandwidth: 'warn', business: 'allow' } },
    guest: { label: 'Guest', groups: { always: 'block', most: 'block', productivity: 'allow', bandwidth: 'warn', business: 'allow' } },
    iot: { label: 'IoT', groups: { always: 'block', most: 'block', productivity: 'block', bandwidth: 'block', business: 'allow' } },
    byod: { label: 'Kids / BYOD', groups: { always: 'block', most: 'block', productivity: 'block', bandwidth: 'warn', business: 'allow' } },
    servers: { label: 'Servers', groups: { always: 'block', most: 'block', productivity: 'block', bandwidth: 'block', business: 'allow' } },
  };
  const PRESET_IDS = Object.keys(PRESETS);

  // Industry presets nudge the defaults: school blocks social media (the Productivity group), clinic blocks file sharing and streaming (Bandwidth).
  const INDUSTRY = {
    school: { staff: { productivity: 'block' }, guest: { productivity: 'block' } },
    clinic: { staff: { bandwidth: 'block' }, guest: { bandwidth: 'block' } },
    retail: { guest: { bandwidth: 'warn' } },
    office: {},
  };
  const INDUSTRY_WHY = {
    school: 'School: social media, games and shopping (the Productivity group) are blocked for staff and guests.',
    clinic: 'Clinic: file sharing, peer-to-peer and streaming (the Bandwidth group) are blocked for staff and guests.',
    retail: 'Retail: guest Wi-Fi streaming and downloads show a warning so they do not slow the tills.',
  };

  function presetGroups(preset, industry) {
    const p = PRESETS[preset]; if (!p) return null;
    return Object.assign({}, p.groups, (INDUSTRY[industry] || {})[preset] || {});
  }
  // Which preset suits a network: by kind, and for a custom "Other" pool by name (BYOD / kids / students).
  function presetForKind(kind, name) {
    if (kind === 'staff' || kind === 'lan') return 'staff';
    if (kind === 'guest') return 'guest';
    if (kind === 'iot') return 'iot';
    if (kind === 'servers' || kind === 'dmz') return 'servers';
    if (kind === 'other') return /byod|kid|student|pupil|child|learner|school/i.test(String(name || '')) ? 'byod' : 'iot';
    return null;
  }
  const blankGroups = () => presetGroups('staff', 'office');
  const normGroups = g => { const out = {}; GROUP_IDS.forEach(k => { out[k] = g && ACTIONS.some(a => a.v === g[k]) ? g[k] : 'allow'; }); return out; };
  const profile = (preset, industry) => ({ preset, groups: presetGroups(preset, industry) });

  // The category entries to export: [{ id, name, group, action: 'block' | 'warning' }]. Allow adds nothing (unlisted categories are allowed).
  function entries(groups) {
    const g = normGroups(groups), out = [], seen = new Set();
    GROUPS.forEach(grp => {
      if (g[grp.id] === 'allow') return;
      grp.cats.forEach(c => { if (c.id == null || seen.has(c.id)) return; seen.add(c.id); out.push({ id: c.id, name: c.name, group: grp.id, action: g[grp.id] === 'warn' ? 'warning' : 'block' }); });
    });
    return out;
  }
  // Notes for groups that include something that is not a web category (botnets).
  const notes = groups => GROUPS.filter(grp => normGroups(groups)[grp.id] !== 'allow').reduce((a, grp) => a.concat(grp.cats.filter(c => c.id == null).map(c => `${c.name}: ${c.note}`)), []);

  // "blocks Block always, Block for most; warns Productivity"
  function summary(groups) {
    const g = normGroups(groups), by = a => GROUPS.filter(x => g[x.id] === a).map(x => x.label);
    const parts = [];
    if (by('block').length) parts.push('blocks ' + by('block').join(', '));
    if (by('warn').length) parts.push('warns ' + by('warn').join(', '));
    return parts.length ? parts.join('; ') : 'allows everything';
  }
  const label = preset => (PRESETS[preset] ? PRESETS[preset].label : 'Custom');
  const flat = () => GROUPS.reduce((a, g) => a.concat(g.cats.filter(c => c.id != null).map(c => ({ id: c.id, l: c.name, group: g.id }))), []);

  return { ACTIONS, ACTION_PLAIN, GROUPS, GROUP_IDS, PRESETS, PRESET_IDS, INDUSTRY_WHY, groupOf, presetGroups, presetForKind, profile, blankGroups, normGroups, entries, notes, summary, label, flat };
}));
