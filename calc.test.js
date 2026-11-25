// Plain Node tests, no dependencies. Run: node calc.test.js
'use strict';
const assert = require('assert');
const C = require('./calc.js');
const F = require('./format.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).split('\n').slice(0, 4).join('\n       ')); }
}
const proj = (parent, networks, opts) => ({ parent, networks, opts });
const by = (r, name) => r.allocations.find(a => a.name === name);

console.log('Address helpers');
test('ipToInt / intToIp round trip', () => {
  assert.strictEqual(C.intToIp(C.ipToInt('192.168.1.200')), '192.168.1.200');
  assert.strictEqual(C.intToIp(C.ipToInt('255.255.255.255')), '255.255.255.255');
  assert.strictEqual(C.intToIp(C.ipToInt('0.0.0.0')), '0.0.0.0');
  assert.strictEqual(C.intToIp(C.ipToInt('128.0.0.1')), '128.0.0.1');
});
test('bad IPs rejected', () => {
  ['1.2.3', '1.2.3.256', '1.2.3.4.5', 'a.b.c.d', '01.2.3.4', '', null].forEach(x => assert.strictEqual(C.ipToInt(x), null, String(x)));
});
test('bad CIDRs rejected', () => {
  ['10.0.0/24', '300.1.1.1/24', '10.0.0.0/33', '10.0.0.0', '', '10.0.0.0/', '/24', 'hello'].forEach(x => assert.ok(C.parseCidr(x).error, x));
});
test('masks and wildcards', () => {
  assert.strictEqual(C.intToIp(C.prefixToMask(24)), '255.255.255.0');
  assert.strictEqual(C.intToIp(C.prefixToMask(26)), '255.255.255.192');
  assert.strictEqual(C.intToIp(C.prefixToMask(31)), '255.255.255.254');
  assert.strictEqual(C.intToIp(C.prefixToMask(0)), '0.0.0.0');
  assert.strictEqual(C.intToIp(C.prefixToMask(32)), '255.255.255.255');
});
test('rangeToCidrs decomposes correctly', () => {
  const s = C.ipToInt('192.168.1.216'), e = C.ipToInt('192.168.1.255');
  assert.deepStrictEqual(C.rangeToCidrs(s, e).map(c => c.cidr), ['192.168.1.216/29', '192.168.1.224/27']);
  assert.deepStrictEqual(C.rangeToCidrs(0, 4294967295).map(c => c.cidr), ['0.0.0.0/0']);
});

console.log('VLSM allocation');
const UNEVEN = proj('192.168.1.0/24', [
  { name: 'D-small', hosts: 2 }, { name: 'A-big', hosts: 60 }, { name: 'C-mid', hosts: 10 }, { name: 'B-med', hosts: 28 },
]);
test('/24 split into 4 uneven networks (default 25% growth)', () => {
  const r = C.plan(UNEVEN);
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.strictEqual(by(r, 'A-big').cidr, '192.168.1.0/25');   // 60+15+3=78 -> 128
  assert.strictEqual(by(r, 'B-med').cidr, '192.168.1.128/26'); // 28+7+3=38 -> 64
  assert.strictEqual(by(r, 'C-mid').cidr, '192.168.1.192/28'); // 10+3+3=16 -> 16
  assert.strictEqual(by(r, 'D-small').cidr, '192.168.1.208/29'); // 2+1+3=6 -> 8
  assert.deepStrictEqual(r.allocations.map(a => a.name), ['A-big', 'B-med', 'C-mid', 'D-small']); // sorted by address
});
test('per-network fields: gateway first, masks, ranges, broadcast', () => {
  const a = by(C.plan(UNEVEN), 'B-med');
  assert.strictEqual(a.network, '192.168.1.128');
  assert.strictEqual(a.netmask, '255.255.255.192');
  assert.strictEqual(a.wildcard, '0.0.0.63');
  assert.strictEqual(a.gateway, '192.168.1.129');
  assert.strictEqual(a.firstUsable, '192.168.1.129');
  assert.strictEqual(a.lastUsable, '192.168.1.190');
  assert.strictEqual(a.broadcast, '192.168.1.191');
  assert.strictEqual(a.totalAddresses, 64);
  assert.strictEqual(a.usableHosts, 62);
  assert.strictEqual(a.staticStart, '192.168.1.130');
  assert.strictEqual(a.staticEnd, '192.168.1.139'); // 10 after gateway
  assert.strictEqual(a.dhcpStart, '192.168.1.140');
  assert.strictEqual(a.dhcpEnd, '192.168.1.190');
});
test('summary: free space and largest free block', () => {
  const r = C.plan(UNEVEN);
  assert.strictEqual(r.summary.used, 216);
  assert.strictEqual(r.summary.free, 40);
  assert.strictEqual(r.summary.largestFree.cidr, '192.168.1.224/27');
});
test('no-fit gives a clear error and reports what is left', () => {
  const r = C.plan(proj('192.168.1.0/24', [{ name: 'a', hosts: 100 }, { name: 'b', hosts: 100 }, { name: 'c', hosts: 100 }]));
  assert.strictEqual(r.ok, false);
  assert.ok(/does not fit/i.test(r.errors[0].msg), r.errors[0].msg);
  assert.ok(/\bc\b/.test(r.errors[0].msg));
  assert.deepStrictEqual(r.unplaced.map(u => u.name), ['c']);
  assert.strictEqual(r.allocations.length, 2);
});
test('growth buffer can push a network over the edge', () => {
  const nets = [{ name: 'a', hosts: 120 }, { name: 'b', hosts: 120 }];
  assert.strictEqual(C.plan(proj('10.0.0.0/24', nets, { growth: 0 })).ok, true);   // 123 -> /25 each
  assert.strictEqual(C.plan(proj('10.0.0.0/24', nets, { growth: 25 })).ok, false); // 153 -> /24 each
});
test('/31 transit link and /32 loopback', () => {
  const r = C.plan(proj('10.9.0.0/24', [{ name: 'LAN', hosts: 50 }, { name: 'Link', hosts: 2, role: 'Transit' }, { name: 'Lo0', hosts: 1, role: 'Loopback' }]));
  assert.ok(r.ok, JSON.stringify(r.errors));
  const l = by(r, 'Link'), lo = by(r, 'Lo0');
  assert.strictEqual(l.prefix, 31);
  assert.strictEqual(l.usableHosts, 2);
  assert.strictEqual(l.gateway, '');
  assert.strictEqual(l.broadcast, '');
  assert.strictEqual(l.netmask, '255.255.255.254');
  assert.strictEqual(l.firstUsable, l.network);
  assert.strictEqual(lo.prefix, 32);
  assert.strictEqual(lo.netmask, '255.255.255.255');
  assert.strictEqual(lo.usableHosts, 1);
  assert.strictEqual(lo.gateway, '');
});
test('alignment: every block starts on its own size boundary inside the parent', () => {
  const r = C.plan(proj('10.20.0.0/22', [
    { name: 'a', hosts: 200 }, { name: 'b', hosts: 60 }, { name: 'c', hosts: 100 }, { name: 'd', hosts: 12 },
    { name: 'e', hosts: 5 }, { name: 't', hosts: 2, role: 'Transit' }, { name: 'l', hosts: 1, role: 'Loopback' },
  ]));
  assert.ok(r.ok);
  const base = C.ipToInt('10.20.0.0');
  r.allocations.forEach(a => {
    assert.strictEqual((a.start - base) % a.size, 0, a.name + ' misaligned');
    assert.ok(a.start >= r.parent.start && a.end <= r.parent.end, a.name + ' outside parent');
  });
});
test('fuzz: 300 random plans never overlap and stay aligned', () => {
  let seed = 12345;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let k = 0; k < 300; k++) {
    const nets = [];
    const n = 1 + rnd(10);
    for (let i = 0; i < n; i++) nets.push({ name: 'n' + i, hosts: 1 + rnd(rnd(3) ? 60 : 400), role: rnd(8) === 0 ? 'Transit' : '' });
    const r = C.plan(proj('10.0.0.0/20', nets, { growth: rnd(60) }));
    assert.strictEqual(C.findOverlaps(r.allocations).length, 0);
    r.allocations.forEach(a => assert.strictEqual((a.start - r.parent.start) % a.size, 0));
    if (r.ok) assert.strictEqual(r.summary.used + r.summary.free, r.parent.size);
  }
});

console.log('Overlap and gaps');
test('findOverlaps detects overlap and ignores adjacent blocks', () => {
  const mk = (cidr, label) => { const p = C.parseCidr(cidr); return { start: p.start, end: p.end, label }; };
  assert.strictEqual(C.findOverlaps([mk('10.0.0.0/24', 'a'), mk('10.0.0.128/25', 'b')]).length, 1);
  assert.strictEqual(C.findOverlaps([mk('10.0.0.0/25', 'a'), mk('10.0.0.128/25', 'b')]).length, 0);
  assert.strictEqual(C.findOverlaps([mk('10.0.0.0/16', 'a'), mk('10.0.5.0/24', 'b'), mk('10.0.5.128/25', 'c')]).length, 3);
});
test('parent block that is not on a boundary is rejected', () => {
  const r = C.plan(proj('10.20.0.5/16', [{ name: 'a', hosts: 10 }]));
  assert.strictEqual(r.ok, false);
  assert.ok(/host bits/.test(r.errors[0].msg) && /10\.20\.0\.0\/16/.test(r.errors[0].msg), r.errors[0].msg);
});
test('gaps between allocations are reported (hand-built)', () => {
  const parent = C.parseCidr('10.0.0.0/24');
  const a = C.parseCidr('10.0.0.0/26'), b = C.parseCidr('10.0.0.128/25');
  const gaps = C.computeGaps(parent, [{ start: a.start, end: a.end }, { start: b.start, end: b.end }]);
  assert.strictEqual(gaps.length, 1);
  assert.strictEqual(gaps[0].between, true);
  assert.strictEqual(gaps[0].size, 64);
  assert.deepStrictEqual(gaps[0].cidrs.map(c => c.cidr), ['10.0.0.64/26']);
});
test('leading and trailing gaps are reported, tail not flagged as "between"', () => {
  const parent = C.parseCidr('10.0.0.0/24');
  const m = C.parseCidr('10.0.0.64/26');
  const gaps = C.computeGaps(parent, [{ start: m.start, end: m.end }]);
  assert.deepStrictEqual(gaps.map(g => [g.start - parent.start, g.size, g.between]), [[0, 64, true], [128, 128, false]]);
  assert.strictEqual(C.largestFreeBlock(gaps).cidr, '10.0.0.128/25');
});
test('gap reporting in a full plan', () => {
  const r = C.plan(UNEVEN);
  assert.strictEqual(r.gaps.length, 1);
  assert.strictEqual(r.gaps[0].size, 40);
  assert.strictEqual(r.gaps[0].between, false);
  const full = C.plan(proj('10.0.0.0/24', [{ name: 'a', hosts: 100, }], { growth: 0 }));
  assert.strictEqual(full.gaps[0].cidrs[0].cidr, '10.0.0.128/25');
});
test('completely full parent has no gaps and no free block', () => {
  const r = C.plan(proj('10.0.0.0/30', [{ name: 'a', hosts: 1 }], { growth: 0 }));
  assert.ok(r.ok);
  assert.strictEqual(r.gaps.length, 0);
  assert.strictEqual(r.summary.largestFree, null);
});

console.log('Validation');
const errs = (p) => C.plan(p).errors.map(e => e.msg).join(' | ');
test('bad parent CIDR', () => {
  ['10.0.0/24', '10.0.0.0/33', 'nope', ''].forEach(x => assert.ok(/Parent block/.test(errs(proj(x, [{ name: 'a', hosts: 1 }]))), x));
});
test('zero / negative / fractional / blank hosts', () => {
  ['0', 0, -5, 2.5, '', 'abc'].forEach(h => assert.ok(/hosts must be/.test(errs(proj('10.0.0.0/24', [{ name: 'a', hosts: h }]))), String(h)));
});
test('duplicate names (case-insensitive) and empty names', () => {
  assert.ok(/duplicate name/.test(errs(proj('10.0.0.0/24', [{ name: 'LAN', hosts: 5 }, { name: ' lan ', hosts: 5 }]))));
  assert.ok(/name is required/.test(errs(proj('10.0.0.0/24', [{ name: '  ', hosts: 5 }]))));
});
test('bad VLAN id, bad role, no networks, loopback > 1 host', () => {
  assert.ok(/VLAN ID must be/.test(errs(proj('10.0.0.0/24', [{ name: 'a', hosts: 5, vlan: 5000 }]))));
  assert.ok(/VLAN ID must be/.test(errs(proj('10.0.0.0/24', [{ name: 'a', hosts: 5, vlan: 0 }]))));
  assert.ok(/unknown role/.test(errs(proj('10.0.0.0/24', [{ name: 'a', hosts: 5, role: 'Bogus' }]))));
  assert.ok(/at least one network/.test(errs(proj('10.0.0.0/24', []))));
  assert.ok(/single \/32/.test(errs(proj('10.0.0.0/24', [{ name: 'a', hosts: 3, role: 'Loopback' }]))));
});
test('error rows are tagged for the UI', () => {
  const e = C.plan(proj('10.0.0.0/24', [{ name: 'ok', hosts: 5 }, { name: 'bad', hosts: 0 }])).errors[0];
  assert.strictEqual(e.row, 1);
  assert.strictEqual(e.field, 'hosts');
});
test('bad options are rejected', () => {
  assert.ok(/offset/.test(errs(proj('10.0.0.0/24', [{ name: 'a', hosts: 5 }], { dhcpOffset: -1 }))));
  assert.ok(/Growth/.test(errs(proj('10.0.0.0/24', [{ name: 'a', hosts: 5 }], { growth: 900 }))));
});

console.log('Options');
test('gateway last: gateway is last usable, static reserve starts at first usable', () => {
  const a = by(C.plan(proj('10.0.0.0/24', [{ name: 'a', hosts: 100 }], { gwPos: 'last', growth: 0 })), 'a');
  assert.strictEqual(a.cidr, '10.0.0.0/25');
  assert.strictEqual(a.gateway, '10.0.0.126');
  assert.strictEqual(a.staticStart, '10.0.0.1');
  assert.strictEqual(a.staticEnd, '10.0.0.10');
  assert.strictEqual(a.dhcpStart, '10.0.0.11');
  assert.strictEqual(a.dhcpEnd, '10.0.0.125'); // stops before the gateway
});
test('DHCP offset and static reserve size', () => {
  const a = by(C.plan(proj('10.0.0.0/24', [{ name: 'a', hosts: 100 }], { staticReserve: 20, dhcpOffset: 5, growth: 0 })), 'a');
  assert.strictEqual(a.staticEnd, '10.0.0.21');
  assert.strictEqual(a.dhcpStart, '10.0.0.27'); // 22 + offset 5
});
test('non-DHCP roles get no DHCP range; tiny network warns', () => {
  const r = C.plan(proj('10.0.0.0/24', [{ name: 'dmz', hosts: 20, role: 'DMZ' }, { name: 'tiny', hosts: 2 }]));
  assert.strictEqual(by(r, 'dmz').dhcpStart, '');
  assert.ok(by(r, 'dmz').staticStart);
  assert.strictEqual(by(r, 'tiny').dhcpStart, ''); // /29, 10 static reserve eats everything
  assert.ok(r.warnings.some(w => /tiny/.test(w)));
});

console.log('Exports');
test('CSV, Markdown, text, FortiOS, handover', () => {
  const p = proj('10.20.0.0/24', [
    { name: 'Staff, main', hosts: 20, vlan: 10, role: 'LAN' }, { name: 'Guest', hosts: 20, vlan: 20, role: 'Guest' },
    { name: 'Link', hosts: 2, role: 'Transit' }, { name: 'Lo', hosts: 1, role: 'Loopback' },
  ]);
  p.name = 'Test';
  const r = C.plan(p);
  assert.ok(r.ok, JSON.stringify(r.errors));
  const csv = F.toCSV(r).trim().split('\n');
  assert.strictEqual(csv.length, 5);
  assert.ok(csv[1].startsWith('"Staff, main",10,LAN,'));
  const md = F.toMarkdown(r, p);
  assert.ok(/\| Name \| VLAN/.test(md) && /\| --- \|/.test(md));
  assert.ok(/Network addressing/.test(F.toHandoverMarkdown(r, p)));
  assert.ok(/Gateway:/.test(F.toText(r, p)));
  const f = F.toFortiOS(r, p, 'port5');
  assert.ok(/config system interface/.test(f));
  assert.ok(/config system dhcp-server/.test(f));
  assert.ok(/set vlanid 10/.test(f) && /set interface "port5"/.test(f));
  assert.ok(/set dns-service default/.test(f) && /set default-gateway 10\.20\.0\./.test(f));
  assert.ok(/set ip 10\.20\.0\.\d+ 255\.255\.255\.254/.test(f)); // /31 transit
  assert.ok(/set type loopback/.test(f));
  assert.ok(/FortiOS 8\.0/.test(f) && /PLACEHOLDER/.test(f));
  assert.strictEqual((f.match(/edit \d+\n\s+set dns-service/g) || []).length, 2); // Staff + Guest only
});

// ================= Client-intake tests =================
const I = require('./intake.js');
const A = require('./access.js');
const eproj = (parent, networks, existing, opts) => ({ parent, networks, existing, opts });

console.log('Existing ranges');
test('networks are placed around an existing range in the middle', () => {
  const r = C.plan(eproj('10.0.0.0/24', [{ name: 'A', hosts: 60 }, { name: 'B', hosts: 60 }], ['10.0.0.64/26'], { growth: 0 }));
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.strictEqual(by(r, 'A').cidr, '10.0.0.0/26');
  assert.strictEqual(by(r, 'B').cidr, '10.0.0.128/26');
  assert.strictEqual(r.summary.reserved, 64);
  assert.strictEqual(r.summary.free, 256 - 128 - 64);
  assert.deepStrictEqual(r.conflicts.length, 1); // parent overlaps an existing range: red warning
  assert.ok(/overlaps existing range 10\.0\.0\.64\/26/.test(r.conflicts[0]));
  assert.strictEqual(r.gaps.map(g => g.size).join(), '64'); // only the tail, existing range is not "free"
});
test('no allocation ever overlaps any existing range (fuzz)', () => {
  let seed = 777;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let k = 0; k < 200; k++) {
    const ex = [];
    for (let i = 0, n = rnd(4); i < n; i++) ex.push(`10.0.${rnd(16)}.0/${24 + rnd(3) - 0}`.replace(/\/(\d+)$/, (m, p) => '/' + Math.min(24, Number(p))));
    const nets = [];
    for (let i = 0, n = 1 + rnd(6); i < n; i++) nets.push({ name: 'n' + i, hosts: 1 + rnd(120) });
    const r = C.plan(eproj('10.0.0.0/20', nets, ex, { growth: 25 }));
    const exr = ex.map(C.parseCidr);
    r.allocations.forEach(a => exr.forEach(e => assert.ok(a.end < e.start || a.start > e.end, `${a.cidr} hits ${ex}`)));
    r.allocations.forEach(a => assert.strictEqual((a.start - r.parent.start) % a.size, 0));
  }
});
test('existing range covering the whole parent => no fit, clear message', () => {
  const r = C.plan(eproj('10.0.0.0/24', [{ name: 'a', hosts: 10 }], ['10.0.0.0/16']));
  assert.strictEqual(r.ok, false);
  assert.ok(/does not fit/i.test(r.errors[0].msg) && /existing/.test(r.errors[0].msg));
  assert.strictEqual(r.conflicts.length, 1);
});
test('existing range outside the parent is ignored, no conflict', () => {
  const r = C.plan(eproj('10.20.0.0/24', [{ name: 'a', hosts: 10 }], ['192.168.1.0/24']));
  assert.ok(r.ok); assert.strictEqual(r.conflicts.length, 0); assert.strictEqual(r.summary.reserved, 0);
});
test('bad existing ranges are rejected; overlapping existing ranges warn', () => {
  assert.ok(/Existing range "10\.0\.0\/8"/.test(errs(eproj('10.0.0.0/24', [{ name: 'a', hosts: 1 }], ['10.0.0/8']))));
  assert.ok(/host bits/.test(errs(eproj('10.0.0.0/24', [{ name: 'a', hosts: 1 }], ['10.1.1.1/16']))));
  const r = C.plan(eproj('10.20.0.0/24', [{ name: 'a', hosts: 1 }], ['172.16.0.0/16', '172.16.5.0/24']));
  assert.ok(r.warnings.some(w => /overlap each other/.test(w)));
});

console.log('Parent auto-pick');
test('prefers a 10.x.0.0/16 and skips existing ranges', () => {
  assert.strictEqual(I.pickParent([]).cidr, '10.20.0.0/16');
  assert.strictEqual(I.pickParent(['10.20.0.0/16']).cidr, '10.21.0.0/16');
  assert.strictEqual(I.pickParent(['10.20.5.0/24', '10.21.0.0/24']).cidr, '10.22.0.0/16');
  assert.strictEqual(I.pickParent(['10.20.0.0/14']).cidr, '10.24.0.0/16'); // /14 covers 10.20-10.23
});
test('falls back to 172.17+/16 (172.16 and 192.168 hold common home ranges, so are never auto-picked), then null', () => {
  assert.strictEqual(I.pickParent(['10.0.0.0/8']).cidr, '172.17.0.0/16');
  assert.strictEqual(I.pickParent(['10.0.0.0/8', '172.16.0.0/12']), null);
  assert.strictEqual(I.pickParent(['10.0.0.0/8', '172.17.0.0/16']).cidr, '172.18.0.0/16');
});
test('invalid existing entries are ignored by the picker; parsing accepts lines, commas, spaces', () => {
  assert.strictEqual(I.pickParent(['nonsense']).cidr, '10.20.0.0/16');
  assert.deepStrictEqual(I.parseExisting('10.0.0.0/8, 192.168.1.0/24\n172.16.0.0/12;  '), ['10.0.0.0/8', '192.168.1.0/24', '172.16.0.0/12']);
  assert.deepStrictEqual(I.parseExisting(''), []);
});
test('picked parent never overlaps an existing range (fuzz)', () => {
  let seed = 4242;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let k = 0; k < 200; k++) {
    const ex = []; for (let i = 0, n = rnd(6); i < n; i++) ex.push(`10.${rnd(60)}.0.0/${12 + rnd(12)}`.replace(/10\.(\d+)\.0\.0\/(\d+)/, (m, x, p) => { const pre = Number(p); const size = Math.pow(2, 32 - pre); const net = Math.floor((10 * 16777216 + x * 65536) / size) * size; return C.intToIp(net) + '/' + pre; }));
    const p = I.pickParent(ex);
    if (!p) continue;
    ex.map(C.parseCidr).forEach(e => assert.ok(p.start + 65535 < e.start || p.start > e.end, p.cidr + ' vs ' + ex));
  }
});

