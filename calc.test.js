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
test('falls back to 172.16/12 then 192.168/16, then null', () => {
  assert.strictEqual(I.pickParent(['10.0.0.0/8']).cidr, '172.16.0.0/16');
  assert.strictEqual(I.pickParent(['10.0.0.0/8', '172.16.0.0/12']).cidr, '192.168.0.0/16');
  assert.strictEqual(I.pickParent(['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']), null);
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
test('always suggests Management, Staff LAN, Servers, Transit, Loopback', () => {
  assert.deepStrictEqual(names(withCounts({})), ['Management', 'Staff LAN', 'Servers', 'Transit', 'Loopback']);
});
test('optional networks need the box ticked AND a count > 0', () => {
  const c = withCounts({ staff: 10, voice: 12, cameras: 4, iot: 3, guest: 8, dmz: 2 }, { voice: true, cameras: true, iot: true, guest: true, dmz: true });
  assert.deepStrictEqual(names(c), ['Management', 'Staff LAN', 'Servers', 'Voice', 'Cameras', 'IoT', 'Guest', 'DMZ', 'Transit', 'Loopback']);
  const ticked0 = withCounts({ staff: 10 }, { voice: true, guest: true });
  assert.ok(!names(ticked0).includes('Voice') && !names(ticked0).includes('Guest'));
  assert.ok(ticked0.genNotes.some(n => /Voice was ticked but the count is 0/.test(n)));
});
test('counts without a ticked box are folded in, not dropped', () => {
  const c = withCounts({ staff: 10, wired: 2, wifi: 3, voice: 5, guest: 4, servers: 2, dmz: 3 });
  const net = n => c.networks.find(x => x.name === n);
  assert.strictEqual(net('Staff LAN').hosts, 10 + 2 + 3 + 5 + 4);
  assert.strictEqual(net('Servers').hosts, 5); // 2 + 3 dmz
  assert.ok(!names(c).includes('Voice') && !names(c).includes('DMZ'));
  assert.ok(c.genNotes.length === 3);
});
test('host counts: staff = staff+wired+wifi, servers min 2, mgmt = 10 + APs', () => {
  const c = withCounts({ staff: 20, wired: 5, wifi: 61, servers: 1 });
  const net = n => c.networks.find(x => x.name === n);
  assert.strictEqual(net('Staff LAN').hosts, 86);
  assert.strictEqual(net('Servers').hosts, 2);
  assert.strictEqual(net('Management').hosts, 13); // ceil(61/30)=3
  assert.strictEqual(net('Transit').hosts, 2);
  assert.strictEqual(net('Loopback').hosts, 1);
});
test('auto VLAN IDs by role, editable, Transit/Loopback none', () => {
  const c = withCounts({ staff: 5, voice: 5, cameras: 5, iot: 5, guest: 5, dmz: 5 }, { voice: true, cameras: true, iot: true, guest: true, dmz: true });
  const v = {}; c.networks.forEach(n => { v[n.name] = n.vlan; });
  assert.deepStrictEqual(v, { Management: 10, 'Staff LAN': 20, Servers: 30, Voice: 40, Cameras: 50, IoT: 60, Guest: 70, DMZ: 80, Transit: '', Loopback: '' });
  c.networks[1].vlan = 200; // editable
  assert.strictEqual(C.plan(I.toProject(c)).allocations.find(a => a.name === 'Staff LAN').vlan, 200);
});
test('roles and DHCP defaults on suggested networks', () => {
  const c = withCounts({ staff: 5, guest: 5, dmz: 2 }, { guest: true, dmz: true });
  const r = C.plan(I.toProject(c));
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.ok(by(r, 'Staff LAN').dhcpStart && by(r, 'Guest').dhcpStart);
  ['Management', 'Servers', 'DMZ', 'Transit', 'Loopback'].forEach(n => assert.strictEqual(by(r, n).dhcpStart, '', n));
  assert.strictEqual(by(r, 'Management').role, 'Mgmt');
});

console.log('Expansion buffer');
test('None / Soon / Big growth = 25 / 50 / 100 % and change the sizing', () => {
  const pre = x => { const c = withCounts({ staff: 40 }, {}, x); const r = C.plan(I.toProject(c)); assert.ok(r.ok, JSON.stringify(r.errors)); return [c.opts.growth, by(r, 'Staff LAN').prefix, by(r, 'Staff LAN').buffer]; };
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
  assert.deepStrictEqual(names(b), ['Management', 'Staff LAN', 'Servers', 'Voice', 'Cameras', 'Guest', 'DMZ', 'Transit', 'Loopback']);
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
