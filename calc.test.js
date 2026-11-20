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
  assert.strictEqual((f.match(/edit "SP_/g) || []).length, r.allocations.length + 1); // one object per subnet + SP_INTERNAL
  assert.ok(f.includes('set interface "port9"') && /PLACEHOLDER: "port9"/.test(f));
  const pol = f.slice(f.indexOf('config firewall policy'));
  assert.ok(pol.indexOf('Guest_to_internal_block') > -1 && pol.indexOf('Guest_to_internal_block') < pol.indexOf('Staff_LAN_to_internet')); // denies first
  assert.ok(/set name "SP_Staff_LAN_to_internet"/.test(pol) && /set service "DNS" "HTTP" "HTTPS"/.test(pol));
  assert.ok(/set name "SP_Staff_LAN_to_Servers"/.test(pol));
  assert.ok(/set name "SP_DMZ_to_internal_block"[\s\S]*?set action deny/.test(pol));
  assert.ok(!/SP_Cameras_to_internet/.test(pol) && !/SP_Transit_to/.test(pol));
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
  assert.ok(!f.includes('SP_VPN_SPLIT') && !f.includes('SP_VPN_to_') && f.includes('No office networks are ticked'));
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
  assert.ok(f.includes('PSK_CHANGE_ME') && f.includes('VPN_USERS_CHANGE_ME') && f.includes(F.FORTI_NOTE) && f.includes('lab VM'));
  assert.strictEqual(F.toRemoteFortiOS(remoteClient('5', c => { c.intake.remote.on = false; }).r, remoteClient('5', c => { c.intake.remote.on = false; }).p), '');
});
test('plan diagram and client report include the VPN pool in plain language', () => {
  const T = require('./topology.js');
  const { r, p } = remoteClient('30'); const pool = R.plan(r, p);
  const svg = T.build(r, p, { cols: 2, theme: 'light', standalone: true, vpn: pool });
  assert.ok(svg.includes('REMOTE STAFF (VPN)') && svg.includes('Remote staff (VPN)') && svg.includes(pool.cidr));
  assert.ok(!T.build(r, p, { theme: 'light' }).includes('Remote staff'));
  const h = CR.build(r, p, svg);
  assert.ok(h.includes('Remote working') && h.includes(pool.first) && h.includes('Staff LAN, Servers') && h.includes('7. Internet connection'));
  const body = h.slice(h.indexOf('<body>')).replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ');
  ['VLAN', 'CIDR', 'gateway', 'subnet', 'DHCP', 'IPsec', 'FortiOS', 'netmask'].forEach(w => assert.ok(!new RegExp(w, 'i').test(body), 'jargon: ' + w));
  assert.ok(!CR.build(C.plan(sample().p), sample().p).includes('Remote working'));
  const clash = remoteClient('10', c => { c.intake.existing = '192.168.1.0/24'; });
  assert.ok(CR.build(clash.r, clash.p).includes('One thing to check'));
});
test('older clients migrate: remote, policies and tagline get defaults', () => {
  const old = I.newClient('old'); delete old.intake.remote; delete old.pol; delete old.tagline; I.migrate(old);
  assert.deepStrictEqual(old.intake.remote, { on: false, count: '', reach: null }); assert.deepStrictEqual(old.pol, { edited: false, list: [] }); assert.strictEqual(old.tagline, '');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