console.log('Intake -> suggested networks');
const withCounts = (counts, req, expansion, existing) => {
  const c = I.newClient('T'); Object.assign(c.intake.counts, counts); Object.assign(c.intake.req, req || {});
  c.intake.expansion = expansion || 'none'; c.intake.existing = existing || ''; return I.applyIntake(c);
};
const names = c => c.networks.map(n => n.name);
test('always suggests Management, Staff LAN, Transit, Loopback; Servers only when ticked', () => {
  assert.deepStrictEqual(names(withCounts({})), ['Management', 'Staff LAN', 'Transit', 'Loopback']);
  assert.deepStrictEqual(names(withCounts({ servers: 4 })), ['Management', 'Staff LAN', 'Transit', 'Loopback']); // count alone does nothing
  assert.deepStrictEqual(names(withCounts({ servers: 4 }, { servers: true })), ['Management', 'Staff LAN', 'Servers', 'Transit', 'Loopback']);
});
test('each ticked box plans its own network (checkbox-driven)', () => {
  const c = withCounts({ staff: 10, voice: 12, cameras: 4, iot: 3, guest: 8, dmz: 2, servers: 3 }, { servers: true, voice: true, cameras: true, iot: true, guest: true, dmz: true });
  assert.deepStrictEqual(names(c), ['Management', 'Staff LAN', 'Servers', 'Guest', 'DMZ', 'Voice', 'Cameras', 'IoT', 'Transit', 'Loopback']);
  ['voice', 'cameras', 'iot', 'guest', 'dmz', 'servers'].forEach(k => {
    const one = withCounts({ staff: 10, voice: 12, cameras: 4, iot: 3, guest: 8, dmz: 2, servers: 3 }, { [k]: true });
    assert.strictEqual(names(one).length, 5, k); // 4 always-on + only the ticked one
  });
});
test('unticked boxes are not planned and their counts are ignored; ticked with no count is sized for 2', () => {
  const c = withCounts({ staff: 10, wired: 2, voice: 5, guest: 4, dmz: 3 });
  assert.deepStrictEqual(names(c), ['Management', 'Staff LAN', 'Transit', 'Loopback']);
  assert.strictEqual(c.networks.find(n => n.name === 'Staff LAN').hosts, 12); // nothing folded in
  const ticked0 = withCounts({ staff: 10 }, { voice: true, guest: true });
  assert.strictEqual(ticked0.networks.find(n => n.name === 'Voice').hosts, 2);
  assert.ok(ticked0.genNotes.some(n => /Voice was ticked with no count/.test(n)));
});
test('host counts: staff = staff+wired+wifi, servers min 2, mgmt = 10 + APs', () => {
  const c = withCounts({ staff: 20, wired: 5, wifi: 61, servers: 1 }, { servers: true });
  const net = n => c.networks.find(x => x.name === n);
  assert.strictEqual(net('Staff LAN').hosts, 86);
  assert.strictEqual(net('Servers').hosts, 2);
  assert.strictEqual(net('Management').hosts, 13); // ceil(61/30)=3
  assert.strictEqual(net('Transit').hosts, 2);
  assert.strictEqual(net('Loopback').hosts, 1);
});
test('auto VLAN IDs by role, editable, Transit/Loopback none', () => {
  const c = withCounts({ staff: 5, voice: 5, cameras: 5, iot: 5, guest: 5, dmz: 5, servers: 5 }, { servers: true, voice: true, cameras: true, iot: true, guest: true, dmz: true });
  const v = {}; c.networks.forEach(n => { v[n.name] = n.vlan; });
  assert.deepStrictEqual(v, { Management: 10, 'Staff LAN': 20, Servers: 30, Voice: 40, Cameras: 50, IoT: 60, Guest: 70, DMZ: 80, Transit: '', Loopback: '' });
  c.networks[1].vlan = 200; // editable
  assert.strictEqual(C.plan(I.toProject(c)).allocations.find(a => a.name === 'Staff LAN').vlan, 200);
});
test('roles and DHCP defaults on suggested networks', () => {
  const c = withCounts({ staff: 5, guest: 5, dmz: 2, servers: 2 }, { servers: true, guest: true, dmz: true });
  const r = C.plan(I.toProject(c));
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.ok(by(r, 'Staff LAN').dhcpStart && by(r, 'Guest').dhcpStart);
  ['Management', 'Servers', 'DMZ', 'Transit', 'Loopback'].forEach(n => assert.strictEqual(by(r, n).dhcpStart, '', n));
  assert.strictEqual(by(r, 'Management').role, 'Mgmt');
});

console.log('Expansion buffer');
test('None / Soon / Big growth = 25 / 50 / 100 % and change the sizing', () => {
  const pre = x => { const c = withCounts({ staff: 40 }, {}, x); c.opts.style = 'packed'; const r = C.plan(I.toProject(c)); assert.ok(r.ok, JSON.stringify(r.errors)); return [c.opts.growth, by(r, 'Staff LAN').prefix, by(r, 'Staff LAN').buffer]; };
  assert.deepStrictEqual(pre('none'), [25, 26, 10]); // 40+10+3=53 -> /26
  assert.deepStrictEqual(pre('soon'), [50, 26, 20]); // 40+20+3=63 -> /26
  assert.deepStrictEqual(pre('big'), [100, 25, 40]); // 40+40+3=83 -> /25
});

console.log('Applying intake');
test('applyIntake avoids existing ranges and keeps a manual parent override', () => {
  const c = withCounts({ staff: 10 }, {}, 'none', '10.20.0.0/16\n10.21.0.0/16');
  assert.strictEqual(c.parent, '10.22.0.0/16');
  c.parent = '10.99.0.0/16'; c.parentAuto = false;
  I.applyIntake(c);
  assert.strictEqual(c.parent, '10.99.0.0/16'); // override kept
  c.parentAuto = true; I.applyIntake(c);
  assert.strictEqual(c.parent, '10.22.0.0/16');
});
test('manual parent that overlaps an existing range raises a red conflict but still plans', () => {
  const c = withCounts({ staff: 10 }, {}, 'none', '10.50.4.0/24');
  c.parent = '10.50.0.0/16'; c.parentAuto = false;
  const r = C.plan(I.toProject(c));
  assert.ok(r.ok); assert.strictEqual(r.conflicts.length, 1);
  r.allocations.forEach(a => assert.ok(a.end < C.ipToInt('10.50.4.0') || a.start > C.ipToInt('10.50.4.255')));
});
test('sample clients build valid plans', () => {
  Object.keys(I.SAMPLES).forEach(k => {
    const c = I.sampleClient(k), r = C.plan(I.toProject(c));
    assert.ok(r.ok, k + ' ' + JSON.stringify(r.errors));
    assert.strictEqual(C.findOverlaps(r.allocations).length, 0);
  });
  const b = I.sampleClient('Small branch with DMZ');
  assert.strictEqual(b.parent, '10.21.0.0/16'); // HQ 10.20/16 avoided
  assert.strictEqual(b.opts.growth, 50);
  assert.deepStrictEqual(names(b), ['Management', 'Staff LAN', 'Servers', 'Guest', 'DMZ', 'Voice', 'Cameras', 'Transit', 'Loopback']);
});

