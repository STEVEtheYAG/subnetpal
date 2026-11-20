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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
