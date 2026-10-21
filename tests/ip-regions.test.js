const test = require('node:test');
const assert = require('node:assert/strict');
const ip = require('../src/shared/ip.js');
const { DATACENTERS } = require('../src/shared/datacenters.js');
const regions = require('../src/shared/regions.js');

test('parseIPv4 accepts plain IPv4 and rejects everything else', () => {
    assert.equal(ip.parseIPv4('0.0.0.0'), 0);
    assert.equal(ip.parseIPv4('255.255.255.255'), 2 ** 32 - 1);
    assert.equal(ip.parseIPv4('128.116.5.10'), 128 * 2 ** 24 + 116 * 2 ** 16 + 5 * 256 + 10);
    for (const bad of ['', '1.2.3', '1.2.3.4.5', '256.1.1.1', '01.2.3.4', '1.2.3.4:53640', '::1', 'roblox.com', null, undefined, 42, ' ']) {
        assert.equal(ip.parseIPv4(bad), null, `should reject ${String(bad)}`);
    }
});

test('parseCidr / cidrContains', () => {
    const r = ip.parseCidr('128.116.5.0/24');
    assert.ok(ip.cidrContains(r, ip.parseIPv4('128.116.5.0')));
    assert.ok(ip.cidrContains(r, ip.parseIPv4('128.116.5.255')));
    assert.ok(!ip.cidrContains(r, ip.parseIPv4('128.116.6.0')));
    assert.ok(!ip.cidrContains(r, ip.parseIPv4('128.116.4.255')));
    // base gets masked
    assert.deepEqual(ip.parseCidr('10.1.2.3/8'), { base: ip.parseIPv4('10.0.0.0'), prefix: 8 });
    for (const bad of ['1.2.3.0', '1.2.3.0/33', '1.2.3.0/x', '1.2.3.0/24/1', 'x/24']) assert.equal(ip.parseCidr(bad), null);
});

test('datacenter table: well-formed, inside Roblox block, no overlaps, unique ids', () => {
    const robloxBlock = ip.parseCidr('128.116.0.0/17');
    const ids = new Set();
    const all = [];
    for (const dc of DATACENTERS) {
        assert.match(dc.id, /^[a-z]{2}-[a-z]+$/);
        assert.ok(!ids.has(dc.id), `duplicate id ${dc.id}`);
        ids.add(dc.id);
        assert.match(dc.country, /^[A-Z]{2}$/);
        assert.ok(regions.CONTINENT_ORDER.includes(dc.continent), `${dc.id} continent`);
        assert.ok(dc.city && dc.countryName);
        assert.ok(dc.ranges.length > 0);
        for (const cidr of dc.ranges) {
            const r = ip.parseCidr(cidr);
            assert.ok(r, `${cidr} parses`);
            assert.equal(ip.parseCidr(cidr).base, ip.parseIPv4(cidr.split('/')[0]), `${cidr} is a network address`);
            assert.ok(ip.cidrContains(robloxBlock, r.base) && r.prefix >= 17, `${cidr} inside 128.116.0.0/17`);
            for (const other of all) {
                assert.ok(!ip.cidrContains(other.r, r.base) && !ip.cidrContains(r, other.r.base), `${cidr} overlaps ${other.cidr}`);
            }
            all.push({ cidr, r });
        }
    }
});

test('regionIdForIp: known ranges match, everything else is unknown (null)', () => {
    assert.equal(regions.regionIdForIp('128.116.5.77'), 'de-frankfurt');
    assert.equal(regions.regionIdForIp('128.116.44.1'), 'de-frankfurt');
    assert.equal(regions.regionIdForIp('128.116.102.200'), 'us-ashburn');
    assert.equal(regions.regionIdForIp('128.116.51.9'), 'au-sydney');
    // Inside Roblox's block but not in the table: must NOT be guessed.
    assert.equal(regions.regionIdForIp('128.116.84.10'), null);
    assert.equal(regions.regionIdForIp('128.116.30.10'), null); // listed as "Decommissioned?"
    // AWS / private / junk
    assert.equal(regions.regionIdForIp('3.80.1.1'), null);
    assert.equal(regions.regionIdForIp('10.0.0.1'), null);
    assert.equal(regions.regionIdForIp(null), null);
    assert.equal(regions.regionIdForIp('not an ip'), null);
});

test('labels and grouping', () => {
    assert.equal(regions.regionLabel('de-frankfurt'), 'Frankfurt, Germany');
    assert.equal(regions.regionLabel('us-ashburn'), 'Ashburn, VA, United States');
    assert.equal(regions.regionLabel('nope'), 'Unknown location');
    assert.equal(regions.flagEmoji('DE'), '🇩🇪');
    assert.equal(regions.flagEmoji('x'), '🌐');
    const groups = regions.groupedRegions();
    assert.deepEqual(groups.map((g) => g.continent), regions.CONTINENT_ORDER);
    assert.equal(groups.reduce((n, g) => n + g.regions.length, 0), DATACENTERS.length);
});