console.log('Access rules and outputs');
const sample = () => { const c = I.sampleClient('Small branch with DMZ'); const p = I.toProject(c); return { c, p, r: C.plan(p) }; };
test('access matrix: guest and DMZ isolated, staff reaches servers, mgmt restricted', () => {
  const { r } = sample();
  const g = n => r.allocations.find(a => a.name === n);
  assert.strictEqual(A.allowed(g('Staff LAN'), g('Servers')), true);
  assert.strictEqual(A.allowed(g('Guest'), g('Staff LAN')), false);
  assert.strictEqual(A.allowed(g('DMZ'), g('Servers')), false);
  assert.strictEqual(A.allowed(g('Staff LAN'), g('Management')), false);
  assert.strictEqual(A.allowed(g('Management'), g('Servers')), true);
  assert.strictEqual(A.internetAllowed(g('Guest')), true);
  assert.strictEqual(A.internetAllowed(g('Cameras')), false);
  const m = A.matrix(r.allocations);
  assert.ok(!m.cols.includes('Transit') && !m.cols.includes('Loopback'));
});
test('FortiOS: interfaces, DHCP, address objects, starter policies, note, placeholder', () => {
  const { p, r } = sample();
  const f = F.toFortiOS(r, p, 'port9');
  ['config system interface', 'config system dhcp-server', 'config firewall address', 'config firewall addrgrp', 'config firewall policy'].forEach(s => assert.ok(f.includes(s), s));
  assert.ok(/^# Generated, untested\. Verify against FortiOS 8\.0 docs and the lab VM before applying\. Starter policies are not production rules\./m.test(f));
  assert.strictEqual(f.split('\n')[1].startsWith('# Generated, untested'), true); // note is at the top
  const stop = Math.min(...['# Website filtering', '# Application control', 'config firewall policy\n'].map(s => f.indexOf(s)).filter(i => i > 0));
  const objs = f.slice(f.indexOf('config firewall address\n'), stop);                                   // address objects and groups only (web filter profiles are counted elsewhere)
  assert.strictEqual((objs.match(/edit "SP_/g) || []).length, r.allocations.length + 1); // one object per subnet + SP_INTERNAL
  assert.ok(f.includes('set interface "port9"') && /PLACEHOLDER: "port9"/.test(f));
  const pol = f.slice(f.indexOf('config firewall policy'));
  assert.ok(pol.indexOf('Guest_to_internal_block') > -1 && pol.indexOf('Guest_to_internal_block') < pol.indexOf('Staff_LAN_to_internet')); // denies first
  assert.ok(/set name "SP_Staff_LAN_to_internet"/.test(pol) && /set service "DNS" "HTTP" "HTTPS"/.test(pol));
  assert.ok(/set name "SP_Staff_LAN_to_Servers"/.test(pol));
  assert.ok(/set name "SP_DMZ_to_internal_block"[\s\S]*?set action deny/.test(pol));
  assert.ok(!/set name "SP_Cameras_to_internet"/.test(pol) && !/SP_Transit_to/.test(pol)); // cameras get no internet allow (an explicit block rule is fine)
  pol.split('policy\n')[1].split('    edit 0').slice(1).forEach(b => assert.ok(/set name "[^"]{1,35}"/.test(b)));
});
test('handover doc: all required sections in Markdown and HTML', () => {
  const { p, r } = sample();
  const md = F.toHandoverDoc(r, p);
  ['Requirements summary', 'IP address table', 'Why each network exists', 'Who can talk to who', 'Growth notes', 'WAN / VPN notes'].forEach(s => assert.ok(md.includes(s), s));
  assert.ok(md.includes('IPsec tunnel to HQ'));            // WAN note shown in the doc
  assert.ok(md.includes('10.20.0.0/16'));                    // existing ranges listed
  assert.ok(md.includes('Soon (50% growth buffer)'));
  assert.ok(/\*\*Staff LAN\*\*.*25 staff/.test(md));        // reason tied to the client need
  assert.ok(/\| From \\ To \| Internet \|/.test(md));
  const html = F.toHandoverHTML(r, p);
  assert.ok(/<h2>4\. Who can talk to who<\/h2>/.test(html) && html.includes('<table'));
  assert.ok(!/<script/i.test(F.toHandoverHTML(r, Object.assign({}, p, { name: '<script>x</script>', intake: Object.assign({}, p.intake, { wanNote: '<img onerror=x>' }) }))));
});
test('WAN note is not planned (no network created from it)', () => {
  const { c } = sample();
  assert.ok(!c.networks.some(n => /wan|vpn/i.test(n.name)));
});

console.log('Network map');
test('topology SVG: one card per network, loopback in firewall box, escaped, valid for 1-3 columns', () => {
  const { p, r } = sample();
  const T = require('./topology.js');
  [1, 2, 3].forEach(cols => {
    const svg = T.build(r, p, { cols, theme: 'light', standalone: true });
    assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>') && svg.includes('xmlns='));
    r.allocations.filter(a => a.role !== 'Loopback').forEach(a => assert.ok(svg.includes(a.cidr) && svg.includes('>' + a.name + '<'), a.name));
    assert.ok(svg.includes('Loopback ' + r.allocations.find(a => a.role === 'Loopback').network + '/32'));
    assert.strictEqual((svg.match(/<title>/g) || []).length, r.allocations.length - 1);
    assert.strictEqual(svg.split('<svg').length, 2);
  });
  const evil = Object.assign({}, p, { networks: p.networks.map((n, i) => (i === 1 ? Object.assign({}, n, { name: '<b>x</b>&' }) : n)) });
  const re = C.plan(evil);
  assert.ok(!/<b>x<\/b>/.test(T.build(re, evil, { cols: 1 })) && /&lt;b&gt;x&lt;\/b&gt;&amp;/.test(T.build(re, evil, { cols: 1 })));
});

console.log('IPv6');
const C6 = require('./calc6.js');
const v6sample = (prefix) => { const { c, p, r } = sample(); C6.annotate(r, { enabled: true, prefix: prefix || '2001:db8:abcd::/48' }); return { c, p, r }; };
test('IPv6 parse/format round trip and compression', () => {
  assert.strictEqual(C6.formatIp6(C6.parseIp6('2001:0db8:0000:0000:0000:0000:0000:0001')), '2001:db8::1');
  assert.strictEqual(C6.formatIp6(C6.parseIp6('::')), '::');
  assert.strictEqual(C6.formatIp6(C6.parseIp6('fe80::1:0:0:1')), 'fe80::1:0:0:1');
  assert.strictEqual(C6.formatIp6(C6.parseIp6('1:0:2:3:4:5:6:7')), '1:0:2:3:4:5:6:7'); // single zero group is not compressed
  ['', 'g::1', '1:2:3', '1::2::3', ':::', '12345::1'].forEach(b => assert.strictEqual(C6.parseIp6(b), null, b));
});
test('IPv6 prefix validation', () => {
  assert.strictEqual(C6.validatePrefix('2001:db8:1:ff::/48').cidr, '2001:db8:1::/48');
  assert.ok(C6.validatePrefix('2001:db8::/64').error, '/64 has no room for subnets');
  assert.ok(C6.validatePrefix('nonsense').error);
  assert.ok(C6.validatePrefix('2001:db8::').error);
  assert.ok(C6.validatePrefix('xyz::/48').error);
});
test('generated ULA is a valid fd00::/8 /48 and differs between calls', () => {
  const a = C6.generateUla(), b = C6.generateUla();
  assert.ok(/^fd[0-9a-f]{2}:/.test(a) && a.endsWith('::/48'));
  assert.ok(!C6.validatePrefix(a).error);
  assert.notStrictEqual(a, b);
  assert.strictEqual(C6.annotate({ allocations: [] }, { enabled: true, prefix: a }).length, 0);
});
test('IPv6 plan: /64 per network, VLAN digits as subnet, transit /127, loopback /128, no overlaps', () => {
  const { r } = v6sample();
  const g = n => r.allocations.find(a => a.name === n);
  assert.strictEqual(g('Management').v6.cidr, '2001:db8:abcd:10::/64');
  assert.strictEqual(g('Staff LAN').v6.cidr, '2001:db8:abcd:20::/64');
  assert.strictEqual(g('Staff LAN').v6.address, '2001:db8:abcd:20::1');
  assert.strictEqual(g('Transit').v6.prefix, 127);
  assert.strictEqual(g('Loopback').v6.prefix, 128);
  assert.strictEqual(new Set(r.allocations.map(a => a.v6.cidr)).size, r.allocations.length);
  assert.strictEqual(r.v6.kind, 'GUA');
  assert.ok(r.allocations.every(a => a.v6.cidr.startsWith('2001:db8:abcd:')));
});
test('IPv6 disabled or invalid: no v6 data, IPv4 results untouched', () => {
  const { r } = sample();
  const before = JSON.stringify(r.allocations);
  C6.annotate(r, { enabled: false, prefix: '2001:db8::/48' });
  assert.ok(!r.v6 && r.allocations.every(a => !a.v6));
  assert.strictEqual(C6.annotate(r, { enabled: true, prefix: 'bad' }).length, 1);
  assert.ok(r.v6Error && r.allocations.every(a => !a.v6));
  assert.strictEqual(JSON.stringify(r.allocations), before);
});
test('IPv6 subnet ids never collide (duplicate and missing VLANs)', () => {
  const r = { allocations: [
    { name: 'A', vlan: 20, role: 'LAN' }, { name: 'B', vlan: 20, role: 'LAN' }, { name: 'C', vlan: '', role: 'LAN' }, { name: 'D', vlan: 500, role: 'LAN' }, { name: 'T', vlan: '', role: 'Transit' },
  ] };
  const warns = C6.annotate(r, { enabled: true, prefix: 'fd00:1:2::/48' });
  assert.strictEqual(new Set(r.allocations.map(a => a.v6.cidr)).size, 5);
  assert.ok(warns.length >= 1);
});
test('IPv6 in outputs: CSV, text, FortiOS address6 / policy6, handover doc; v4-only output unchanged', () => {
  const { p, r } = v6sample();
  const csv = F.toCSV(r).split('\n');
  assert.ok(/IPv6 subnet,IPv6 gateway$/.test(csv[0]) && csv[1].includes('2001:db8:abcd:'));
  assert.ok(F.toText(r, p).includes('IPv6 site prefix: 2001:db8:abcd::/48'));
  const fo = F.toFortiOS(r, p, 'port5');
  assert.ok(fo.includes('config ipv6') && fo.includes('set ip6-address 2001:db8:abcd:20::1/64') && fo.includes('ip6-send-adv enable'));
  assert.ok(fo.includes('config firewall address6') && fo.includes('config firewall policy6') && fo.includes('SP6_INTERNAL'));
  assert.ok(fo.includes(F.FORTI_NOTE) && fo.indexOf('config firewall policy6') > fo.indexOf('config firewall policy\n'));
  const md = F.toHandoverDoc(r, p);
  assert.ok(md.includes('IPv6 subnet') && md.includes('IPv6 site prefix') && !md.includes('undefined'));
  assert.ok(F.toHandoverHTML(r, p).includes('2001:db8:abcd:10::/64'));
  const v4 = sample();
  assert.ok(!F.toFortiOS(v4.r, v4.p, 'port5').includes('ipv6') && !F.toCSV(v4.r).includes('IPv6') && F.toHandoverDoc(v4.r, v4.p).includes('Not planned'));
});
test('new clients default to dual stack with a ULA; map shows IPv6', () => {
  const c = I.newClient('x');
  assert.ok(c.v6.enabled && !C6.validatePrefix(c.v6.prefix).error);
  const { p, r } = v6sample();
  const svg = require('./topology.js').build(r, p, { cols: 1, theme: 'light', standalone: true });
  assert.ok(svg.includes('v6 2001:db8:abcd:20::/64'));
});

console.log('Addressing style: /24 per VLAN');
const v24 = (counts, req, mod) => { const c = withCounts(counts, req); if (mod) mod(c); const p = I.toProject(c); return { c, p, r: C.plan(p) }; };
const third = cidr => Number(cidr.split('.')[2]);
test('default style: one /24 per VLAN, third octet = VLAN ID (VLAN 20 = 10.x.20.0/24)', () => {
  const { c, r } = v24({ staff: 20, servers: 2, guest: 5, dmz: 2, voice: 5, cameras: 5, iot: 5 }, { servers: true, guest: true, dmz: true, voice: true, cameras: true, iot: true });
  assert.strictEqual(c.opts.style, 'vlan24');
  assert.ok(r.ok, JSON.stringify(r.errors)); assert.strictEqual(r.style, 'vlan24'); assert.ok(!r.styleNote);
  const base = c.parent.split('.').slice(0, 2).join('.');
  const vlans = r.allocations.filter(a => a.vlan !== '');
  assert.strictEqual(vlans.length, 8);
  vlans.forEach(a => {
    assert.strictEqual(a.cidr, `${base}.${a.vlan}.0/24`, a.name);
    assert.strictEqual(third(a.cidr), a.vlan);
    assert.strictEqual(a.gateway, `${base}.${a.vlan}.1`);
    assert.strictEqual(a.netmask, '255.255.255.0');
  });
  assert.strictEqual(r.allocations.find(a => a.name === 'Staff LAN').cidr, `${base}.20.0/24`);
  assert.strictEqual(C.findOverlaps(r.allocations).length, 0);
});
test('Transit is a /31 and Loopback a /32, both in the third-octet-0 block', () => {
  const { c, r } = v24({ staff: 10 });
  const base = c.parent.split('.').slice(0, 2).join('.');
  const t = r.allocations.find(a => a.name === 'Transit'), l = r.allocations.find(a => a.name === 'Loopback');
  assert.strictEqual(t.prefix, 31); assert.strictEqual(l.prefix, 32);
  assert.strictEqual(third(t.cidr), 0); assert.strictEqual(third(l.cidr), 0);
  assert.ok(t.cidr.startsWith(base + '.0.') && l.cidr.startsWith(base + '.0.'));
  assert.strictEqual(C.findOverlaps(r.allocations).length, 0);
});
test('vlan24 fallback to packed with a note: parent too small / existing range in the way / duplicate VLAN / more than a /24', () => {
  const small = v24({ staff: 20 }, {}, c => { c.parent = '10.50.0.0/22'; c.parentAuto = false; });
  assert.ok(small.r.ok); assert.strictEqual(small.r.style, 'packed'); assert.ok(/smaller than a \/16/.test(small.r.styleNote));
  assert.ok(small.r.allocations.every(a => a.cidr.startsWith('10.50.')));
  const hit = v24({ staff: 20 }, {}, c => { c.parent = '10.60.0.0/16'; c.parentAuto = false; c.intake.existing = '10.60.20.0/24'; });
  assert.strictEqual(hit.r.style, 'packed'); assert.ok(/VLAN 20/.test(hit.r.styleNote) && /existing range/.test(hit.r.styleNote));
  const dup = v24({ staff: 20, guest: 5 }, { guest: true }, c => { c.networks.find(n => n.name === 'Guest').vlan = 20; });
  assert.strictEqual(dup.r.style, 'packed'); assert.ok(/VLAN 20 is used by more than one/.test(dup.r.styleNote));
  const big = v24({ staff: 400 });
  assert.strictEqual(big.r.style, 'packed'); assert.ok(/needs more than a \/24/.test(big.r.styleNote));
  [small, hit, dup, big].forEach(x => assert.strictEqual(C.findOverlaps(x.r.allocations).length, 0));
});
test('vlan24 keeps the existing-range rules: auto parent avoids existing ranges, plan still valid', () => {
  const c = withCounts({ staff: 20 }, {}, 'none', '10.20.0.0/16\n10.21.0.0/16'), r = C.plan(I.toProject(c));
  assert.strictEqual(c.parent, '10.22.0.0/16'); assert.ok(r.ok); assert.strictEqual(r.style, 'vlan24');
});
test('Calc.plan without a style option stays packed (backward compatible); packed can be chosen', () => {
  const p = { parent: '10.0.0.0/24', networks: [{ name: 'A', hosts: 20, vlan: 20, role: 'LAN' }] };
  const r = C.plan(p); assert.strictEqual(r.style, 'packed'); assert.strictEqual(r.allocations[0].prefix, 27);
  const c = withCounts({ staff: 20 }); c.opts.style = 'packed'; I.applyIntake(c);
  assert.strictEqual(c.opts.style, 'packed'); assert.strictEqual(C.plan(I.toProject(c)).style, 'packed');
});
test('migrating an older client: Servers stays on only if it had a count', () => {
  const old = I.newClient('old'); delete old.intake.req.servers; old.intake.counts.servers = 3; delete old.v6;
  I.migrate(old); assert.strictEqual(old.intake.req.servers, true); assert.strictEqual(old.v6.enabled, false);
  const none = I.newClient('old2'); delete none.intake.req.servers; none.intake.counts.servers = 0;
  I.migrate(none); assert.strictEqual(none.intake.req.servers, false);
});

console.log('Client report');
const CR = require('./report.js');
test('client report: sections, cover, map, plain wording, no CLI', () => {
  const { p, r } = sample();
  p.name = 'Acme Dental'; p.site = 'Perth'; p.date = '2026-11-20';
  const h = CR.build(r, p, '<svg id="themap"></svg>');
  ['What you asked for', 'Your network map', 'Your networks', 'Who can reach what', 'Room to grow', 'Internet connection and remote access'].forEach(s => assert.ok(h.includes(s), s));
  assert.ok(h.includes('Acme Dental') && h.includes('Perth') && h.includes('2026-11-20'));
  assert.ok(h.includes('<svg id="themap">'));
  assert.ok(h.includes('@media print') && h.includes('@page'));
  assert.ok(h.includes('exit point'));                               // gateway explained plainly
  assert.ok(h.includes('IPsec tunnel to HQ'));                       // WAN note shown
  assert.ok(/Internet only/.test(h));                                 // e.g. guests
  const body = h.slice(h.indexOf('<body>')).replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ');
  ['VLAN', 'CIDR', 'gateway', 'subnet', 'DHCP', 'config ', 'FortiOS', 'netmask'].forEach(w => assert.ok(!new RegExp(w, 'i').test(body), 'jargon: ' + w));
  r.allocations.filter(a => a.prefix !== 32).forEach(a => assert.ok(h.includes(a.firstUsable), a.name));
});
test('plain map for the client report: names and ranges only, no technical labels', () => {
  const T = require('./topology.js');
  const { p, r } = v6sample();
  const svg = T.build(r, p, { cols: 2, theme: 'light', standalone: true, plain: true });
  r.allocations.filter(a => a.prefix !== 32 && a.prefix !== 31).forEach(a => assert.ok(svg.includes(a.name) && svg.includes(a.firstUsable), a.name));
  ['VLAN', 'GW ', 'v6 ', '/31', '/32', '/24', 'WAN', 'Loopback'].forEach(w => assert.ok(!svg.includes(w), 'jargon: ' + w));
  assert.ok(T.build(r, p, { theme: 'light' }).includes('VLAN'));      // normal diagram unchanged
});
test('client report: escapes client text and handles a missing map or WAN note', () => {
  const { p, r } = sample();
  p.name = '<script>x</script>'; p.site = '<img onerror=x>'; p.intake = Object.assign({}, p.intake, { wanNote: '<b>hi</b>' });
  const h = CR.build(r, p);
  assert.ok(!/<script>x/.test(h) && !/<img onerror/.test(h) && !h.includes('<b>hi</b>'));
  assert.ok(h.includes('The map is not available'));
  p.intake.wanNote = '';
  assert.ok(CR.build(r, p).includes('No details about your internet connection'));
});

console.log('Other device pools');
test('"Other" pools become their own networks (VLAN 90, 100...), sized by count, names made unique', () => {
  const c = I.newClient('x'); c.intake.counts.staff = 20;
  c.intake.others = [{ name: 'Printers', count: '12' }, { name: 'printers', count: '' }, { name: '', count: '5' }, { name: 'Staff LAN', count: 3 }];
  I.applyIntake(c); const r = C.plan(I.toProject(c));
  assert.ok(r.ok, JSON.stringify(r.errors));
  const nets = c.networks.filter(n => n.kind === 'other');
  assert.deepStrictEqual(nets.map(n => n.name), ['Printers', 'printers 2', 'Other 3', 'Staff LAN 2']);
  assert.deepStrictEqual(nets.map(n => n.vlan), [90, 100, 110, 120]);
  assert.strictEqual(by(r, 'Printers').cidr, r.parent.cidr.replace(/\d+\.0\/16$/, '90.0/24'));
  assert.strictEqual(nets[1].hosts, 2);                                  // no count -> 2
  assert.ok(c.genNotes.some(n => /no device count/.test(n)));
});
test('"Other" pools are internet-only, reachable from Management, and capped', () => {
  const A = require('./access.js');
  const c = I.newClient('x'); c.intake.counts.staff = 10; c.intake.others = [{ name: 'Printers', count: 4 }];
  I.applyIntake(c); const r = C.plan(I.toProject(c));
  const m = A.matrix(r.allocations); const row = m.rows.find(x => x.name === 'Printers');
  assert.strictEqual(row.internet, true); assert.ok(row.cells.every(v => v !== true));
  assert.strictEqual(m.rows.find(x => x.name === 'Management').cells[m.cols.indexOf('Printers')], true);
  c.intake.others = Array.from({ length: 15 }, (_, i) => ({ name: 'P' + i, count: 1 }));
  I.applyIntake(c); assert.strictEqual(c.networks.filter(n => n.kind === 'other').length, I.MAX_OTHERS);
});
test('"Other" pools appear in the client report and old clients migrate', () => {
  const c = I.newClient('x'); c.intake.counts.staff = 10; c.intake.others = [{ name: 'Printers', count: 4 }];
  I.applyIntake(c); const p = I.toProject(c), r = C.plan(p);
  const h = require('./report.js').build(r, p);
  assert.ok(h.includes('4 Printers') && h.includes('A separate network for your Printers devices'));
  const old = I.newClient('old'); delete old.intake.others; I.migrate(old); assert.deepStrictEqual(old.intake.others, []);
});

console.log('Policies');
const Pol = require('./policy.js');
const polSample = () => { const { c, p, r } = sample(); return { c, p, r, al: r.allocations }; };
const flat = list => list.map(x => `${x.src}>${x.dst}:${x.service}:${x.action}`);
test('defaults reproduce the old starter policies and still export them', () => {
  const { p, r, al } = polSample();
  const d = Pol.defaults(al);
  assert.ok(d.some(x => x.src === 'Guest' && x.dst === 'internet' && x.service === 'DNS,HTTP,HTTPS' && x.nat));
  assert.ok(d.some(x => x.src === 'Guest' && x.dst === 'internal' && x.action === 'deny'));
  assert.ok(!d.some(x => /Transit|Loopback/.test(x.src)));
  const f = F.toFortiOS(r, p, 'port5');
  assert.ok(/set name "SP_Guest_to_internal_block"/.test(f) && f.includes(Pol.NOTE));
});
test('tagline: "Guests can access the internet but nothing else"', () => {
  const { al } = polSample();
  const t = Pol.parse('Guests can access the internet but nothing else', al);
  assert.deepStrictEqual(flat(t.policies), ['Guest>internet:DNS,HTTP,HTTPS:accept', 'Guest>internal:ALL:deny']);
  assert.deepStrictEqual(t.unparsed, []);
  assert.deepStrictEqual(flat(Pol.parse('Cameras internet only', al).policies).length, 2);
});
test('tagline templates: can\'t reach, can reach on a service, blocked from', () => {
  const { al } = polSample();
  assert.deepStrictEqual(flat(Pol.parse("Guests can't reach servers", al).policies), ['Guest>Servers:ALL:deny']);
  assert.deepStrictEqual(flat(Pol.parse('Staff can reach servers on https and ssh', al).policies), ['Staff LAN>Servers:HTTPS,SSH:accept']);
  assert.deepStrictEqual(flat(Pol.parse('Cameras blocked from the internet', al).policies), ['Cameras>internet:ALL:deny']);
  assert.deepStrictEqual(flat(Pol.parse('Voice cannot reach cameras on ssh. Guests can reach the DMZ on web', al).policies), ['Voice>Cameras:SSH:deny', 'Guest>DMZ:HTTP,HTTPS:accept']);
});
test('unknown tagline is reported, not guessed', () => {
  const { al } = polSample();
  ['Make everything faster', 'Guests', 'Staff can reach servers on bananas', 'Printers can reach servers'].forEach(s => {
    const t = Pol.parse(s, al); assert.strictEqual(t.policies.length, 0, s); assert.ok(t.unparsed.length >= 1 && t.unparsed[0].why, s);
  });
  const mixed = Pol.parse("Guests can't reach servers. Blah blah", al);
  assert.strictEqual(mixed.policies.length, 1); assert.strictEqual(mixed.unparsed.length, 1);
});
test('applying parsed policies: replaces same source+destination, denies first', () => {
  const { al } = polSample();
  let list = Pol.defaults(al);
  list = Pol.apply(list, Pol.parse('Guests internet only', al));
  assert.deepStrictEqual(flat(list).filter(x => x.startsWith('Guest')), ['Guest>internal:ALL:deny', 'Guest>internet:DNS,HTTP,HTTPS:accept']);
  list = Pol.apply(list, Pol.parse("Staff can't reach servers", al));
  assert.strictEqual(flat(list)[0], 'Staff LAN>Servers:ALL:deny');
  assert.strictEqual(list.filter(x => x.src === 'Staff LAN' && x.dst === 'Servers').length, 1);
});
test('FortiOS: edited policies replace the defaults, ordered, with NAT/log, profiles and a final deny', () => {
  const { c, p, r, al } = polSample();
  const mk = Pol.mkPolicy;
  c.pol = { edited: true, list: [
    mk({ src: 'Guest', dst: 'internal', action: 'deny', name: '' }),
    mk({ src: 'Guest', dst: 'internet', service: 'DNS,HTTPS', nat: true, log: false, web: { mode: 'block', sites: 'https://bad.example.com/x, evil.test', cats: [26, 61] }, app: { mode: 'block', cats: [2, 6] } }),
    mk({ src: 'Staff LAN', dst: 'Servers', service: 'SMB', nat: false }),
    mk({ src: 'Gone', dst: 'internet' }),
  ] };
  const f = F.toFortiOS(r, I.toProject(c), 'port5');
  const pol = f.slice(f.indexOf('config firewall policy'));
  assert.ok(!/SP_Staff_LAN_to_internet/.test(pol));                     // defaults are gone
  assert.ok(pol.indexOf('SP_Guest_to_internal_block') < pol.indexOf('SP_Guest_to_internet') && pol.indexOf('SP_Guest_to_internet') < pol.indexOf('SP_Final_deny'));
  assert.ok(/set name "SP_Guest_to_internet"[\s\S]*?set service "DNS" "HTTPS"[\s\S]*?set nat enable[\s\S]*?set logtraffic disable[\s\S]*?set webfilter-profile "SP_Web_1"[\s\S]*?set application-list "SP_App_1"/.test(pol));
  assert.ok(/set name "SP_Staff_LAN_to_Servers"[\s\S]*?set service "SMB"/.test(pol) && !/SP_Staff_LAN_to_Servers"[\s\S]{0,300}set nat enable/.test(pol));
  assert.ok(/config webfilter urlfilter[\s\S]*set url "bad.example.com"[\s\S]*set url "evil.test"/.test(f) && /set category 26/.test(f) && /config application list[\s\S]*set category 2 6[\s\S]*set action block/.test(f));
  assert.ok(/# Skipped \(network not in the current plan\): Gone to internet/.test(f));
  assert.ok(/edit 0\s+set name "SP_Final_deny"[\s\S]*set action deny/.test(f) && f.trim().split('\n').slice(-1)[0].includes('Generated, untested'));
  assert.ok(f.includes(Pol.NOTE) && f.includes(F.FORTI_NOTE));
  const only = F.toPolicyFortiOS(r, I.toProject(c), 'port5');
  assert.ok(only.includes('config firewall policy') && !only.includes('config system interface') && only.includes(Pol.NOTE));
  Pol.resolve(c.pol.list, al).pols.forEach(x => assert.ok(x.name.length <= 40));
  c.pol = { edited: false, list: [] };                                  // reset: defaults follow the plan again
  assert.ok(/SP_Staff_LAN_to_internet/.test(F.toFortiOS(r, I.toProject(c), 'port5')));
});
test('FortiOS: allow-list web and app profiles end with a catch-all block', () => {
  const { c, r } = polSample();
  c.pol = { edited: true, list: [Pol.mkPolicy({ src: 'Staff LAN', dst: 'internet', nat: true, web: { mode: 'allow', sites: 'work.example.com', cats: [] }, app: { mode: 'allow', cats: [3] } })] };
  const f = F.toFortiOS(r, I.toProject(c), 'port5');
  assert.ok(/set url "work.example.com"[\s\S]*set action allow[\s\S]*set url "\*"[\s\S]*set type wildcard[\s\S]*set action block/.test(f));
  assert.ok(/edit 1[\s\S]*set category 3[\s\S]*set action pass[\s\S]*edit 2[\s\S]*set action block/.test(f.slice(f.indexOf('config application list'))));
});

console.log('Remote access');
const R = require('./remote.js');
const remoteClient = (count, mod) => {
  const c = I.newClient('r'); c.intake.counts.staff = 20; c.intake.counts.servers = 3; c.intake.req.servers = true;
  c.intake.remote = { on: true, count, reach: null }; if (mod) mod(c); I.applyIntake(c);
  return { c, p: I.toProject(c), r: C.plan(I.toProject(c)) };
};
const parsedIn = (cidr, list) => { const q = C.parseCidr(cidr); return list.some(x => { const h = C.parseCidr(x); return h.start <= q.end && h.end >= q.start; }); };
test('auto-pick never lands on a common home range', () => {
  R.HOME_RANGES.forEach(h => assert.ok(!parsedIn(h, [])));              // sanity: list parses
  const blockedAll = ['10.2.0.0/15', '10.4.0.0/14', '10.8.0.0/13', '10.16.0.0/12', '10.32.0.0/11', '10.64.0.0/10', '10.128.0.0/9'];
  for (const ex of [[], ['10.20.0.0/16'], blockedAll, blockedAll.concat(['10.0.0.0/16'])]) {
    const pk = I.pickParent(ex); assert.ok(pk, ex.join()); assert.ok(!R.homeClashes([pk.cidr]).length, pk.cidr);
    const q = C.parseCidr(pk.cidr);
    R.HOME_RANGES.forEach(h => { const hp = C.parseCidr(h); assert.ok(!(hp.start <= q.end && hp.end >= q.start), pk.cidr + ' vs ' + h); });
  }
  assert.strictEqual(I.pickParent(blockedAll).cidr, '172.17.0.0/16');   // 10.0/10.1 and 172.16 hold home ranges
});
test('VPN pool: sized from remote staff + growth buffer, aligned, outside every office network', () => {
  const a = remoteClient('30').p; const ra = C.plan(a); const pa = R.plan(ra, a);
  assert.ok(pa.ok && pa.where === 'inside');
  assert.strictEqual(pa.need, Math.ceil(30 * 1.25));                      // growth None = 25%
  assert.ok(pa.usable >= pa.need && pa.usable / 2 < pa.need + 2);         // smallest block that fits
  const pp = C.parseCidr(pa.cidr); assert.strictEqual(pp.network, pp.ip);
  assert.ok(pp.start >= ra.parent.start && pp.end <= ra.parent.end);
  ra.allocations.forEach(x => { const q = C.parseCidr(x.cidr); assert.ok(q.end < pp.start || q.start > pp.end, x.name); });
  const big = remoteClient('200', c => { c.intake.expansion = 'big'; });  // 200 * 2 = 400 -> /23
  assert.strictEqual(R.plan(big.r, big.p).prefix, 23);
  const tiny = remoteClient('', null); assert.strictEqual(R.plan(tiny.r, tiny.p).need, 2);
  assert.ok(R.plan(tiny.r, tiny.p).notes.length === 1);
  const off = remoteClient('5', c => { c.intake.remote.on = false; }); assert.strictEqual(R.plan(off.r, off.p), null);
});
test('VPN pool avoids existing ranges and home ranges, and falls back when the office block is full', () => {
  const { r, p } = remoteClient('10', c => { c.intake.existing = '10.99.255.0/24'; c.parentAuto = false; c.parent = '10.99.0.0/16'; });
  const pool = R.plan(r, p);
  assert.ok(pool.ok && !parsedIn(pool.cidr, ['10.99.255.0/24']) && pool.end < C.parseCidr('10.99.255.0/24').start);
  const full = remoteClient('10', c => { c.parentAuto = false; c.parent = '10.50.0.0/24'; c.opts.style = 'packed'; });
  const fp = R.plan(full.r, full.p);
  if (fp.ok) { const q = C.parseCidr(fp.cidr); full.r.allocations.forEach(x => { const o = C.parseCidr(x.cidr); assert.ok(o.end < q.start || o.start > q.end, x.name); }); }
});
test('split tunnel: Staff and Servers by default, tick list overrides, only internal networks offered', () => {
  const { r, p, c } = remoteClient('10');
  assert.deepStrictEqual(R.plan(r, p).reach, ['Staff LAN', 'Servers']);
  assert.ok(R.reachable(r).every(a => ['transit', 'loopback', 'guest', 'dmz'].indexOf(require('./access.js').kindOf(a)) < 0));
  c.intake.remote.reach = { Management: true, Servers: false, 'Staff LAN': true };
  assert.deepStrictEqual(R.plan(r, I.toProject(c)).reach, ['Management', 'Staff LAN']);
});
test('split tunnel: an empty tick map means nothing is reachable (no policies), not the defaults', () => {
  const { r, p, c } = remoteClient('10'); c.intake.remote.reach = {};
  assert.deepStrictEqual(R.plan(r, I.toProject(c)).reach, []);
  const f = F.toRemoteFortiOS(r, I.toProject(c), 'port5');
  assert.ok(!f.includes('SP_VPN_SPLIT') && !f.includes('RemoteStaff-to-') && f.includes('No office networks are ticked'));
});
test('home-range clash warning: existing ranges, manual office block, and only when remote staff are ticked', () => {
  const a = remoteClient('10', c => { c.intake.existing = '192.168.1.0/24, 10.1.0.0/16'; });
  const w = R.warnings(a.r, a.p);
  assert.strictEqual(w.length, 2); assert.ok(w[0].startsWith('Remote-worker clash') && w[0].includes('192.168.1.0/24') && /home/.test(w[0]));
  const m = remoteClient('10', c => { c.parentAuto = false; c.parent = '192.168.0.0/16'; });
  assert.ok(R.warnings(m.r, m.p).some(x => x.includes('The office network')));
  const off = remoteClient('10', c => { c.intake.existing = '192.168.1.0/24'; c.intake.remote.on = false; });
  assert.deepStrictEqual(R.warnings(off.r, off.p), []);
  assert.deepStrictEqual(R.warnings(remoteClient('10').r, remoteClient('10').p), []);
});
test('IPsec remote access CLI: pool, split tunnel, matching policy, placeholders and the note', () => {
  const { r, p } = remoteClient('30');
  const f = F.toRemoteFortiOS(r, p, 'port5'), pool = R.plan(r, p);
  assert.ok(f.includes('config vpn ipsec phase1-interface') && f.includes('config vpn ipsec phase2-interface'));
  assert.ok(f.includes(`set ipv4-start-ip ${pool.first}`) && f.includes(`set ipv4-end-ip ${pool.last}`) && f.includes('set ipv4-split-include "SP_VPN_SPLIT"'));
  assert.ok(/set member "SP_Staff_LAN" "SP_Servers"/.test(f) && /set srcintf "SP_VPN"[\s\S]*set dstintf "vlan20"/.test(f) && /set dstintf "vlan30"/.test(f));
  assert.ok(f.includes('PSK_CHANGE_ME') && f.includes('set authusrgrp "RemoteStaff"') && f.includes(F.FORTI_NOTE));
  // Bob's guide: IKE version not forced, DH 20/21, narrow services, group in the policy, NAT off, all sessions logged
  assert.ok(!/ike-version/.test(f.replace(/^#.*$/gm, '')) && f.includes('set dhgrp 20 21') && f.includes('set service "SMB" "HTTPS" "RDP"') && !f.includes('set service "ALL"'));
  assert.ok(f.includes('set groups "RemoteStaff"') && f.includes('set nat disable') && f.includes('set logtraffic all') && f.includes('RemoteStaff-to-Servers'));
  assert.strictEqual(F.toRemoteFortiOS(remoteClient('5', c => { c.intake.remote.on = false; }).r, remoteClient('5', c => { c.intake.remote.on = false; }).p), '');
});
test('plan diagram and client report include the VPN pool in plain language', () => {
  const T = require('./topology.js');
  const { r, p } = remoteClient('30'); const pool = R.plan(r, p);
  const svg = T.build(r, p, { cols: 2, theme: 'light', standalone: true, vpn: pool });
  assert.ok(svg.includes('REMOTE STAFF (VPN)') && svg.includes('Remote staff (VPN)') && svg.includes(pool.cidr));
  assert.ok(!T.build(r, p, { theme: 'light' }).includes('Remote staff'));
  const h = CR.build(r, p, svg);
  assert.ok(h.includes('Remote working') && h.includes(pool.first) && h.includes('Staff LAN, Servers') && h.includes('8. Web protection') && h.includes('9. Internet connection'))   // sections number on: rules 5, grow 6, remote 7, web 8, WAN 9
  const body = h.slice(h.indexOf('<body>')).replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ');
  ['VLAN', 'CIDR', 'gateway', 'subnet', 'DHCP', 'IPsec', 'FortiOS', 'netmask'].forEach(w => assert.ok(!new RegExp(w, 'i').test(body), 'jargon: ' + w));
  assert.ok(!CR.build(C.plan(sample().p), sample().p).includes('Remote working'));
  const clash = remoteClient('10', c => { c.intake.existing = '192.168.1.0/24'; });
  assert.ok(CR.build(clash.r, clash.p).includes('One thing to check'));
});
test('older clients migrate: remote, policies and tagline get defaults', () => {
  const old = I.newClient('old'); delete old.intake.remote; delete old.pol; delete old.tagline; I.migrate(old);
  assert.deepStrictEqual(old.intake.remote, { on: false, count: '', reach: null }); assert.deepStrictEqual(old.pol, { edited: false, list: [], toggles: {} }); assert.strictEqual(old.tagline, '');
});

console.log('Policy cards (phase 1)');
const Cards = require('./cards.js');
// A client with every optional network ticked, so every card has something to attach to.
const fullClient = (mod) => {
  const c = I.newClient('Full'); const n = c.intake;
  Object.assign(n.counts, { staff: 20, wifi: 10, servers: 2, guest: 10, dmz: 2, voice: 10, cameras: 4, iot: 5, printers: 3, pos: 3 });
  Object.keys(n.req).forEach(k => { n.req[k] = true; });
  n.others = [{ name: 'Lab', count: 3 }]; n.remote = { on: true, count: 3, reach: null };
  if (mod) mod(c);
  I.applyIntake(c); const p = I.toProject(c); return { c, p, r: C.plan(p) };
};
const polFlat = list => list.map(x => `${x.src}>${x.dst}:${x.service}:${x.action}`);
test('library: unique ids, valid tier/risk, a reason and at least one scenario tag on every card', () => {
  const ids = new Set();
  Cards.LIBRARY.forEach(c => {
    assert.ok(!ids.has(c.id), 'duplicate ' + c.id); ids.add(c.id);
    assert.ok(Cards.TIERS.includes(c.tier) && Cards.RISKS.includes(c.risk), c.id);
    assert.ok(c.name && c.why && c.tags.length, c.id);
    assert.ok(c.tags.every(t => Cards.SCENARIOS.includes(t)), c.id + ' has an unknown scenario tag');
    if (c.type === 'policy') assert.ok(Array.isArray(c.src) && c.src.length && c.dst && ['accept', 'deny'].includes(c.action) && c.service, c.id);
    else assert.ok(c.text && typeof c.when === 'function', c.id);
  });
});
test('library: every required scenario has at least one card', () => {
  Cards.SCENARIOS.forEach(s => assert.ok(Cards.LIBRARY.some(c => c.tags.includes(s)), 'no card for ' + s));
  ['staff-lan', 'guest', 'iot', 'servers-dmz', 'voip', 'printers', 'pos-pci', 'management', 'wifi-ap'].forEach(s => assert.ok(Cards.LIBRARY.some(c => c.type === 'policy' && c.tags.includes(s)), 'no policy card for ' + s));
});
test('cards only appear when their networks are in the plan', () => {
  const { r } = polSample();                                       // Small branch: no printers, POS or IoT ticked
  const ids = Cards.library(r.allocations, {}).map(e => e.card.id);
  assert.ok(ids.includes('guest-deny-internal') && ids.includes('staff-servers') && ids.includes('voice-servers'));
  ['staff-printers', 'pos-deny-internal', 'iot-deny-internal', 'advice-remote-vpn'].forEach(x => assert.ok(!ids.includes(x), x));
  const full = fullClient().r;
  const all = Cards.library(full.allocations, { intake: { remote: { on: true }, siteVpn: true, dualWan: true, counts: { wifi: 10 } } }).map(e => e.card.id);
  ['staff-printers', 'pos-deny-internal', 'iot-deny-internal', 'printers-deny-internal', 'mgmt-lockdown', 'advice-remote-vpn', 'advice-site-vpn', 'advice-dual-wan', 'advice-guest-isolation', 'advice-ap-mgmt'].forEach(x => assert.ok(all.includes(x), x));
});
test('defaults: baseline + recommended on, optional off; explicit denies come before allows', () => {
  const { r, al } = Object.assign(polSample(), {});
  const d = Pol.defaults(al); const f = polFlat(d);
  assert.ok(f.includes('Guest>internal:ALL:deny') && f.includes('Guest>internet:DNS,HTTP,HTTPS:accept'));
  assert.ok(f.indexOf('Guest>internal:ALL:deny') < f.indexOf('Staff LAN>internet:ALL:accept'));
  const lastDeny = Math.max(...d.map((x, i) => (x.action === 'deny' ? i : -1))), firstAllow = d.findIndex(x => x.action === 'accept');
  assert.ok(lastDeny < firstAllow, 'denies are not all above the allows');
  assert.ok(!d.some(x => x.card === 'pos-servers' || x.card === 'staff-mgmt-admin'));           // optional: off
  assert.ok(d.every(x => x.card && Cards.byId(x.card)), 'every generated policy names its card');
});
test('defaults for the full scenario: the explicit denies and isolations are there', () => {
  const { r } = fullClient(); const f = polFlat(Pol.defaults(r.allocations));
  ['Guest>internal:ALL:deny', 'IoT>internal:ALL:deny', 'POS>internal:ALL:deny', 'Staff LAN>POS:ALL:deny', 'Printers>internal:ALL:deny', 'Cameras>internet:ALL:deny',
    'Voice>Management:ALL:deny', 'Staff LAN>Printers:SP_PRINT:accept', 'POS>internet:DNS,HTTPS,NTP:accept', 'Management>Servers:ALL:accept', 'Lab>internal:ALL:deny']
    .forEach(x => assert.ok(f.includes(x), 'missing ' + x));
  assert.ok(!f.some(x => /^(Printers|Cameras)>internet:.*accept/.test(x)) && !f.some(x => /^Staff LAN>Management/.test(x)));  // printers/cameras get no internet allow; staff cannot reach management
  assert.ok(!f.some(x => /^(Guest|POS|Printers)>(Staff LAN|Servers)/.test(x) && x.endsWith('accept')));                    // nobody isolated can reach staff or servers
});
test('default policies agree with the "who can talk to who" matrix', () => {
  [polSample().r, fullClient().r].forEach(r => {
    const m = A.matrix(r.allocations), d = Pol.defaults(r.allocations);
    const first = (src, dst) => { const hit = d.find(x => x.src === src && (x.dst === dst || x.dst === 'internal' && (dst !== 'internet'))); return !!hit && hit.action === 'accept'; };
    m.rows.forEach(row => {
      const internetPol = d.find(x => x.src === row.name && x.dst === 'internet' && x.action === 'accept');
      assert.strictEqual(!!internetPol, row.internet, `${row.name} internet`);
      row.cells.forEach((cell, i) => { if (cell === 'self') return; assert.strictEqual(first(row.name, m.cols[i]), cell, `${row.name} > ${m.cols[i]}`); });
    });
  });
});
test('optional cards: toggled on before editing they join the defaults; the list still follows the plan', () => {
  const { c, r } = fullClient();
  c.pol = { edited: false, list: [], toggles: { 'pos-servers': true, 'printers-deny-internal': false } };
  const d = Pol.effective(I.toProject(c), r.allocations);
  assert.ok(d.some(x => x.card === 'pos-servers') && !d.some(x => x.card === 'printers-deny-internal'));
  assert.strictEqual(d[0].card, 'pos-servers');                                                  // narrow exceptions sit above the denies
  c.pol.toggles['guest-deny-internal'] = false;                                                  // baseline cannot be switched off
  assert.ok(Pol.effective(I.toProject(c), r.allocations).some(x => x.card === 'guest-deny-internal'));
});
test('optional cards: switching one on or off in an edited (frozen) list adds or removes just its rules', () => {
  const { r, al } = Object.assign(fullClient(), {}); const al2 = r.allocations;
  let list = Pol.defaults(al2); const n0 = list.length;
  list = Pol.setCardInList(list, 'dmz-backend', true, al2);
  assert.strictEqual(list.length, n0 + 1); assert.strictEqual(list[0].card, 'dmz-backend');
  list = Pol.setCardInList(list, 'staff-mgmt-admin', true, al2);
  assert.ok(list.some(x => x.card === 'staff-mgmt-admin') && list.findIndex(x => x.card === 'staff-mgmt-admin') > list.findLastIndex(x => x.action === 'deny'));
  list = Pol.setCardInList(list, 'dmz-backend', false, al2); list = Pol.setCardInList(list, 'staff-mgmt-admin', false, al2);
  assert.strictEqual(list.length, n0);
  const mine = Pol.mkPolicy({ src: 'Staff LAN', dst: 'Servers' });                              // the engineer's own policies are never touched
  assert.ok(Pol.setCardInList([mine], 'iot-deny-internal', true, al2).includes(mine));
});
test('cardView: in a frozen list a card is "on" when its policies are present', () => {
  const { c, r } = fullClient();
  c.pol = { edited: true, list: Pol.defaults(r.allocations).filter(x => x.card !== 'iot-deny-internal'), toggles: {} };
  const v = Pol.cardView(I.toProject(c), r.allocations);
  assert.strictEqual(v.find(e => e.card.id === 'iot-deny-internal').on, false);
  assert.strictEqual(v.find(e => e.card.id === 'staff-internet').on, true);
});
test('exports work with the card policies: FortiOS (names <= 35, no skipped), policy-only, and the policy parser', () => {
  const { p, r } = fullClient();
  const f = F.toFortiOS(r, p, 'port5'), pol = f.slice(f.indexOf('config firewall policy\n'));
  assert.ok(!/# Skipped/.test(f));
  assert.ok(/set name "SP_POS_to_internal_block"/.test(pol) && /set name "SP_Staff_LAN_to_Printers"/.test(pol) && /set name "SP_Staff_LAN_to_POS_block"/.test(pol));
  pol.split('policy\n')[1].split('    edit 0').slice(1).forEach(b => assert.ok(/set name "[^"]{1,35}"/.test(b)));
  assert.ok(/set name "SP_POS_to_internet"[\s\S]*?set service "DNS" "HTTPS" "NTP"[\s\S]*?set nat enable/.test(pol));
  assert.ok(/set name "SP_Voice_to_Management_block"[\s\S]*?set action deny/.test(pol));
  assert.ok(f.includes(F.FORTI_NOTE) && f.trim().split('\n').slice(-1)[0].includes('Generated, untested'));
  const only = F.toPolicyFortiOS(r, p, 'port5'); assert.ok(only.includes('SP_Final_deny') && !only.includes('config system interface'));
  const names = [...pol.matchAll(/set name "(SP_[^"]+)"/g)].map(m => m[1]); assert.strictEqual(new Set(names).size, names.length, 'duplicate policy names');
  const al = r.allocations;
  assert.deepStrictEqual(polFlat(Pol.parse('Printers cannot reach servers', al).policies), ['Printers>Servers:ALL:deny']);
  assert.deepStrictEqual(polFlat(Pol.parse('Card terminals internet only', al).policies).length, 2);
  const merged = Pol.apply(Pol.defaults(al), Pol.parse('Staff can reach printers on ssh', al));
  assert.strictEqual(merged[merged.findIndex(x => x.src === 'Staff LAN' && x.dst === 'Printers')].service, 'SSH');
  assert.strictEqual(merged.filter(x => x.src === 'Staff LAN' && x.dst === 'Printers').length, 1);
  const txt = F.toText(r, p), csv = F.toCSV(r, p); assert.ok(txt.includes('Printers') && csv.includes('POS'));
  const doc = F.toHandoverDoc(r, p); assert.ok(doc.includes('Printers VLAN') && doc.includes('Card payments (POS) isolated'));
});
test('report and diagram cope with the new network kinds', () => {
  const { p, r } = fullClient();
  const h = CR.build(r, p); assert.ok(h.includes('Your printers and copiers') && h.includes('card terminals'));
  assert.ok(require('./topology.js').build(r, p, { cols: 1, theme: 'light', standalone: true }).includes('POS'));
});
test('older saved clients (no toggles, no card ids) still load and export', () => {
  const { c, r } = fullClient(); const old = JSON.parse(JSON.stringify(c)); delete old.pol.toggles; old.pol = { edited: true, list: [Pol.mkPolicy({ src: 'Staff LAN', dst: 'internet', nat: true })] };
  I.migrate(old); assert.deepStrictEqual(old.pol.toggles, {});
  const f = F.toFortiOS(r, I.toProject(old), 'port5'); assert.ok(/set name "SP_Staff_LAN_to_internet"/.test(f));
  const ok = Pol.resolve(old.pol.list, r.allocations); assert.strictEqual(ok.pols[0].card, '');
});

console.log('Auto-suggest (phase 2)');
const S = require('./suggest.js');
const siteClient = (staff, req, extra, counts) => {
  const c = I.newClient('Site'); c.intake.counts.staff = staff; Object.assign(c.intake.counts, counts || {});
  Object.keys(req || {}).forEach(k => { c.intake.req[k] = !!req[k]; }); Object.assign(c.intake, extra || {});
  I.applyIntake(c); const p = I.toProject(c); return { c, p, r: C.plan(p) };
};
const stateIn = (r, p, id) => Pol.cardView(p, r.allocations).find(e => e.card.id === id);
test('size bands come from the staff count', () => {
  assert.deepStrictEqual([0, 1, 15, 16, 75, 76, 400].map(S.sizeOf), ['small', 'small', 'small', 'medium', 'medium', 'large', 'large']);
});
test('every present card gets a tier and a "because" naming the input that triggered it', () => {
  const { r, p } = siteClient(25, { guest: true, servers: true, printers: true, pos: true }, { remote: { on: true, count: 3, reach: null } }, { guest: 5, servers: 1, printers: 2, pos: 2 });
  const view = Pol.cardView(p, r.allocations);
  view.forEach(e => assert.ok(e.because, 'no reason for ' + e.card.id));
  assert.ok(/Guest wifi ticked/.test(stateIn(r, p, 'guest-deny-internal').because));
  assert.ok(/Printers ticked/.test(stateIn(r, p, 'staff-printers').because));
  assert.ok(/Card payments \(POS\) ticked/.test(stateIn(r, p, 'pos-deny-internal').because));
  assert.ok(/Remote staff ticked/.test(stateIn(r, p, 'advice-remote-vpn').because));
});
test('baseline is always on, whatever the answers', () => {
  ['clinic', 'school', 'retail', 'office', ''].forEach(ind => {
    const { r, p } = siteClient(10, { guest: true, servers: true, dmz: true, voice: true, cameras: true, iot: true }, { industry: ind, voip: 'hosted', serversWhere: 'cloud' });
    Pol.cardView(p, r.allocations).filter(e => e.tier === 'baseline').forEach(e => assert.strictEqual(e.on, true, e.card.id));
    assert.ok(Pol.effective(p, r.allocations).some(x => x.card === 'guest-deny-internal'));
  });
});
test('size changes the suggestion: management lockdown is optional (off) for a small office, recommended (on) for a medium one', () => {
  const small = siteClient(8, { voice: true }, {}, { voice: 4 }), med = siteClient(40, { voice: true }, {}, { voice: 20 });   // the card needs phones or cameras to attach to
  assert.deepStrictEqual([stateIn(small.r, small.p, 'mgmt-lockdown').tier, stateIn(small.r, small.p, 'mgmt-lockdown').on], ['optional', false]);
  assert.deepStrictEqual([stateIn(med.r, med.p, 'mgmt-lockdown').tier, stateIn(med.r, med.p, 'mgmt-lockdown').on], ['recommended', true]);
  assert.ok(/small site \(8 staff/.test(stateIn(small.r, small.p, 'mgmt-lockdown').because) && /medium site \(40 staff\)/.test(stateIn(med.r, med.p, 'mgmt-lockdown').because));
  assert.ok(!Pol.effective(small.p, small.r.allocations).some(y => y.card === 'mgmt-lockdown') && Pol.effective(med.p, med.r.allocations).some(y => y.card === 'mgmt-lockdown'));
});
test('industry changes the suggestion: a small clinic gets the management lockdown, and printers stay off the internet', () => {
  const office = siteClient(8, { voice: true, printers: true }, {}, { voice: 8, printers: 1 }), clinic = siteClient(8, { voice: true, printers: true }, { industry: 'clinic' }, { voice: 8, printers: 1 });
  assert.strictEqual(stateIn(office.r, office.p, 'mgmt-lockdown').on, false);
  const cl = stateIn(clinic.r, clinic.p, 'mgmt-lockdown'); assert.ok(cl.on && /clinic/.test(cl.because));
  assert.strictEqual(stateIn(clinic.r, clinic.p, 'printers-internet').on, false);
  assert.ok(Pol.effective(clinic.p, clinic.r.allocations).some(x => x.card === 'mgmt-lockdown') && !Pol.effective(office.p, office.r.allocations).some(x => x.card === 'mgmt-lockdown'));
});
test('VoIP answer: hosted phones need no server rule, an on-site PBX keeps it', () => {
  const mk = voip => siteClient(20, { voice: true, servers: true }, { voip }, { voice: 10, servers: 1 });
  const h = mk('hosted'), o = mk('onprem'), n = mk('');
  assert.strictEqual(stateIn(h.r, h.p, 'voice-servers').on, false);
  assert.strictEqual(stateIn(o.r, o.p, 'voice-servers').on, true);
  assert.strictEqual(stateIn(n.r, n.p, 'voice-servers').on, true);                                  // not stated: the old default
  assert.ok(Pol.effective(h.p, h.r.allocations).some(x => x.src === 'Voice' && x.dst === 'internet') && !Pol.effective(h.p, h.r.allocations).some(x => x.src === 'Voice' && x.dst === 'Servers'));
});
test('answers that add cards: dual WAN, site-to-site VPN, FortiAP and cloud-only show their advice', () => {
  const { r, p, c } = siteClient(20, { guest: true }, { dualWan: true, siteVpn: true, wifi: 'fortiap', serversWhere: 'cloud' });
  const ids = Pol.cardView(p, r.allocations).map(e => e.card.id);
  ['advice-dual-wan', 'advice-site-vpn', 'advice-ap-mgmt', 'advice-cloud-only'].forEach(x => assert.ok(ids.includes(x), x));
  assert.ok(/FortiAP/.test(stateIn(r, p, 'advice-ap-mgmt').because));
  const plain = siteClient(20, { guest: true }); assert.ok(!Pol.cardView(plain.p, plain.r.allocations).some(e => e.card.id === 'advice-dual-wan'));
  assert.ok(c.intake.dualWan === true);
});
test('notes call out answers that contradict the ticks', () => {
  const t = (req, extra) => { const x = siteClient(10, req, extra); return S.run(x.r.allocations, x.c.intake).notes.join(' | '); };
  assert.ok(/Servers network is not ticked/.test(t({}, { serversWhere: 'onprem' })));
  assert.ok(/cloud only, yet the Servers network is ticked/.test(t({ servers: true }, { serversWhere: 'cloud' })));
  assert.ok(/Voice \/ phones is not ticked/.test(t({}, { voip: 'hosted' })));
  assert.ok(/Tick Card payments/.test(t({}, { industry: 'retail' })) && !/Tick Card payments/.test(t({ pos: true }, { industry: 'retail' })));
  assert.ok(/tick Guest wifi/.test(t({}, { wifi: 'thirdparty' })) && t({ guest: true }, { wifi: 'thirdparty' }) === '');
  assert.strictEqual(t({}, {}), '');                                                              // no answers, no notes
});
test('suggestions only seed the list: once edited it is frozen, and Reset brings the suggestions back', () => {
  const { c, r } = siteClient(40, { guest: true, servers: true });
  c.pol = { edited: false, list: [], toggles: {} };
  const before = Pol.effective(I.toProject(c), r.allocations).length;
  c.pol.list = Pol.effective(I.toProject(c), r.allocations).slice(0, 3); c.pol.edited = true;
  c.intake.industry = 'clinic'; c.intake.voip = 'hosted'; c.intake.dualWan = true;                // answers change after the edit
  assert.strictEqual(Pol.effective(I.toProject(c), r.allocations).length, 3);                      // frozen
  c.pol = { edited: false, list: [], toggles: {} };
  assert.strictEqual(Pol.effective(I.toProject(c), r.allocations).length, before);                // 'clinic' adds nothing here, 'hosted' phones are not in this plan
  const small = siteClient(5, { voice: true }, {}, { voice: 4 });
  assert.ok(!Pol.effective(I.toProject(small.c), small.r.allocations).some(x => x.card === 'mgmt-lockdown'));
  small.c.intake.industry = 'clinic';                                                              // an answer changes before any edit: the list follows
  assert.ok(Pol.effective(I.toProject(small.c), small.r.allocations).some(x => x.card === 'mgmt-lockdown'));
});
test('older clients migrate: the new answers get blank defaults and the policies still export', () => {
  const old = I.newClient('old'); ['industry', 'serversWhere', 'wifi', 'voip', 'dualWan', 'siteVpn'].forEach(k => delete old.intake[k]); I.migrate(old);
  assert.deepStrictEqual([old.intake.industry, old.intake.serversWhere, old.intake.wifi, old.intake.voip, old.intake.dualWan, old.intake.siteVpn], ['', '', '', '', false, false]);
  old.intake.counts.staff = 10; I.applyIntake(old); const p = I.toProject(old), r = C.plan(p);
  assert.ok(F.toFortiOS(r, p, 'port5').includes('SP_Staff_LAN_to_internet'));
  assert.ok(F.toHandoverDoc(r, p).indexOf('Site profile') < 0);                                    // nothing stated: no profile line
  old.intake.industry = 'clinic'; old.intake.dualWan = true; assert.ok(/Site profile:\*\* Clinic, dual WAN/.test(F.toHandoverDoc(r, I.toProject(old))));
});
test('suggest.js, cards.js and calc.js stay free of DOM code', () => {
  ['suggest.js', 'cards.js', 'calc.js', 'policy.js', 'access.js'].forEach(f => assert.ok(!/\b(document|window|localStorage|navigator)\b\./.test(require('fs').readFileSync(require('path').join(__dirname, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')), f));
});

console.log('Web filter categories (phase 3)');
const W = require('./webcat.js');
const webClient = (extra, req) => siteClient(20, Object.assign({ guest: true, servers: true, iot: true }, req || {}), extra, { guest: 5, servers: 1, iot: 3 });
const webOf = (p, r, src) => Pol.effective(p, r.allocations).find(x => x.src === src && x.dst === 'internet' && x.action === 'accept');
test('webcat: five groups with the required categories, unique ids, every group has an action control', () => {
  assert.deepStrictEqual(W.GROUP_IDS, ['always', 'most', 'productivity', 'bandwidth', 'business']);
  const names = g => W.groupOf(g).cats.map(c => c.name.toLowerCase()).join('|');
  ['malicious', 'phishing', 'proxy avoidance', 'botnet'].forEach(x => assert.ok(names('always').includes(x), x));
  ['adult', 'gambling', 'illegal'].forEach(x => assert.ok(names('most').includes(x), x));
  ['social', 'games', 'shopping'].forEach(x => assert.ok(names('productivity').includes(x), x));
  ['streaming', 'file sharing', 'peer-to-peer'].forEach(x => assert.ok(names('bandwidth').includes(x), x));
  ['storage', 'email'].forEach(x => assert.ok(names('business').includes(x), x));
  const ids = W.flat().map(c => c.id); assert.strictEqual(new Set(ids).size, ids.length, 'duplicate category id');
  assert.deepStrictEqual(W.ACTIONS.map(a => a.v), ['allow', 'warn', 'block']);
  W.PRESET_IDS.forEach(p => W.GROUP_IDS.forEach(g => assert.ok(['allow', 'warn', 'block'].includes(W.PRESETS[p].groups[g]), p + g)));
  assert.deepStrictEqual(W.PRESET_IDS, ['staff', 'guest', 'iot', 'byod', 'servers']);
});
test('webcat: botnets are a note, not a made-up category id; allow adds nothing, warn becomes a warning', () => {
  const e = W.entries({ always: 'block', most: 'allow', productivity: 'warn', bandwidth: 'allow', business: 'allow' });
  assert.ok(e.every(x => Number.isInteger(x.id)) && e.filter(x => x.group === 'always').every(x => x.action === 'block') && e.filter(x => x.group === 'productivity').every(x => x.action === 'warning'));
  assert.ok(!e.some(x => x.group === 'most') && W.notes({ always: 'block' }).some(n => /Botnets/.test(n)) && W.notes({ always: 'allow' }).length === 0);
  assert.strictEqual(W.entries(W.normGroups(null)).length, 0);
});
test('webcat: presets per network type; the industry changes the defaults (school social media, clinic file sharing)', () => {
  assert.deepStrictEqual(['staff', 'lan', 'guest', 'iot', 'servers', 'dmz', 'voice', 'cameras', 'pos', 'printers', 'mgmt'].map(k => W.presetForKind(k, 'x')), ['staff', 'staff', 'guest', 'iot', 'servers', 'servers', null, null, null, null, null]);
  assert.strictEqual(W.presetForKind('other', 'BYOD'), 'byod'); assert.strictEqual(W.presetForKind('other', 'Lab'), 'iot');
  assert.strictEqual(W.presetGroups('staff', 'office').productivity, 'warn');
  assert.strictEqual(W.presetGroups('staff', 'school').productivity, 'block'); assert.strictEqual(W.presetGroups('guest', 'school').productivity, 'block');
  assert.strictEqual(W.presetGroups('staff', 'clinic').bandwidth, 'block'); assert.strictEqual(W.presetGroups('guest', 'clinic').bandwidth, 'block');
  assert.strictEqual(W.presetGroups('staff', 'office').bandwidth, 'warn');
  assert.strictEqual(W.presetGroups('nope', 'office'), null);
});
test('default policies carry the preset profile for their network type, and only accept-to-internet policies do', () => {
  const { r, p } = webClient({});
  assert.strictEqual(webOf(p, r, 'Staff LAN').webf.preset, 'staff'); assert.strictEqual(webOf(p, r, 'Guest').webf.preset, 'guest');
  assert.strictEqual(webOf(p, r, 'IoT').webf.preset, 'iot'); assert.strictEqual(webOf(p, r, 'Servers').webf.preset, 'servers');
  Pol.effective(p, r.allocations).forEach(x => { if (x.webf) assert.ok(x.action === 'accept' && x.dst === 'internet', x.src + '>' + x.dst); });
  assert.ok(!Pol.effective(p, r.allocations).some(x => x.webf && /Management|Voice|Cameras/.test(x.src)));
  const off = webClient({ webFilter: false }); assert.ok(!Pol.effective(off.p, off.r.allocations).some(x => x.webf));
});
test('industry presets adjust the defaults: school blocks social media, clinic blocks file sharing', () => {
  const school = webClient({ industry: 'school' }), clinic = webClient({ industry: 'clinic' }), office = webClient({ industry: 'office' });
  assert.strictEqual(webOf(school.p, school.r, 'Staff LAN').webf.groups.productivity, 'block');
  assert.strictEqual(webOf(office.p, office.r, 'Staff LAN').webf.groups.productivity, 'warn');
  assert.strictEqual(webOf(clinic.p, clinic.r, 'Staff LAN').webf.groups.bandwidth, 'block');
  assert.strictEqual(webOf(clinic.p, clinic.r, 'Guest').webf.groups.bandwidth, 'block');
  assert.ok(/set category 37\s+set action block/.test(F.toFortiOS(school.r, school.p, 'port5')));                                   // school: social media blocked
  const fo = F.toFortiOS(office.r, office.p, 'port5');
  assert.ok(/set category 37\s+set action warning/.test(fo));                                                                       // office staff: social media only warns (IoT and servers still block it)
});
test('FortiOS: profiles are exported with every category id marked unverified, shared when identical, attached to accept policies only', () => {
  const { r, p } = webClient({});
  const f = F.toFortiOS(r, p, 'port5');
  assert.ok(/config webfilter profile[\s\S]*edit "SP_Web_1"[\s\S]*config ftgd-wf[\s\S]*config filters[\s\S]*set category 26\s+set action block/.test(f));
  assert.ok(/UNVERIFIED/.test(f) && /26 Malicious Websites/.test(f) && /Botnets: Not a web category/.test(f));
  assert.ok(/set category 37\s+set action warning/.test(f));                                      // office staff: Productivity warns
  const pol = f.slice(f.indexOf('config firewall policy\n'));
  assert.ok(/set name "SP_Staff_LAN_to_internet"[\s\S]*?set utm-status enable[\s\S]*?set ssl-ssh-profile "certificate-inspection"[\s\S]*?set webfilter-profile "SP_Web_\d+"/.test(pol));
  assert.ok(!/set name "SP_Guest_to_internal_block"[^]*?set webfilter-profile[^]*?set name/.test(pol.replace(/set name "SP_Staff_LAN_to_internet"[\s\S]*/, '')));  // deny policies get none
  const names = [...f.matchAll(/edit "(SP_Web_\d+)"/g)].map(m => m[1]); assert.strictEqual(new Set(names).size, names.length);
  assert.ok(/SP_Web_\d+ \(.*Used by: .*Staff LAN to internet/.test(f));
  assert.ok(f.includes(F.FORTI_NOTE) && f.includes(Pol.NOTE));                                    // the required note and the placeholder stay
  const same = webClient({ industry: 'school' }), g = F.toFortiOS(same.r, same.p, 'port5');          // school: Staff LAN and Guest end up identical, so one profile serves both
  assert.ok(/Used by: Staff LAN to internet, Guest to internet/.test(g));
});
test('FortiOS: a profile that allows everything adds no profile; legacy site lists still work next to a preset', () => {
  const { c, r } = webClient({});
  c.pol = { edited: true, list: [Pol.mkPolicy({ src: 'Staff LAN', dst: 'internet', nat: true, webf: { preset: 'custom', groups: W.normGroups(null) } })], toggles: {} };
  const f = F.toFortiOS(r, I.toProject(c), 'port5'); assert.ok(!/config webfilter profile/.test(f) && !/webfilter-profile/.test(f));
  c.pol.list = [Pol.mkPolicy({ src: 'Staff LAN', dst: 'internet', nat: true, webf: W.profile('guest', 'office'), web: { mode: 'block', sites: 'bad.example.com', cats: [26] } })];
  const g = F.toFortiOS(r, I.toProject(c), 'port5');
  assert.ok(/config webfilter urlfilter[\s\S]*set url "bad.example.com"/.test(g) && /set urlfilter-table 101/.test(g));
  assert.strictEqual((g.match(/set category 26\b/g) || []).length, 1);                             // the same id from the list and the preset is not repeated
  c.pol.list = [Pol.mkPolicy({ src: 'Staff LAN', dst: 'internet', action: 'deny', webf: W.profile('staff', 'office') })];
  assert.ok(!/webfilter-profile|config webfilter profile/.test(F.toFortiOS(r, I.toProject(c), 'port5')));   // deny policies never get a profile
});
test('editing a policy profile: preset, one group (becomes custom) and off; the list freezes like any other edit', () => {
  const p = Pol.mkPolicy({ src: 'Staff LAN', dst: 'internet' });
  Pol.setWebPreset(p, 'iot', 'office'); assert.strictEqual(p.webf.preset, 'iot'); assert.strictEqual(p.webf.groups.productivity, 'block');
  Pol.setWebGroup(p, 'productivity', 'allow'); assert.strictEqual(p.webf.preset, 'custom'); assert.strictEqual(p.webf.groups.productivity, 'allow'); assert.strictEqual(p.webf.groups.bandwidth, 'block');
  Pol.setWebGroup(p, 'nonsense', 'block'); Pol.setWebGroup(p, 'always', 'maybe'); assert.strictEqual(p.webf.groups.always, 'block');   // bad input ignored
  Pol.setWebPreset(p, '', 'office'); assert.strictEqual(p.webf, null);
  const q = Pol.mkPolicy({ src: 'Staff LAN', dst: 'internet' }); Pol.setWebGroup(q, 'most', 'block'); assert.deepStrictEqual(q.webf.groups, { always: 'allow', most: 'block', productivity: 'allow', bandwidth: 'allow', business: 'allow' });
});
test('a card switched on in a frozen list also gets its web profile', () => {
  const { r, p } = webClient({}); const ctx = Pol.cardCtx(p, r.allocations);
  const list = Pol.setCardInList([], 'guest-internet', true, r.allocations, ctx); assert.strictEqual(list[0].webf.preset, 'guest');
  assert.strictEqual(Pol.setCardInList([], 'guest-internet', true, r.allocations)[0].webf, null);   // no context, no profile
});
test('client report: a plain-language Web protection section per network, and it follows the industry', () => {
  const { r, p } = webClient({ industry: 'school' }), h = CR.build(r, p);
  assert.ok(/<h2>\d+\. Web protection<\/h2>/.test(h) && h.includes('Dangerous websites') && h.includes('Time-wasters') && h.includes('Business tools'));
  assert.ok(/Staff LAN[\s\S]*?Blocked/.test(h.slice(h.indexOf('Web protection'))) && h.includes('Set for your type of site') && h.includes('School: social media'));
  assert.ok(!/VLAN|FortiGuard|category \d|webfilter/i.test(h.slice(h.indexOf('Web protection'), h.indexOf('Internet connection'))));      // no jargon
  const none = webClient({ webFilter: false }); assert.ok(!CR.build(none.r, none.p).includes('Web protection'));
  const o = webClient({}), ho = CR.build(o.r, o.p); assert.ok(/Internet connection and remote access/.test(ho) && !ho.includes('Set for your type of site'));
});
test('older clients migrate with web filtering off, so their exports do not change; new clients start with it on', () => {
  const old = I.newClient('old'); delete old.intake.webFilter; old.intake.counts.staff = 10; I.migrate(old); assert.strictEqual(old.intake.webFilter, false);
  I.applyIntake(old); const p = I.toProject(old), r = C.plan(p); assert.ok(!/webfilter-profile|config webfilter/.test(F.toFortiOS(r, p, 'port5')));
  assert.strictEqual(I.newClient('new').intake.webFilter, true);
  old.intake.webFilter = true; assert.ok(/config webfilter profile/.test(F.toFortiOS(r, I.toProject(old), 'port5')));
  const frozen = webClient({}); frozen.c.pol = { edited: true, list: Pol.effective(frozen.p, frozen.r.allocations).map(x => Object.assign({}, x)), toggles: {} };
  frozen.c.intake.webFilter = false; assert.ok(Pol.effective(I.toProject(frozen.c), frozen.r.allocations).some(x => x.webf));         // a frozen list keeps its profiles
});

console.log('Demo clients (phase 4)');
const demo = key => { const c = I.demoClient(key); const p = I.toProject(c); return { c, p, r: C.plan(p) }; };
const onIds = (d) => Pol.cardView(d.p, d.r.allocations).filter(e => e.on).map(e => e.card.id);
const stateOfCard = (d, id) => Pol.cardView(d.p, d.r.allocations).find(e => e.card.id === id);
test('demos: two made-up clients, each with a name, blurb and every intake answer filled in', () => {
  assert.deepStrictEqual(I.DEMO_KEYS, ['accountancy', 'clinic']);
  I.DEMO_KEYS.forEach(k => { const d = I.DEMOS[k]; assert.ok(d.title && d.blurb && d.name && d.site && d.wanNote, k); ['industry', 'serversWhere', 'wifi', 'voip'].forEach(f => assert.ok(d.site_answers[f], k + ' ' + f)); });
  assert.strictEqual(I.demoClient('nope'), null);
  assert.notStrictEqual(I.demoClient('clinic').id, I.demoClient('clinic').id);                    // every load is a new client
});
test('demo accountancy: 25 staff, guest Wi-Fi, printer VLAN, remote staff, one IoT pool, card payments off', () => {
  const d = demo('accountancy'), kinds = d.r.allocations.map(a => a.kind);
  assert.ok(d.r.ok, JSON.stringify(d.r.errors));
  ['staff', 'guest', 'printers', 'iot', 'servers', 'voice'].forEach(k => assert.ok(kinds.includes(k), k)); assert.ok(!kinds.includes('pos') && !kinds.includes('dmz') && !kinds.includes('cameras'));
  assert.strictEqual(d.r.allocations.find(a => a.kind === 'iot').hosts, 6); assert.strictEqual(d.c.intake.counts.staff, 25);
  const pool = R.plan(d.r, d.p); assert.ok(pool.ok && pool.staff === 5);                                // remote plan
  assert.ok(R.warnings(d.r, d.p).some(w => /192\.168\.1\.0\/24/.test(w)));                              // the old router range clashes with home routers: the banner shows
  assert.ok(d.r.allocations.every(a => !/^192\.168\.1\./.test(a.cidr)));
  assert.strictEqual(S.run(d.r.allocations, d.c.intake).notes.length, 0);                              // the answers agree with the ticks
});
test('demo accountancy: the suggestion engine picks the expected cards', () => {
  const d = demo('accountancy'), on = onIds(d);
  assert.strictEqual(S.run(d.r.allocations, d.c.intake).size, 'medium');
  ['guest-deny-internal', 'iot-deny-internal', 'printers-deny-internal', 'staff-printers', 'staff-servers', 'mgmt-lockdown', 'cameras-deny-internet', 'guest-internet'].filter(x => x !== 'cameras-deny-internet').forEach(x => assert.ok(on.includes(x), x + ' should be on'));
  assert.ok(!on.includes('voice-servers'), 'hosted phones need no server rule');
  ['staff-mgmt-admin', 'printers-internet', 'staff-voice', 'pos-deny-internal', 'dmz-deny-internal'].forEach(x => assert.ok(!on.includes(x), x + ' should be off or absent'));
  assert.ok(/Printers ticked/.test(stateOfCard(d, 'staff-printers').because) && /hosted in the cloud/.test(stateOfCard(d, 'voice-servers').because) && /medium site \(25 staff\)/.test(stateOfCard(d, 'mgmt-lockdown').because));
  ['advice-remote-vpn', 'advice-guest-isolation', 'advice-ap-mgmt', 'advice-voice-qos'].forEach(x => assert.ok(Pol.cardView(d.p, d.r.allocations).some(e => e.card.id === x), x));
  ['advice-dual-wan', 'advice-site-vpn', 'advice-cloud-only', 'advice-pos-logging'].forEach(x => assert.ok(!Pol.cardView(d.p, d.r.allocations).some(e => e.card.id === x), x + ' should not show'));
});
test('demo clinic: POS isolation, dual WAN, site-to-site VPN, clinic web filters', () => {
  const d = demo('clinic'), on = onIds(d), kinds = d.r.allocations.map(a => a.kind);
  assert.ok(d.r.ok, JSON.stringify(d.r.errors)); ['pos', 'cameras', 'printers', 'guest', 'servers', 'voice'].forEach(k => assert.ok(kinds.includes(k), k));
  assert.strictEqual(S.run(d.r.allocations, d.c.intake).size, 'small');
  ['pos-deny-internal', 'staff-deny-pos', 'pos-internet', 'printers-deny-internal', 'staff-printers', 'cameras-deny-internet', 'voice-servers', 'mgmt-lockdown'].forEach(x => assert.ok(on.includes(x), x + ' should be on'));
  ['pos-servers', 'printers-internet', 'staff-mgmt-admin'].forEach(x => assert.ok(!on.includes(x), x + ' should be off'));
  assert.ok(/clinic/.test(stateOfCard(d, 'mgmt-lockdown').because) && /on-site phone system/.test(stateOfCard(d, 'voice-servers').because) && /clinic: keep printers off the internet/.test(stateOfCard(d, 'printers-internet').because));
  ['advice-dual-wan', 'advice-site-vpn', 'advice-pos-logging', 'advice-ap-mgmt'].forEach(x => assert.ok(Pol.cardView(d.p, d.r.allocations).some(e => e.card.id === x), x));
  assert.ok(!Pol.cardView(d.p, d.r.allocations).some(e => e.card.id === 'advice-remote-vpn') && !R.plan(d.r, d.p));        // no remote staff here
  const staff = webOf(d.p, d.r, 'Staff LAN'), guest = webOf(d.p, d.r, 'Guest');
  assert.strictEqual(staff.webf.groups.bandwidth, 'block'); assert.strictEqual(guest.webf.groups.bandwidth, 'block'); assert.ok(!webOf(d.p, d.r, 'POS').webf);
  assert.strictEqual(S.run(d.r.allocations, d.c.intake).notes.length, 0);
});
test('the demos differ where the answers differ (same engine, different rules)', () => {
  const a = onIds(demo('accountancy')), c = onIds(demo('clinic'));
  assert.ok(a.includes('iot-deny-internal') && !c.includes('iot-deny-internal'));                    // clinic has no IoT network
  assert.ok(c.includes('pos-deny-internal') && !a.includes('pos-deny-internal'));
  assert.ok(c.includes('voice-servers') && !a.includes('voice-servers'));
});
test('demos run end to end: plan, diagram, policies, web filters, exports, report', () => {
  I.DEMO_KEYS.forEach(k => {
    const d = demo(k), { r, p } = d;
    const f = F.toFortiOS(r, p, 'port5'); assert.ok(!/# Skipped/.test(f), k); assert.ok(f.includes(F.FORTI_NOTE) && /PLACEHOLDER: "port5"/.test(f));
    assert.ok(/config webfilter profile/.test(f) && /UNVERIFIED/.test(f) && /set name "SP_Final_deny"/.test(f), k);
    const names = [...f.matchAll(/set name "(SP_[^"]{1,35})"/g)].map(m => m[1]); assert.strictEqual(new Set(names).size, names.length, k + ' duplicate names');
    assert.ok(F.toCSV(r, p).split('\n').length > r.allocations.length && F.toText(r, p).length > 100 && F.toHandoverDoc(r, p).includes('Site profile'), k);
    assert.ok(F.toPolicyFortiOS(r, p, 'port5').includes('config firewall policy'));
    assert.ok(require('./topology.js').build(r, p, { cols: 2, theme: 'light', standalone: true, vpn: R.plan(r, p) }).startsWith('<svg'), k);
    const h = CR.build(r, p); ['What you asked for', 'Who can reach what', 'The firewall rules, in plain language', 'Web protection', 'Room to grow', 'Internet connection'].forEach(s => assert.ok(h.includes(s), k + ' ' + s));
  });
  const acc = demo('accountancy'); const rf = F.toRemoteFortiOS(acc.r, acc.p, 'port5'); assert.ok(rf.includes('SP_VPN_POOL') && rf.includes('PSK_CHANGE_ME'));
  assert.strictEqual(F.toRemoteFortiOS(...(([x]) => [x.r, x.p, 'port5'])([demo('clinic')])), '');
});
test('client report explains every rule and every filter in plain language, with no jargon', () => {
  I.DEMO_KEYS.forEach(k => {
    const { r, p } = demo(k), h = CR.build(r, p), s0 = h.indexOf('The firewall rules, in plain language'), sec = h.slice(s0, h.indexOf('Room to grow', s0));
    const pols = Pol.resolve(Pol.effective(p, r.allocations), r.allocations).pols;
    assert.strictEqual((sec.match(/<tr>/g) || []).length - 1, pols.length, k + ' one row per rule');                         // minus the header row
    assert.ok(/Blocked<\/span> · Guests cannot reach all your internal networks/.test(sec) && /Allowed<\/span> · Staff can reach the internet/.test(sec), k);
    assert.ok(/Guests can reach the internet, for name lookups and web browsing only/.test(sec), k);                       // Guest service list in plain words
    assert.ok(/Website checks: [^<]*blocked/.test(sec) && /shown with a warning/.test(sec), k);
    assert.ok(!/VLAN|FortiGate|FortiOS|SP_|HTTPS|DNS|NAT|CLI|category \d/.test(sec.replace(/<[^>]+>/g, ' ')), k + ' jargon in the rules section');
    const w0 = h.indexOf('Web protection'), web = h.slice(w0, h.indexOf('Internet connection', w0)); assert.ok(/Dangerous websites/.test(web) && !/FortiGuard|category \d|VLAN/.test(web), k);
  });
  const c = demo('clinic'), h = CR.build(c.r, c.p), c0 = h.indexOf('The firewall rules'), sec = h.slice(c0, h.indexOf('Room to grow', c0));
  assert.ok(/Card payments cannot reach all your internal networks/.test(sec) && /Staff can reach Printers|Staff can reach Printers/.test(sec) && /Card payments can reach the internet, for name lookups, web browsing and clock synchronisation only/.test(sec));
  assert.ok(/Set for your type of site[^]*Clinic: file sharing/.test(h));
});
test('report numbers its sections in order whatever applies (no gaps)', () => {
  [demo('accountancy'), demo('clinic'), siteClient(5, {}, { webFilter: false })].forEach(d => {
    const nums = [...CR.build(d.r, d.p).matchAll(/<h2>(\d+)\. /g)].map(m => Number(m[1]));
    assert.deepStrictEqual(nums, nums.map((_, i) => i + 1));
  });
});
test('demo clients survive being saved and loaded (JSON round trip + migrate) and editing', () => {
  I.DEMO_KEYS.forEach(k => {
    const d = demo(k), back = I.migrate(JSON.parse(JSON.stringify(d.c))), p2 = I.toProject(back);
    assert.strictEqual(F.toFortiOS(C.plan(p2), p2, 'port5'), F.toFortiOS(d.r, d.p, 'port5'), k);
    back.pol = { edited: true, list: Pol.effective(p2, d.r.allocations), toggles: {} }; back.intake.industry = 'school';               // freeze, then change an answer: list unchanged
    assert.strictEqual(Pol.effective(I.toProject(back), d.r.allocations).length, Pol.effective(p2, d.r.allocations).length);
  });
});

console.log('Contract import (phase 5)');
const K = require('./contract.js');
const ACC_TEXT = `MANAGED NETWORK SERVICES AGREEMENT

This Agreement is made between Brightwell Accountants Ltd, a company registered in England (the "Client") and Netcraft Services Ltd (the "Supplier").

Client: Brightwell Accountants Ltd
Site address: 14 Station Road, Reading, RG1 4BE

1. Scope
The Supplier will design and install a new firewall and network for approximately 25 staff at the Site. The network shall include a separate guest Wi-Fi for visitors. The Client has 3 network printers and 6 smart displays and sensors. Around five staff will work from home and need VPN access.
The Client uses hosted telephony (SIP trunks) with 25 IP phones. There are no on-site servers; all applications are cloud-only. The Client does not take card payments.
Internet: a single fibre connection, 300/300 Mbps, with a 4G backup. The Client is an accountancy firm.`;
const CLINIC_TEXT = `Customer: Harbour Road Dental Ltd
Premises: 3 Harbour Road, Poole, BH15 1AA
The Supplier shall provide a secure network for 12 staff at the dental clinic. A guest Wi-Fi is required for patients in the waiting room. There are 2 card terminals at reception and the Client must meet PCI DSS. The clinic has 4 CCTV cameras and 2 network printers. Telephony is an on-site PBX with 10 handsets. A local file server holds the patient records. Internet: dual WAN with a fibre primary and a 4G backup. A site-to-site VPN connects to the sister clinic.`;
const xf = (text, key) => K.extract(text).fields.find(f => f.key === key);
const vals = text => { const o = {}; K.extract(text).fields.forEach(f => { o[f.key] = f.value; }); return o; };
test('contract: a realistic contract gives the right fields, each with its source sentence and a confidence', () => {
  const r = K.extract(ACC_TEXT); assert.ok(r.ok);
  const v = vals(ACC_TEXT);
  assert.deepStrictEqual([v.name, v.site, v.staff, v.guest, v.iot, v.iotCount, v.printers, v.printersCount, v.remote, v.remoteCount, v.serversWhere, v.pos, v.voice, v.voip, v.voiceCount, v.industry, v.dualWan],
    ['Brightwell Accountants Ltd', '14 Station Road, Reading, RG1 4BE', 25, true, true, 6, true, 3, true, 5, 'cloud', false, true, 'hosted', 25, 'office', true]);
  assert.ok(/fibre/.test(v.internetType) && /300\/300 Mbps/.test(v.internetType));
  r.fields.forEach(f => { assert.ok(['high', 'medium', 'low'].includes(f.conf), f.key); assert.ok(f.snippet && f.snippet.length <= 260, f.key + ' snippet'); assert.ok(f.snippet.includes(f.hit), f.key + ' hit inside snippet'); assert.strictEqual(f.checked, f.conf !== 'low', f.key); });
  assert.strictEqual(xf(ACC_TEXT, 'name').conf, 'high'); assert.strictEqual(xf(ACC_TEXT, 'staff').conf, 'medium');    // "approximately 25" is flagged
  assert.ok(/approximate/.test(xf(ACC_TEXT, 'staff').note) && /25 staff/.test(xf(ACC_TEXT, 'staff').snippet));
  assert.ok(/no on-site servers/.test(xf(ACC_TEXT, 'serversWhere').snippet) && xf(ACC_TEXT, 'serversWhere').conf === 'high');
});
test('contract: "five staff will work from home" is remote staff, not the headcount', () => {
  const t = 'The site has 25 staff. Around five staff will work from home. 3 guests visit daily.';
  assert.strictEqual(xf(t, 'staff').value, 25); assert.strictEqual(xf(t, 'staff').conf, 'high'); assert.strictEqual(xf(t, 'remoteCount').value, 5);
});
test('contract: the clinic contract matches the clinic demo answers', () => {
  const v = vals(CLINIC_TEXT), d = I.DEMOS.clinic;
  assert.deepStrictEqual([v.name, v.site, v.staff, v.guest, v.pos, v.posCount, v.cameras, v.camerasCount, v.printers, v.printersCount, v.voip, v.voiceCount, v.serversWhere, v.dualWan, v.siteVpn, v.industry],
    ['Harbour Road Dental Ltd', '3 Harbour Road, Poole, BH15 1AA', d.counts.staff, true, true, d.counts.pos, true, d.counts.cameras, true, d.counts.printers, d.site_answers.voip, d.counts.voice, d.site_answers.serversWhere, d.site_answers.dualWan, d.site_answers.siteVpn, d.site_answers.industry]);
});
test('contract: never guesses. Nothing relevant, nothing returned; unfound fields are listed as blank', () => {
  const r = K.extract('This agreement is governed by the laws of England. Payment is due within 30 days. The term is 36 months.');
  assert.ok(r.ok && r.fields.length === 0 && r.missing.length === K.FIELDS.length);
  const part = K.extract('Client: Acme Ltd'); assert.deepStrictEqual(part.fields.map(f => f.key), ['name']); assert.ok(part.missing.some(m => m.key === 'staff'));
  assert.strictEqual(K.extract('The firm has an excellent reputation and many people like it.').fields.length, 0);
  assert.strictEqual(xf('Our team of 40 will visit the site.', 'staff'), undefined);           // 40 what? not staff
  assert.strictEqual(xf('The contract value is 25 thousand pounds.', 'staff'), undefined);
});
test('contract: conflicting figures are low confidence and list the others; ranges and hedges are flagged', () => {
  const c = xf('There are 25 staff in the office. The Client expects 40 staff after the move.', 'staff');
  assert.strictEqual(c.conf, 'low'); assert.strictEqual(c.checked, false); assert.deepStrictEqual(c.alts, ['40']); assert.ok(/25, 40/.test(c.note));
  const r = xf('Between 20-25 staff will use the network.', 'staff'); assert.strictEqual(r.value, 25); assert.strictEqual(r.conf, 'medium'); assert.ok(/range/i.test(r.note));
  assert.strictEqual(xf('Number of staff: 32', 'staff').conf, 'high'); assert.strictEqual(xf('Headcount: 32', 'staff').value, 32);
  assert.strictEqual(xf('We employ twenty-five employees.', 'staff').value, 25); assert.strictEqual(xf('We employ 1,200 employees.', 'staff').value, 1200);
});
test('contract: yes/no features read negatives and uncertainty (no guest Wi-Fi, optional cameras, contradictions)', () => {
  assert.strictEqual(xf('Guest Wi-Fi is out of scope.', 'guest').value, false);
  assert.strictEqual(xf('The network shall include guest Wi-Fi.', 'guest').value, true); assert.strictEqual(xf('The network shall include guest Wi-Fi.', 'guest').conf, 'high');
  const opt = xf('CCTV cameras are optional and may be added in phase 2.', 'cameras'); assert.strictEqual(opt.value, true); assert.strictEqual(opt.conf, 'low'); assert.strictEqual(opt.checked, false);
  const mix = xf('There will be no guest Wi-Fi. A separate guest network is required.', 'guest'); assert.strictEqual(mix.conf, 'low'); assert.ok(mix.alts.length === 1 && /opposite/.test(mix.note));
  assert.strictEqual(xf('The Client does not take card payments.', 'pos').value, false); assert.strictEqual(xf('The Client takes card payments via 3 PDQ terminals.', 'pos').value, true);
  assert.strictEqual(xf('The Client takes card payments via 3 PDQ terminals.', 'posCount').value, 3);
});
test('contract: servers, phones, internet and industry rules do not over-reach', () => {
  assert.strictEqual(xf('A local file server will be retained.', 'serversWhere').value, 'onprem');
  assert.strictEqual(xf('We have 2 servers.', 'serversCount').value, 2); assert.strictEqual(xf('We have 2 servers.', 'serversWhere'), undefined);      // where is not stated: left blank
  assert.strictEqual(xf('The Client is cloud-only and also has an on-site file server.', 'serversWhere').conf, 'low');
  assert.strictEqual(xf('The office uses IP phones.', 'voip'), undefined); assert.strictEqual(xf('The office uses IP phones.', 'voice').value, true);
  assert.strictEqual(xf('A single internet line is provided.', 'dualWan').value, false); assert.strictEqual(xf('Firewall failover is required.', 'dualWan').conf, 'low');
  assert.strictEqual(xf('Users can use remote access via the VPN.', 'remote').conf, 'low');                  // VPN alone is not "remote staff"
  assert.strictEqual(xf('The shop sells to the public. The school next door is a neighbour.', 'industry'), undefined);   // a tie: not guessed
  assert.strictEqual(xf('The patients attend the clinic and the dentist works with the surgery team.', 'industry').value, 'clinic');
  assert.strictEqual(xf('The site is a primary school with 40 teachers and 600 pupils.', 'industry').value, 'school');
});
test('contract: empty, PDF, binary and oversized input are refused with a clear reason', () => {
  assert.ok(!K.extract('').ok && /Paste/.test(K.extract('   ').error));
  assert.ok(/PDF or Word/.test(K.extract('%PDF-1.7 ...binary...').error) && /PDF or Word/.test(K.extract('PK\u0003\u0004word/document.xml').error));
  assert.ok(/PDF or Word/.test(K.extract('a\u0000\u0001\u0002' + '\u0000'.repeat(40)).error));
  assert.ok(/very long/.test(K.extract('x'.repeat(K.MAX_CHARS + 1)).error));
  assert.deepStrictEqual(K.extract(null).fields, []);
});
test('contract: values from the review screen are validated before they are used', () => {
  assert.strictEqual(K.clean('staff', '25'), 25); assert.strictEqual(K.clean('staff', '1,200'), 1200); assert.strictEqual(K.clean('staff', '0'), null); assert.strictEqual(K.clean('staff', 'lots'), null); assert.strictEqual(K.clean('staff', '9999999'), null);
  assert.strictEqual(K.clean('guest', 'true'), true); assert.strictEqual(K.clean('guest', false), false); assert.strictEqual(K.clean('guest', 'maybe'), null);
  assert.strictEqual(K.clean('industry', 'clinic'), 'clinic'); assert.strictEqual(K.clean('industry', 'bank'), null); assert.strictEqual(K.clean('name', '  Acme   Ltd '), 'Acme Ltd'); assert.strictEqual(K.clean('name', ''), null); assert.strictEqual(K.clean('nope', 1), null);
});
test('contract: applying fills the intake from confirmed fields only, then the plan, policies and exports follow', () => {
  const c = I.newClient('x'); c.intake.counts.staff = 7; c.intake.req.guest = false; c.name = 'Old name';
  const items = K.extract(ACC_TEXT).fields.filter(f => f.checked).map(f => ({ key: f.key, value: f.value }));
  const done = K.apply(c, items); I.applyIntake(c);
  assert.ok(done.length === items.length && done.some(x => x === 'Staff: 25'));
  assert.deepStrictEqual([c.name, c.site, c.intake.counts.staff, c.intake.req.guest, c.intake.req.printers, c.intake.counts.printers, c.intake.req.iot, c.intake.counts.iot, c.intake.remote.on, c.intake.remote.count, c.intake.serversWhere, c.intake.voip, c.intake.req.voice, c.intake.counts.voice, c.intake.industry, c.intake.dualWan, c.intake.req.pos],
    ['Brightwell Accountants Ltd', '14 Station Road, Reading, RG1 4BE', 25, true, true, 3, true, 6, true, 5, 'cloud', 'hosted', true, 25, 'office', true, false]);
  assert.ok(/Internet: fibre, 4g 300\/300 Mbps\./.test(c.intake.wanNote));
  const p = I.toProject(c), r = C.plan(p); assert.ok(r.ok); assert.ok(r.allocations.some(a => a.kind === 'printers') && r.allocations.some(a => a.kind === 'guest') && !r.allocations.some(a => a.kind === 'pos'));
  assert.ok(F.toFortiOS(r, p, 'port5').includes('SP_Staff_LAN_to_Printers') && R.plan(r, p).ok);
  K.apply(c, items); assert.strictEqual(c.intake.wanNote.split('Internet:').length, 2);                      // applying twice does not repeat the note
});
test('contract: apply touches only the fields it is given, ignores bad values, and an explicit No beats a count', () => {
  const c = I.newClient('x'); c.intake.counts.staff = 12; c.intake.req.servers = true; c.intake.counts.servers = 2; c.site = 'Kept';
  K.apply(c, [{ key: 'guestCount', value: 8 }, { key: 'guest', value: false }, { key: 'staff', value: 'banana' }, { key: 'bogus', value: 1 }, { key: 'industry', value: 'bank' }]);
  assert.strictEqual(c.intake.counts.staff, 12); assert.strictEqual(c.intake.counts.servers, 2); assert.strictEqual(c.intake.req.servers, true); assert.strictEqual(c.site, 'Kept');
  assert.strictEqual(c.intake.counts.guest, 8); assert.strictEqual(c.intake.req.guest, false);               // No wins over the count that would have ticked it
  assert.strictEqual(c.intake.industry, ''); assert.deepStrictEqual(K.apply(c, []), []); assert.deepStrictEqual(K.apply(c, null), []);
  const d = I.newClient('y'); K.apply(d, [{ key: 'serversWhere', value: 'onprem' }, { key: 'remoteCount', value: 4 }]);
  assert.strictEqual(d.intake.req.servers, true); assert.deepStrictEqual([d.intake.remote.on, d.intake.remote.count], [true, 4]);
  const e = I.newClient('z'); K.apply(e, [{ key: 'serversWhere', value: 'cloud' }]); assert.strictEqual(e.intake.req.servers, false); assert.strictEqual(e.intake.serversWhere, 'cloud');   // cloud-only does not tick anything
});
test('contract: the "currently" column reports what the intake holds now', () => {
  const c = I.demoClient('clinic');
  assert.strictEqual(K.current(c, 'staff'), '12'); assert.strictEqual(K.current(c, 'guest'), 'Yes'); assert.strictEqual(K.current(c, 'dualWan'), 'Two lines (dual WAN)');
  assert.strictEqual(K.current(c, 'industry'), 'Clinic'); assert.strictEqual(K.current(I.newClient('n'), 'staff'), ''); assert.strictEqual(K.current(I.newClient('n'), 'guest'), 'No');
});
test('contract text stays on the device: nothing returned or stored holds the text, and the module has no storage or network calls', () => {
  const fs = require('fs'), path = require('path'), src = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
  const c = I.newClient('x'); K.apply(c, K.extract(ACC_TEXT).fields.map(f => ({ key: f.key, value: f.value })));
  assert.ok(!/Netcraft|SIP trunks|MANAGED NETWORK|Supplier/.test(JSON.stringify(c)), 'contract words leaked into the client record');
  const code = src('contract.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');          // comments are not code
  assert.ok(!/\b(localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|sendBeacon|WebSocket|document|window|navigator|console)\b/.test(code), 'contract.js touches storage, network or the DOM');
  assert.ok(!/\(\?<[=!]/.test(code), 'regex lookbehind is not supported on older iPhones');
  const app = src('app.js'); assert.ok(!/(localStorage|save\(|store\.)[^\n]*contract/i.test(app) && !/contract[^\n]*(localStorage|save\(\)|store\[)/i.test(app.replace(/contractReset|bindContract|renderContractReview|contractControl|contractFound|\$\('#contract-[a-z]+'\)/g, '')), 'app.js stores contract text');
  assert.ok(/contractFound = null/.test(app) && /\$\('#contract-text'\)\.value = ''/.test(app));          // cleared on apply, cancel and clear
  assert.ok(/not saved, not uploaded and not sent/.test(src('index.html')) && /Old \.doc files/.test(src('index.html')));
  const fields = K.extract(ACC_TEXT).fields; assert.ok(fields.every(f => f.snippet.length <= 260));          // only short snippets leave extract()
});
test('PWA: every script and stylesheet the page loads is precached by the service worker, and the cache was bumped', () => {
  const fs = require('fs'), path = require('path'), rd = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
  const html = rd('index.html'), sw = rd('sw.js');
  const files = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).concat([...html.matchAll(/<link[^>]+href="([^"#]+\.(?:css|json))"/g)].map(m => m[1]));
  assert.ok(files.length >= 14);
  files.forEach(f => { assert.ok(fs.existsSync(path.join(__dirname, f)), f + ' is missing'); assert.ok(sw.includes(`'./${f}'`), f + ' is not in the service worker ASSETS'); });
  assert.ok(/const CACHE = 'subnetpal-v40'/.test(sw));
});
test('printing: staff-to-printers uses the custom SP_PRINT service, defined once in the FortiOS CLI', () => {
  const { r, p } = fullClient(); const f = F.toFortiOS(r, p, 'port5');
  assert.ok(f.includes('config firewall service custom') && f.includes('edit "SP_PRINT"') && f.includes('set tcp-portrange 9100 631 515'));
  assert.ok(f.indexOf('config firewall service custom') < f.indexOf('config firewall policy'));
  assert.strictEqual(f.split('edit "SP_PRINT"').length, 2);
  const none = fullClient(c => { c.intake.req.printers = false; }); assert.ok(!F.toFortiOS(none.r, none.p, 'port5').includes('SP_PRINT'));
});
test('report: the access matrix follows the policy list, so optional cards and edits show', () => {
  const { r, p } = fullClient(); const al = r.allocations, ix = n => al.findIndex(a => a.name === n);
  const base = A.matrixFromPolicies(al, Pol.resolve(Pol.effective(p, al), al).pols);
  const cell = (m, f, t) => m.rows[m.cols.indexOf(f) < 0 ? 0 : m.cols.indexOf(f)].cells[m.cols.indexOf(t)];
  assert.strictEqual(cell(base, 'POS', 'Servers'), false);
  p.pol = { edited: false, list: [], toggles: { 'pos-servers': true } };
  const on = A.matrixFromPolicies(al, Pol.resolve(Pol.effective(p, al), al).pols);
  assert.strictEqual(cell(on, 'POS', 'Servers'), true);
  assert.strictEqual(cell(on, 'Staff LAN', 'Printers'), true); assert.strictEqual(cell(on, 'Guest', 'Staff LAN'), false); assert.strictEqual(cell(on, 'Staff LAN', 'Staff LAN'), 'self');
  assert.ok(ix('POS') >= 0);
});
test('remote: an existing range that is itself a home-router range reads naturally', () => {
  const { r, p } = fullClient(c => { c.intake.existing = '192.168.1.0/24'; });
  const w = R.warnings(r, p).filter(x => x.includes('existing range'));
  assert.ok(w.length && w[0].includes('192.168.1.0/24 is a range many home routers use') && !w[0].includes('overlaps 192.168.1.0/24,'));
});
test('diagram: dual WAN is labelled on the internet link', () => {
  const T = require('./topology.js');
  const a = fullClient(c => { c.intake.dualWan = true; }), b = fullClient();
  assert.ok(T.build(a.r, a.p, { cols: 1 }).includes('WAN1 + WAN2'));
  assert.ok(T.build(a.r, a.p, { cols: 1, plain: true }).includes('Two internet connections'));
  assert.ok(!T.build(b.r, b.p, { cols: 1 }).includes('WAN1 + WAN2'));
});
test('contract: a large contract is scanned quickly', () => {
  const big = (ACC_TEXT + '\n').repeat(300).slice(0, 300000), t0 = Date.now(); const r = K.extract(big);
  assert.ok(r.ok && Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
});

test('theme: resolve picks stored side, else the system, light by default', () => {
  const T = require('./theme.js');
  assert.strictEqual(T.resolve('dark', false), 'dark'); assert.strictEqual(T.resolve('light', true), 'light');
  assert.strictEqual(T.resolve(null, true), 'dark'); assert.strictEqual(T.resolve(null, false), 'light');
  assert.strictEqual(T.resolve('purple', false), 'light'); assert.strictEqual(T.other('dark'), 'light'); assert.strictEqual(T.other('light'), 'dark');
});
test('theme: compact KPI numbers and the five colour themes', () => {
  const T = require('./theme.js');
  assert.deepStrictEqual(T.PALETTES.map(p => p[0]), ['indigo', 'teal', 'blugrn', 'burg', 'peach']);
  assert.strictEqual(T.palette('burg'), 'burg'); assert.strictEqual(T.palette('nope'), 'indigo'); assert.strictEqual(T.palette(null), 'indigo');
  assert.strictEqual(T.compact(0), '0'); assert.strictEqual(T.compact(1795), '1,795'); assert.strictEqual(T.compact(99999), '99,999');
  assert.strictEqual(T.compact(120000), '120K'); assert.strictEqual(T.compact(65536 * 16), '1M'); assert.strictEqual(T.compact(4294967296), '4.3B'); assert.strictEqual(T.compact('x'), '0');
});
test('theme: sw.js precaches theme.js and the stylesheet keeps the layout guards and print-light rule', () => {
  const fs = require('fs'), sw = fs.readFileSync(__dirname + '/sw.js', 'utf8'), css = fs.readFileSync(__dirname + '/style.css', 'utf8');
  assert.ok(sw.includes("'./theme.js'")); assert.ok(/subnetpal-v40/.test(sw));
  assert.ok(css.includes('.results { padding') && css.includes('min-width: 0') && css.includes('minmax(0, 1fr)'));
  assert.ok(/@media screen \{\s*:root\[data-theme="dark"\]/.test(css), 'dark tokens must be screen-only so print stays light');
  for (const p of ['teal', 'blugrn', 'burg', 'peach']) assert.ok(css.includes(`:root[data-theme="light"][data-palette="${p}"]`) && css.includes(`:root[data-theme="dark"][data-palette="${p}"]`), 'both modes for ' + p);
  assert.ok(!/greet|Good morning/.test(fs.readFileSync(__dirname + '/index.html', 'utf8') + fs.readFileSync(__dirname + '/app.js', 'utf8')), 'welcome greeting removed');
  assert.ok(!/\(\?<[=!]/.test(fs.readFileSync(__dirname + '/theme.js', 'utf8')), 'no regex lookbehind');
});

console.log('FortiGate setup guide');
const G = require('./guide.js');
const guideProj = () => ({ parent: '10.20.0.0/16', networks: [{ name: 'Management', hosts: 20, vlan: 10, role: 'Mgmt', kind: 'mgmt' }, { name: 'Staff', hosts: 50, vlan: 20, role: 'LAN', kind: 'staff' }, { name: 'Guest', hosts: 30, vlan: 30, role: 'Guest', kind: 'guest' }, { name: 'Cameras', hosts: 10, vlan: 40, role: 'LAN', kind: 'cameras' }, { name: 'Servers', hosts: 10, vlan: 50, role: 'LAN', kind: 'servers' }], opts: {}, existing: [], intake: { remote: { on: true, count: 5 } }, ifName: 'port2' });
const gRow = (g, k) => g.groups.reduce((x, y) => x.concat(y.rows), []).find(r => r.k === k);
test('guide: least-privilege admin access per kind, and the main CLI uses the same', () => {
  assert.deepStrictEqual(A.adminAccess({ kind: 'mgmt' }), ['https', 'ping', 'ssh']);
  ['guest', 'iot', 'cameras', 'pos', 'other'].forEach(k => assert.deepStrictEqual(A.adminAccess({ kind: k }), [], k));
  ['servers', 'voice', 'dmz'].forEach(k => assert.deepStrictEqual(A.adminAccess({ kind: k }), ['ping'], k));
  ['staff', 'lan'].forEach(k => assert.deepStrictEqual(A.adminAccess({ kind: k }), ['https', 'ping', 'ssh'], k)); // guide 1.4: Staff = HTTPS, SSH, PING
  assert.deepStrictEqual(A.adminAccess({ kind: 'printers' }), []); // guide 1.4: Printers/IoT = none
  const p = guideProj(), r = C.plan(p), cli = F.toFortiOS(r, p, 'port2');
  assert.ok(/edit "vlan10"[\s\S]*?set allowaccess https ping ssh[\s\S]*?next/.test(cli));
  assert.ok(/edit "vlan30"[\s\S]*?unset allowaccess[\s\S]*?next/.test(cli));
});
test('guide: interface card mirrors the FortiOS form and carries a why for every field', () => {
  const p = guideProj(), r = C.plan(p), i = r.allocations.findIndex(a => a.name === 'Staff'), a = r.allocations[i], g = G.iface(r, p, i);
  assert.deepStrictEqual(g.groups.map(x => x.title), ['Interface', 'Address', 'Administrative Access', 'DHCP Server', 'Network', 'Traffic Shaping', 'Miscellaneous']);
  assert.strictEqual(gRow(g, 'Name').v, 'vlan20'); assert.strictEqual(gRow(g, 'Alias').v, 'Staff');
  assert.strictEqual(gRow(g, 'VLAN ID').v, '20'); assert.strictEqual(gRow(g, 'Interface').v, 'port2'); assert.strictEqual(gRow(g, 'Role').v, 'LAN');
  assert.strictEqual(gRow(g, 'IP/Netmask').v, `${a.gateway}/${a.netmask}`);
  assert.strictEqual(gRow(g, 'Address range').v, `${a.dhcpStart} - ${a.dhcpEnd}`);
  assert.strictEqual(gRow(g, 'Lease time').v, '604800 seconds');
  g.groups.forEach(x => x.rows.forEach(row => { if (row.k !== 'VPN') assert.ok(row.v !== '', row.k); }));
  assert.ok(g.cli.includes('set ip ' + a.gateway) && g.cli.includes('set vlanid 20') && g.cli.includes('set device-identification enable') && g.cli.includes('set lease-time 604800'));
  assert.ok(g.cli.includes(F.FORTI_NOTE) && g.note.includes(F.FORTI_NOTE) && !/unverified/.test(g.note) && /approximate/.test(g.note));
});
test('guide: management, guest and cameras differ sensibly', () => {
  const p = guideProj(), r = C.plan(p), at = n => G.iface(r, p, r.allocations.findIndex(a => a.name === n));
  assert.deepStrictEqual(gRow(at('Management'), 'IPv4').chips.filter(c => c.on).map(c => c.t), ['HTTPS', 'PING', 'SSH']);
  assert.deepStrictEqual(gRow(at('Guest'), 'IPv4').chips.filter(c => c.on), []); assert.strictEqual(gRow(at('Guest'), 'Lease time').v, '14400 seconds'); // guide: guests 3600-14400 s
  assert.strictEqual(gRow(at('Servers'), 'Device detection').v, 'On');
  assert.strictEqual(gRow(at('Cameras'), 'Device detection').v, 'On'); assert.strictEqual(gRow(at('Management'), 'Device detection').v, 'Off');
  assert.ok(!/set device-identification/.test(at('Management').cli) && /set device-identification/.test(at('Servers').cli));
});
test('guide: a non-VLAN port and a loopback have no VLAN rows', () => {
  const p = { parent: '10.5.0.0/24', networks: [{ name: 'Office', hosts: 20, vlan: '', role: 'LAN', kind: 'staff' }, { name: 'Lo', hosts: 1, vlan: '', role: 'Loopback', kind: 'loopback' }], opts: {}, existing: [] }, r = C.plan(p);
  const g = G.iface(r, p, r.allocations.findIndex(a => a.name === 'Office'));
  assert.strictEqual(gRow(g, 'Type').v, 'Physical Interface'); assert.strictEqual(gRow(g, 'VLAN ID'), undefined); assert.ok(!/vlanid/.test(g.cli));
  assert.strictEqual(gRow(G.iface(r, p, r.allocations.findIndex(a => a.name === 'Lo')), 'Type').v, 'Loopback Interface');
  assert.strictEqual(G.iface(r, p, 99), null);
});
test('guide: VPN card is Bob\'s 10-step checklist with the plan values, computed values, check table and mistakes', () => {
  const p = guideProj(), r = C.plan(p), v = G.vpn(r, p), pool = R.plan(r, p);
  assert.strictEqual(v.steps.length, 10);
  assert.deepStrictEqual(v.steps.map(s => s.title.replace(/^\d+\. /, '')), ['Users', 'User group', 'VPN Wizard', 'Wizard: Authentication', 'Wizard: Policy & Routing', 'Wizard: Review', 'Harden phase 1', 'Tighten the policy', 'WAN interface', 'FortiClient on each laptop']);
  assert.deepStrictEqual(v.steps.filter(s => s.approx).map(s => s.title[0] + (s.title[1] === '0' ? '0' : '')), ['4', '5', '10']);
  const rows = v.steps.reduce((x, s) => x.concat(s.rows), []), rowOf = k => rows.find(x => x.k === k), cv = k => v.computed.rows.find(x => x.k === k);
  assert.strictEqual(cv('Client address range').v, `${pool.first} - ${pool.last}`);
  assert.ok(cv('Tunnel name').v.length <= 13 && !/\s/.test(cv('Tunnel name').v) && /^[A-Za-z0-9-]+$/.test(cv('Tunnel name').v));
  assert.ok(/12\+ random/.test(cv('Pre-shared key').v) && !/PSK_CHANGE_ME/.test(JSON.stringify(v.computed)), 'the key is never stored or shown');
  assert.strictEqual(cv('Local subnets').v, pool.reach.map(n => r.allocations.find(a => a.name === n).cidr).join(', '));
  assert.strictEqual(rowOf('Enable IPv4 split tunnel').v, 'On'); assert.strictEqual(rowOf('Template').v, 'FortiClient remote access');
  assert.ok(/DES, 3DES, MD5, SHA1/.test(rowOf('Phase 1 proposal').v) && rowOf('Diffie-Hellman groups').v === '20, 21' && /Leave what the wizard chose/.test(rowOf('IKE version').v));
  assert.strictEqual(rowOf('Log allowed traffic').v, 'All sessions'); assert.strictEqual(rowOf('Action / NAT').v, 'ACCEPT / NAT off');
  assert.strictEqual(v.table.rows.length, 6); assert.ok(v.table.rows.find(x => x.k === 'Logs recorded').approx);
  assert.strictEqual(v.mistakes.length, 6);
  ['SP_VPN', 'aes256-sha256', 'RemoteStaff', 'PSK_CHANGE_ME', 'set dhgrp 20 21', 'set ipv4-start-ip ' + pool.first].forEach(t => assert.ok(v.cli.includes(t), t));
  assert.ok(!/set ike-version/.test(v.cli) && v.cli.includes(F.FORTI_NOTE) && !/unverified/.test(v.note));
});
test('guide: tunnel name is at most 13 characters with no spaces', () => {
  assert.strictEqual(G.tunnelName({ name: 'Halden Legal' }), 'Halden-FCT'); assert.strictEqual(G.tunnelName({}), 'SP-FCT');
  assert.ok(G.tunnelName({ name: 'Extraordinarily Long Name Pty' }).length <= 13 && G.tunnelName({ name: '!!! ???' }) === 'SP-FCT');
});
test('guide: no VPN guide unless remote staff is ticked; no reach networks still renders all ten steps', () => {
  const p = guideProj(), r = C.plan(p); p.intake.remote.on = false; assert.strictEqual(G.vpn(r, p), null);
  p.intake.remote = { on: true, count: 3, reach: {} }; const v = G.vpn(r, p);
  assert.strictEqual(v.steps.length, 10); assert.strictEqual(v.computed.rows.find(x => x.k === 'Local subnets').v, 'None ticked');
});
test('guide: field order follows the FortiOS form (guide 1.3) and the card carries checks, hints and the logging note', () => {
  const p = guideProj(), r = C.plan(p), g = G.iface(r, p, r.allocations.findIndex(a => a.name === 'Staff'));
  const ks = g.groups.reduce((x, y) => x.concat(y.rows.map(z => z.k)), []), at = k => ks.indexOf(k);
  ['Name', 'Alias', 'Type', 'VLAN protocol', 'Interface', 'VLAN ID', 'VRF ID', 'Role', 'Addressing mode', 'IP/Netmask', 'Create address object matching subnet', 'Secondary IP address', 'IPv4', 'DHCP status', 'Device detection', 'Proxy ARP', 'Security mode', 'Outbound shaping profile', 'Comments', 'Status']
    .reduce((prev, k) => { assert.ok(at(k) > prev, k); return at(k); }, -1);
  assert.ok(g.checks.length >= 4 && g.checks.every(c => c.ok), 'a clean plan passes every pre-display check');
  assert.ok(g.hints.some(h => /Gateway is network \+ 1/.test(h)) && g.hints.some(h => /max 15 characters/i.test(h)) && g.hints.some(h => /Logging lives on the policy/.test(h)));
  assert.ok(g.notes.some(n => /Log allowed traffic = All sessions/.test(n)) && !g.groups.some(x => x.rows.some(y => /logging/i.test(y.k))), 'logging is a note, not a field');
  assert.strictEqual(gRow(g, 'DHCP status').v, 'Enabled'); assert.ok(g.groups.find(x => x.title === 'DHCP Server').approx, 'DHCP layout is approximate');
});
test('guide: per-role values (WAN, guest, servers, printers, management) and failing checks', () => {
  const mk = nets => { const p = { parent: '10.60.0.0/16', networks: nets, opts: {}, existing: [], ifName: 'port2' }; return { p, r: C.plan(p) }; };
  const { p, r } = mk([{ name: 'Internet', hosts: 1, vlan: '', role: 'WAN', kind: 'wan' }, { name: 'Printers', hosts: 10, vlan: 40, role: 'LAN', kind: 'printers' }, { name: 'Servers', hosts: 10, vlan: 30, role: 'LAN', kind: 'servers', dhcp: false }, { name: 'Mgmt', hosts: 5, vlan: 99, role: 'Mgmt', kind: 'mgmt' }]);
  const at = n => G.iface(r, p, r.allocations.findIndex(a => a.name === n));
  const w = at('Internet');
  assert.strictEqual(gRow(w, 'Type').v, 'Physical Interface'); assert.strictEqual(gRow(w, 'Role').v, 'WAN'); assert.strictEqual(gRow(w, 'Addressing mode').v, 'DHCP');
  assert.deepStrictEqual(gRow(w, 'IPv4').chips.filter(c => c.on).map(c => c.t), ['PING']); assert.strictEqual(gRow(w, 'DHCP status').v, 'Disabled'); assert.strictEqual(gRow(w, 'Device detection').v, 'Off');
  assert.ok(gRow(w, 'Distance') && gRow(w, 'Override internal DNS') && !gRow(w, 'Create address object matching subnet') && /set mode dhcp/.test(w.cli) && !/set ip /.test(w.cli) && /WAN = PING only/.test(w.hints[0]));
  const pr = at('Printers'); assert.deepStrictEqual(gRow(pr, 'IPv4').chips.filter(c => c.on), []); assert.strictEqual(gRow(pr, 'Lease time').v, '604800 seconds'); assert.ok(gRow(pr, 'IP address assignment rules').approx);
  const sv = at('Servers'); assert.strictEqual(gRow(sv, 'DHCP status').v, 'Disabled'); assert.ok(gRow(sv, 'Static range') && !gRow(sv, 'Address range')); assert.ok(/Servers are static/.test(sv.hints[0]));
  assert.strictEqual(gRow(at('Mgmt'), 'Device detection').v, 'Off'); assert.strictEqual(gRow(at('Mgmt'), 'DHCP status').v, 'Disabled');
  // checks fail on a bad card
  const a = Object.assign({}, r.allocations.find(x => x.name === 'Printers')), bad = G.checks(r.allocations.concat([Object.assign({}, a, { name: 'Dup' })]), a, 'port2');
  assert.ok(bad.some(c => !c.ok && /VLAN 40 is also used by .*Dup/.test(c.t)) && bad.some(c => !c.ok && /overlaps .*Dup/.test(c.t)));
  assert.ok(G.checks(r.allocations, Object.assign({}, a, { dhcpStart: a.network, dhcpEnd: a.broadcast }), 'port2').some(c => !c.ok && /DHCP pool contains/.test(c.t)));
  assert.ok(G.checks(r.allocations, Object.assign({}, a, { prefix: 31 }), 'port2').some(c => !c.ok && /\/30 or shorter/.test(c.t)));
});
test('guide: sw.js precaches guide.js, index loads it after format.js and the card styles keep the layout guards', () => {
  const fs = require('fs'), sw = fs.readFileSync(__dirname + '/sw.js', 'utf8'), html = fs.readFileSync(__dirname + '/index.html', 'utf8'), css = fs.readFileSync(__dirname + '/style.css', 'utf8');
  assert.ok(sw.includes("'./guide.js'")); assert.ok(html.indexOf('guide.js') > html.indexOf('format.js') && html.indexOf('guide.js') > html.indexOf('remote.js'));
  assert.ok(css.includes('.fgr') && css.includes('grid-column: 1 / -1') && /@media print \{ \.fg \{ display: none/.test(css));
  assert.ok(!/\(\?<[=!]/.test(fs.readFileSync(__dirname + '/guide.js', 'utf8')), 'no regex lookbehind');
});
test('guide: Open CLI popup is wired (dialog, textarea, Copy, Close, backdrop) and no Copy CLI buttons remain', () => {
  const fs = require('fs'), html = fs.readFileSync(__dirname + '/index.html', 'utf8'), app = fs.readFileSync(__dirname + '/app.js', 'utf8'), css = fs.readFileSync(__dirname + '/style.css', 'utf8');
  ['<dialog id="clidlg"', 'id="clitext"', 'id="clicopy"', 'id="cliclose"'].forEach(t => assert.ok(html.includes(t), t));
  assert.ok(app.includes('data-opencli') && app.includes('Open CLI') && !app.includes('Copy CLI') && app.includes('e.target === dlg') && app.includes('showModal'));
  assert.ok(css.includes('.dlg::backdrop') && css.includes('#clitext'));
});test('guide: every card has a DHCP Server group (Disabled where the plan has no range), address object, full access boxes, shaping and misc', () => {
  const p = guideProj(), r = C.plan(p), at = n => G.iface(r, p, r.allocations.findIndex(a => a.name === n));
  r.allocations.forEach((a, i) => { const g = G.iface(r, p, i); assert.ok(g.groups.some(x => x.title === 'DHCP Server'), a.name); assert.strictEqual(gRow(g, 'DHCP status').v, a.dhcpStart ? 'Enabled' : 'Disabled', a.name); });
  const m = at('Management'), s = at('Staff'); assert.strictEqual(gRow(m, 'DHCP status').v, 'Disabled'); assert.strictEqual(gRow(m, 'Address range'), undefined);
  assert.strictEqual(gRow(s, 'Create address object matching subnet').v, 'On'); assert.strictEqual(gRow(s, 'Name').v, 'vlan20'); // Name appears first for the interface
  assert.strictEqual(gRow(s, 'Destination').v, by(r, 'Staff').cidr);
  assert.deepStrictEqual(gRow(s, 'IPv4').chips.map(c => c.t), ['HTTPS', 'HTTP', 'PING', 'FMG-Access', 'SSH', 'SNMP', 'FTM', 'RADIUS Accounting', 'Security Fabric Connection', 'Speed Test', 'SCIM']);
  assert.ok(gRow(s, 'IPv4').chips.find(c => c.t === 'HTTP').dis && !gRow(s, 'IPv4').chips.find(c => c.t === 'HTTP').on);
  assert.ok(s.cli.includes('config firewall address') && s.cli.includes('set subnet ' + by(r, 'Staff').network) && s.cli.includes('set description'));
  assert.ok(!/dhcp-server/.test(m.cli) && /config firewall address/.test(m.cli));
  ['Outbound shaping profile', 'Outbound bandwidth', 'Comments'].forEach(k => assert.ok(gRow(s, k), k));
});test('layout: client info slides down from the top, no title banner, S mark bottom-left, theme tools kept', () => {
  const fs = require('fs'), html = fs.readFileSync(__dirname + '/index.html', 'utf8'), app = fs.readFileSync(__dirname + '/app.js', 'utf8'), css = fs.readFileSync(__dirname + '/style.css', 'utf8');
  ['id="sideTab"', 'aria-controls="side"', 'class="sideclip"', 'class="brandmark"', 'id="themeBtn"', 'id="themes"', 'id="netpill"'].forEach(t => assert.ok(html.includes(t), t));
  assert.ok(html.indexOf('id="side"') < html.indexOf('class="app"'), 'panel sits above the results');
  assert.ok(!/<h1>SubnetPal<\/h1>/.test(html) && html.includes('<h1 class="sr">SubnetPal</h1>'), 'title banner removed, h1 kept for screen readers');
  assert.ok(!html.includes('sideBackdrop') && !app.includes('sideBackdrop') && !html.includes('sumBtn'));
  assert.ok(app.includes("'subnetpal-top-'") && app.includes("'Escape'") && /isPhone\(\) : v === '0'/.test(app), 'saved per layout, closed first on phones');
  assert.ok(css.includes('grid-template-rows: 0fr') && css.includes('columns: 300px 3') && css.includes('.brandmark') && css.includes('bottom: calc(82px'));
  assert.ok(!/grid-template-columns: 400px/.test(css) && css.includes('.results { padding') && css.includes('minmax(0, 1fr)'));
});
test('layout: network cards are tiles that open a modal (no dropdown), with Esc/backdrop/Close', () => {
  const fs = require('fs'), html = fs.readFileSync(__dirname + '/index.html', 'utf8'), app = fs.readFileSync(__dirname + '/app.js', 'utf8'), css = fs.readFileSync(__dirname + '/style.css', 'utf8');
  ['<dialog id="carddlg"', 'id="cardbody"', 'id="cardclose"'].forEach(t => assert.ok(html.includes(t), t));
  assert.ok(!app.includes('<details class="ncard"') && !app.includes('openCards') && app.includes('openCard(') && app.includes('e.target === $(\'#carddlg\')') && app.includes('showModal'));
  assert.ok(app.includes("role=\"button\" tabindex=\"0\"") && app.includes("e.key === 'Enter'"), 'keyboard accessible tiles');
  assert.ok(css.includes('.dlgbody') && css.includes('overflow-y: auto') && /print[\s\S]*\.dlg/.test(css));
});
const fs = require('fs');
test('Bob review: DHCP IDs start at 101 with a check note; no id 1 in the main CLI or card CLI', () => {
  const { r, p } = demo('accountancy'), f = F.toFortiOS(r, p, '');
  const dh = f.slice(f.indexOf('config system dhcp-server'));
  assert.ok(/edit 101\b/.test(dh) && !/\n    edit 1\n/.test(dh.slice(0, dh.indexOf('config firewall address'))) && f.includes('show system dhcp server'));
  const g = G.iface(r, p, r.allocations.findIndex(a => a.dhcpStart));
  assert.ok(/edit 101\b/.test(g.cli) && !/edit 100\b/.test(g.cli) && g.cli.includes('show system dhcp server'));
});
test('Bob review: lock-out warning in every CLI and the parent port flows through; empty keeps PORT_CHANGE_ME', () => {
  const { r, p } = demo('accountancy');
  [F.toFortiOS(r, p, ''), F.toRemoteFortiOS(r, p, '')].forEach(t => assert.ok(/must NOT be the port you are managing/.test(t)));
  assert.ok(F.toFortiOS(r, p, '').includes('PORT_CHANGE_ME') && !F.toFortiOS(r, p, 'port5').includes('PORT_CHANGE_ME') && F.toFortiOS(r, p, 'port5').includes('set interface "port5"'));
  const ix = fs.readFileSync('index.html', 'utf8');
  assert.ok(ix.includes('Parent port') && ix.includes('Never use the port you are managing') && ix.includes('Pre-flight checklist') && ix.includes('edit 0') && ix.includes('rollback'));
});
test('Bob review: remote CLI is consistent (IKEv1 + XAuth, no IKEv2 wording) and gives clients DNS', () => {
  const { r, p } = demo('accountancy');
  assert.ok(!/IKEv2 dial-up/.test(fs.readFileSync('index.html', 'utf8')) && !/IKEv2 dial-up/.test(fs.readFileSync('README.md', 'utf8')));
  let t = F.toRemoteFortiOS(r, p, ''); assert.ok(/CONFIRM ON THE VM/.test(t) && /# set ipv4-dns-server1/.test(t));
  const q = JSON.parse(JSON.stringify(p)), srv = r.allocations.find(a => /server/i.test(a.name)) || r.allocations[0];
  q.dhcpDns = {}; r.allocations.forEach(a => { q.dhcpDns[a.name] = { server: '10.9.9.9', domain: 'corp.example.com' }; });
  t = F.toRemoteFortiOS(r, q, ''); assert.ok(t.includes('set ipv4-dns-server1 10.9.9.9') && t.includes('set domain "corp.example.com"'));
});
test('Bob review: per-network DHCP DNS flows into the CLI, validates the address, and defaults to System DNS', () => {
  const { r, p } = demo('accountancy'), a = r.allocations.find(x => x.dhcpStart), q = JSON.parse(JSON.stringify(p));
  assert.ok(!F.toFortiOS(r, p, '').includes('dns-server1'));
  q.dhcpDns = { [a.name]: { server: '10.0.0.10', domain: 'corp.local' } };
  const f = F.toFortiOS(r, q, ''); assert.ok(f.includes('set dns-service specify') && f.includes('set dns-server1 10.0.0.10') && f.includes('set domain "corp.local"'));
  q.dhcpDns = { [a.name]: { server: '10.0.0.999', domain: 'bad domain!' } };
  assert.ok(!F.toFortiOS(r, q, '').includes('dns-server1') && !F.toFortiOS(r, q, '').includes('bad domain'));
  q.dhcpDns = { [a.name]: { server: '10.0.0.10' } };
  const gi = G.iface(r, q, r.allocations.indexOf(a)); assert.ok(gi.cli.includes('dns-server1 10.0.0.10') && gi.groups.some(g => g.rows.some(x => x.k === 'DNS server' && /Specify: 10\.0\.0\.10/.test(x.v))));
  assert.ok(fs.readFileSync('app.js', 'utf8').includes('data-dns="server"'));
});
test('Bob review: POS wording matches the policy; dual WAN warns; web category warning is stronger; advice cautions present', () => {
  const { r, p } = demo('clinic'), f = F.toFortiOS(r, p, '');
  assert.ok(!/Only the payment provider is reachable/.test(fs.readFileSync('access.js', 'utf8')) && !/with access to the payment provider only/.test(fs.readFileSync('report.js', 'utf8')));
  assert.ok(/DUAL WAN/.test(f) && f.includes('virtual-wan-link') && !/DUAL WAN/.test(F.toFortiOS(demo('accountancy').r, demo('accountancy').p, '')));
  assert.ok(/show webfilter profile/.test(f) && /no IPS, antivirus or SSL inspection/.test(f) && /break OS and vendor updates/.test(f));
  const h = n => G.iface(r, p, r.allocations.findIndex(a => new RegExp(n, 'i').test(a.name))).hints.join(' ');
  assert.ok(/Management network only/.test(h('staff')) && /option 66/.test(h('voice|phone')) && /vendor updates/.test(h('server')));
  assert.ok(/VPN-only/.test(G.vpn(demo('accountancy').r, demo('accountancy').p).mistakes.join(' ')));
});
test('Bob review: usability (demo collapses panel, short toast, Manage menu, reworded banner, IP at top of popup)', () => {
  const app = fs.readFileSync('app.js', 'utf8'), ix = fs.readFileSync('index.html', 'utf8');
  assert.ok(/setSideCollapsed\(true, true\); toast\('Demo loaded'\)/.test(app) && app.includes('1600') && !app.includes('Check this') && ix.includes('Manage client'));
  assert.ok(app.indexOf("['Port / gateway IP', a.gateway") < app.indexOf('+ dnsBox(a) + `<div class="exp">'));
});
test('policy tiles open the shared popup laid out like the FortiGate policy table, with Open CLI', () => {
  const fs = require('fs'), app = fs.readFileSync(__dirname + '/app.js', 'utf8'), css = fs.readFileSync(__dirname + '/style.css', 'utf8');
  ['Incoming interface', 'Outgoing interface', 'Source', 'Destination', 'Service', 'Action', 'NAT (network address translation)', 'data-pol=', 'data-opencli="pol:', 'openPol('].forEach(x => assert.ok(app.includes(x), x));
  ['HTTPS', 'DNS', 'SMB', 'RDP', 'SSH', 'HTTP', 'PING'].forEach(x => assert.ok(app.includes("['" + x + "'"), 'legend ' + x));
  assert.ok(!/\(\?<[=!]/.test(app) && css.includes('.ptable') && css.includes('.schip'));
  assert.ok(!/--ok: var\(--ok\)/.test(css), 'dark theme has real ok/warn colours');
});
test('policies: snake layout with an Implicit deny tile, and Add new policy lives in the popup', () => {
  const fs = require('fs'), app = fs.readFileSync(__dirname + '/app.js', 'utf8'), css = fs.readFileSync(__dirname + '/style.css', 'utf8'), html = fs.readFileSync(__dirname + '/index.html', 'utf8');
  assert.ok(app.includes('renderSnake') && app.includes('Implicit deny') && css.includes('.snum') && css.includes('.sarrow') && css.includes('.slot'));
  assert.ok(html.includes('id="btnNewPol"') && !html.includes('id="tagline"') && !html.includes('id="btnParse"') && !html.includes('polfinal'));
  assert.ok(app.includes('openAddPol') && app.includes('data-padd="parse"') && app.includes('data-padd="blank"'));
});
test('policy snake: drag handle, delete with confirm, tiles shrink down the snake', () => {
  const fs = require('fs'), app = fs.readFileSync(__dirname + '/app.js', 'utf8'), css = fs.readFileSync(__dirname + '/style.css', 'utf8');
  ['data-phandle', 'data-pdel', 'data-pdelgo', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'setPointerCapture', "--s:${sc}", 'class=\"snum\"'].forEach(x => assert.ok(app.includes(x), x));
  assert.ok(css.includes('touch-action: none') && css.includes('calc(var(--s, 1) * 100%)') && css.includes('.snk.shifted') && app.includes('translateY('));
});
test('policy popup: cells edit a draft, Save/Cancel, no Edit this policy section', () => {
  const fs = require('fs'), app = fs.readFileSync(__dirname + '/app.js', 'utf8'), css = fs.readFileSync(__dirname + '/style.css', 'utf8');
  assert.ok(!app.includes('Edit this policy') && !app.includes('polEditOpen'));
  ['data-psave', 'data-pcancel', 'data-psvc', 'polDraft', 'polDirty', 'id="pf-name"', 'data-pf="action"', 'data-pf="nat"'].forEach(x => assert.ok(app.includes(x), x));
  assert.ok(css.includes('.pfoot') && css.includes('.schip.tog'));
});
// ---- network folders (groups.js) ----
test('Groups: kinds and roles map to the four folders; unknown goes to Users', () => {
  const G = require('./groups.js');
  const g = n => G.groupId(n);
  ['mgmt', 'staff', 'guest'].forEach(k => assert.strictEqual(g({ kind: k }), 'users'));
  ['servers', 'dmz'].forEach(k => assert.strictEqual(g({ kind: k }), 'servers'));
  ['voice', 'cameras', 'iot', 'printers', 'pos'].forEach(k => assert.strictEqual(g({ kind: k }), 'devices'));
  assert.strictEqual(g({ role: 'Transit', kind: '' }), 'infra');
  assert.strictEqual(g({ role: 'Loopback' }), 'infra');
  assert.strictEqual(g({ role: 'Mgmt' }), 'users');
  assert.strictEqual(g({ role: 'DMZ' }), 'servers');
  assert.strictEqual(g({ role: 'LAN', kind: '' }), 'users');
  assert.strictEqual(g({}), 'users');
  assert.deepStrictEqual(G.GROUPS.map(x => x.emoji), ['👤', '🖥️', '🖨️', '🔗']);
});
test('Groups: UI wires the folder row and Show all, and ships groups.js offline', () => {
  const fs = require('fs'), app = fs.readFileSync('./app.js', 'utf8'), html = fs.readFileSync('./index.html', 'utf8'), sw = fs.readFileSync('./sw.js', 'utf8');
  assert.ok(html.includes('id="folders"') && html.includes('groups.js') && sw.includes('./groups.js'));
  assert.ok(app.includes('data-grp="all"') && app.includes('Show all'));
  assert.ok(app.includes("' off'") && fs.readFileSync('./style.css', 'utf8').includes('.cards.sel .ncard.off'), 'unselected cards grey out instead of hiding');
});
test('Groups: UI passes dim(a) (not the name) so only other groups grey out', () => {
  const app = require('fs').readFileSync('./app.js', 'utf8');
  assert.ok(app.includes('dim(a))).join'), 'tile gets dim(a) as its off flag');
  assert.ok(!/\]\], a\.name\)\)\.join/.test(app), 'a.name must not be passed as the off flag');
});
console.log('PDF / Word import (docread.js)');
const D = require('./docread.js'), zlib = require('zlib');
function crc32(b) { let c, crc = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) { c = (crc ^ b[i]) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files, method) {      // files: {name: string}; method 8 = deflate, 0 = stored
  const parts = [], cen = []; let off = 0;
  for (const [name, str] of Object.entries(files)) {
    const raw = Buffer.from(str, 'utf8'), data = method === 8 ? zlib.deflateRawSync(raw) : raw, nm = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc32(raw), 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nm, data); cen.push(ch, nm); off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(cen), eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(cen.length / 2, 8); eo.writeUInt16LE(cen.length / 2, 10); eo.writeUInt32LE(cd.length, 12); eo.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, eo]));
}
const WX = '<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>Site: 5 Smith &amp; Co, Sydney</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">We have 25 staff</w:t></w:r><w:r><w:tab/><w:t>on site.</w:t></w:r></w:p><w:p><w:r><w:t>Guest Wi-Fi is required.</w:t></w:r></w:p></w:body></w:document>';
test('ports available: plain networks get real ports, VLANs share the highest free port, no placeholder', () => {
  const al = [{ name: 'LAN', vlan: '', role: 'LAN' }, { name: 'DMZ', vlan: '', role: 'DMZ' }, { name: 'Guest', vlan: 30, role: 'Guest' }, { name: 'Lo', vlan: '', role: 'Loopback' }];
  const pr = { portCount: 4, portPrefix: 'port', portMap: {} };
  const pl = F.portPlan(al, 'PORT_CHANGE_ME', pr);
  assert.deepStrictEqual(pl.names, ['port1', 'port2', 'vlan30', 'lo_Lo']);
  assert.strictEqual(pl.parent, 'port4'); assert.deepStrictEqual(pl.free, ['port3']); assert.deepStrictEqual(pl.short, []);
  const pl2 = F.portPlan(al, 'PORT_CHANGE_ME', Object.assign({}, pr, { portMap: { LAN: 'port2' } }));   // a picked port wins and is not reused
  assert.deepStrictEqual(pl2.names.slice(0, 2), ['port2', 'port1']);
  const pl3 = F.portPlan(al, 'port1', pr);                                                             // explicit parent port is reserved
  assert.strictEqual(pl3.parent, 'port1'); assert.deepStrictEqual(pl3.names.slice(0, 2), ['port2', 'port3']);
  assert.deepStrictEqual(F.ifaceNames(al, 'PORT_CHANGE_ME', {}).slice(0, 2), ['PORT_CHANGE_ME1', 'PORT_CHANGE_ME2']);   // no count: unchanged
});
test('ports available: running out is reported and falls back to the placeholder', () => {
  const al = [{ name: 'A', vlan: '', role: 'LAN' }, { name: 'B', vlan: '', role: 'LAN' }, { name: 'C', vlan: '', role: 'LAN' }];
  const pl = F.portPlan(al, 'PORT_CHANGE_ME', { portCount: 2 });
  assert.deepStrictEqual(pl.short, ['C']); assert.strictEqual(pl.names[2], 'PORT_CHANGE_ME');
});
test('ports available: CLI and remote CLI use real port names, no placeholder left', () => {
  const c = I.demoClient('clinic'); c.portCount = 8; c.portPrefix = 'port'; c.portMap = {};
  const p = I.toProject(c), r = C.plan(p), f = F.toFortiOS(r, p, p.ifName);
  assert.ok(r.ok && !/set interface "PORT_CHANGE_ME/.test(f) && /set interface "port\d"/.test(f) && !/PORT_CHANGE_ME\d/.test(f), f.slice(0, 900));
  assert.ok(!/set (srcintf|dstintf) "PORT_CHANGE_ME/.test(F.toPolicyFortiOS(r, p, p.ifName)));
  assert.ok(/ports/i.test(F.toFortiOS(r, p, p.ifName)));
});

(async () => {
  async function atest(name, fn) { try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).split('\n').slice(0, 4).join('\n       ')); } }
  await atest('docread: file kinds are told apart by their first bytes, then the name', async () => {
    assert.strictEqual(D.kind([0x25, 0x50, 0x44, 0x46], 'x.bin'), 'pdf');
    assert.strictEqual(D.kind([0x50, 0x4B, 3, 4], 'c.docx'), 'docx');
    assert.strictEqual(D.kind([0x50, 0x4B, 3, 4], 'c.odt'), 'unknown');
    assert.strictEqual(D.kind([0xD0, 0xCF, 0x11, 0xE0], 'old.doc'), 'doc');
    assert.strictEqual(D.kind([104, 105], 'a.txt'), 'text');
    assert.ok(/Save As \.docx or PDF/.test(D.OLD_DOC_MSG));
  });
  await atest('docread: .docx text is read (deflated and stored), entities and tabs decoded, paragraphs kept', async () => {
    for (const m of [8, 0]) {
      const t = await D.docxText(makeZip({ '[Content_Types].xml': '<x/>', 'word/document.xml': WX }, m));
      assert.ok(t.includes('Site: 5 Smith & Co, Sydney\nWe have 25 staff\ton site.\nGuest Wi-Fi is required.'), t);
    }
  });
  await atest('docread: a .docx goes through the contract scanner', async () => {
    const t = await D.docxText(makeZip({ 'word/document.xml': WX }, 8)), r = require('./contract.js').extract(t);
    assert.ok(r.ok && r.fields.some(f => f.key === 'staff'), JSON.stringify(r.fields.map(f => f.key)));
  });
  await atest('docread: bad zips, missing document.xml and empty documents give friendly errors', async () => {
    await assert.rejects(() => D.docxText(new Uint8Array([1, 2, 3])), /Word \.docx/);
    await assert.rejects(() => D.docxText(makeZip({ 'other.xml': '<x/>' }, 8)), /Word \.docx/);
    await assert.rejects(() => D.docxText(makeZip({ 'word/document.xml': '<w:document><w:p></w:p></w:document>' }, 8)), /No text found/);
  });
  await atest('docread: wiring (PDF.js vendored and cached for offline, no network, no storage)', async () => {
    const fs = require('fs'), sw = fs.readFileSync('./sw.js', 'utf8'), app = fs.readFileSync('./app.js', 'utf8'), html = fs.readFileSync('./index.html', 'utf8'), src = fs.readFileSync('./docread.js', 'utf8');
    for (const f of ['./docread.js', './vendor/pdf.min.mjs', './vendor/pdf.worker.min.mjs']) assert.ok(sw.includes(f) && fs.existsSync(f), f);
    assert.ok(html.includes('docread.js') && html.includes('.pdf,.docx') && app.includes("import('./vendor/pdf.min.mjs')"));
    assert.ok(!/localStorage|sessionStorage|fetch\(|XMLHttpRequest|document\.(get|create|query|body)/.test(src), 'docread.js stays pure');
    assert.ok(!/\(\?<[=!]/.test(src + app), 'no regex lookbehind');
  });
test('CLI copy: paste-safe CRLF lines, no leading indent, no tabs or runs of spaces joining lines', () => {
  const out = F.cliForPaste('config system interface\n    edit "port2"\n        set ip 10.0.0.1 255.255.255.0\n    next\nend\n');
  assert.strictEqual(out, 'config system interface\r\nedit "port2"\r\nset ip 10.0.0.1 255.255.255.0\r\nnext\r\nend\r\n');
  assert.ok(!/(^|\n)[ \t]/.test(out) && !/[^\r]\n/.test(out));
  assert.strictEqual(F.cliForPaste('a\r\nb\rc\n\n\n'), 'a\r\nb\r\nc\r\n');
  const fs = require('fs'), app = fs.readFileSync(__dirname + '/app.js', 'utf8');
  assert.ok(app.includes("CLI_KINDS = ['forti', 'polcli', 'remote']") && app.includes("Fmt.cliForPaste($('#clitext').value)"));
});
test('explanations: hidden by default, one remembered switch per page and in the popup, warnings never hidden', () => {
  const fs = require('fs'), app = fs.readFileSync(__dirname + '/app.js', 'utf8'), css = fs.readFileSync(__dirname + '/style.css', 'utf8'), html = fs.readFileSync(__dirname + '/index.html', 'utf8');
  assert.ok(/body:not\(\.showexp\) \.exp \{ display: none/.test(css));
  assert.ok(html.includes('class="expbar"') && (html.match(/data-showexp/g) || []).length === 2);
  assert.ok(app.includes("'subnetpal.exp'") && app.includes('bindExp()'));
  assert.ok(app.includes('class="fw exp"') && app.includes('polwhy exp'));
  assert.ok(!/warnbox"? ?[^>]*\bexp\b/.test(html) && !/class="hint warnbox exp/.test(html), 'warnboxes stay visible');
  assert.ok(app.includes("' exp'}\">${pl.short.indexOf(a.name) >= 0 ? 'No free port"), 'out-of-ports warning stays visible');
});
test('network tiles are condensed: IP / mask and range only; broadcast, wildcard and totals sit behind the toggle', () => {
  const fs = require('fs'), app = fs.readFileSync(__dirname + '/app.js', 'utf8');
  assert.ok(app.includes("[['IP / mask'") && !app.includes("['Netmask', `${ipHtml(a.netmask)}"));
  assert.ok(app.includes('<div class="exp">${dlRows(netRows(a))}</div>'));
});
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

