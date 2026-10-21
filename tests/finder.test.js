const test = require('node:test');
const assert = require('node:assert/strict');
const robloxApi = require('../src/content/roblox-api.js');
const finder = require('../src/content/finder.js');
const { createFakeRoblox, sid } = require('./helpers/fake-roblox.js');

const PLACE = '1818';
const FRANKFURT = '128.116.5.10';
const TOKYO = '128.116.55.10';
const UNLISTED = '128.116.84.10'; // in Roblox's block but not in our table
const noSleep = async () => {};

function setup(servers, fakeOpts = {}) {
    const fake = createFakeRoblox({ servers, ...fakeOpts });
    const api = robloxApi.createRobloxApi({ fetch: fake.fetch, readPageCsrfToken: () => 't' });
    return { fake, api };
}

function make(list) {
    return list.map((ip, i) => ({ id: sid(i), ip }));
}

test('filters by region; unknown and other regions are counted, never relabelled', async () => {
    const { api } = setup(make([FRANKFURT, TOKYO, UNLISTED, null, FRANKFURT]));
    const search = finder.createRegionSearch({ api, placeId: PLACE, regionId: 'de-frankfurt', sleep: noSleep });
    const snap = await search.run();
    assert.deepEqual(snap.matches.map((s) => s.id), [sid(0), sid(4)]);
    assert.equal(snap.checked, 5);
    assert.equal(snap.unknown, 2);
    assert.deepEqual(snap.elsewhere, { 'jp-tokyo': 1 });
    assert.equal(snap.stopReason, 'end');
    assert.equal(snap.canContinue, false);
});

test('pagination: follows cursors across pages', async () => {
    const ips = Array.from({ length: 25 }, (_, i) => (i === 23 ? FRANKFURT : TOKYO));
    const { fake, api } = setup(make(ips), { pageSize: 10 });
    const snap = await finder.createRegionSearch({ api, placeId: PLACE, regionId: 'de-frankfurt', sleep: noSleep }).run();
    assert.equal(snap.matches.length, 1);
    assert.equal(snap.checked, 25);
    assert.equal(fake.requests.filter((r) => r.host === 'games.roblox.com').length, 3);
});

test('empty server list -> end with no matches', async () => {
    const { api } = setup([]);
    const snap = await finder.createRegionSearch({ api, placeId: PLACE, regionId: 'de-frankfurt', sleep: noSleep }).run();
    assert.equal(snap.stopReason, 'end');
    assert.equal(snap.matches.length, 0);
    assert.equal(snap.checked, 0);
});

test('caps: stops at maxChecksPerRun, then "check more" resumes where it left off', async () => {
    const { fake, api } = setup(make(Array(250).fill(TOKYO)));
    const search = finder.createRegionSearch({ api, placeId: PLACE, regionId: 'de-frankfurt', sleep: noSleep });
    const first = await search.run();
    assert.equal(first.stopReason, 'limit');
    assert.equal(first.checked, 100);
    assert.equal(fake.joinCount, 100);
    assert.equal(first.canContinue, true);
    const second = await search.run();
    assert.equal(second.checked, 200);
    assert.equal(fake.joinCount, 200);
});

test('stops early once maxMatches servers are found', async () => {
    const { fake, api } = setup(make(Array(50).fill(FRANKFURT)));
    const snap = await finder.createRegionSearch({ api, placeId: PLACE, regionId: 'de-frankfurt', sleep: noSleep }).run();
    assert.equal(snap.stopReason, 'enough');
    assert.equal(snap.matches.length, finder.DEFAULT_LIMITS.maxMatches);
    assert.equal(fake.joinCount, finder.DEFAULT_LIMITS.maxMatches);
});

test('rate limit (429): stops immediately, no automatic retry, resumable later', async () => {
    const { fake, api } = setup(make([TOKYO, TOKYO, FRANKFURT, FRANKFURT]), { rateLimitAfterJoins: 2 });
    const search = finder.createRegionSearch({ api, placeId: PLACE, regionId: 'de-frankfurt', sleep: noSleep });
    const snap = await search.run();
    assert.equal(snap.stopReason, 'error');
    assert.equal(snap.error.kind, 'rate-limited');
    assert.equal(snap.checked, 2);
    assert.equal(fake.joinCount, 3); // the 3rd call got the 429; nothing after it
    assert.equal(snap.canContinue, true);
});

test('single failed lookups count as unknown; 3 in a row stop the run', async () => {
    const servers = make([FRANKFURT, TOKYO, TOKYO, TOKYO, FRANKFURT]);
    const { api } = setup(servers, { failJoinFor: new Set([sid(1)]) });
    const ok = await finder.createRegionSearch({ api, placeId: PLACE, regionId: 'de-frankfurt', sleep: noSleep }).run();
    assert.equal(ok.unknown, 1);
    assert.equal(ok.matches.length, 2);

    const { api: api2 } = setup(servers, { failJoinFor: new Set([sid(1), sid(2), sid(3)]) });
    const bad = await finder.createRegionSearch({ api: api2, placeId: PLACE, regionId: 'de-frankfurt', sleep: noSleep }).run();
    assert.equal(bad.stopReason, 'error');
    assert.equal(bad.error.kind, 'http');
    assert.equal(bad.checked, 4);
});

test('list endpoint failure is reported as an error state', async () => {
    const { api } = setup([], { listStatus: 503 });
    const snap = await finder.createRegionSearch({ api, placeId: PLACE, regionId: 'de-frankfurt', sleep: noSleep }).run();
    assert.equal(snap.stopReason, 'error');
    assert.equal(snap.error.kind, 'http');
});

test('location cache: switching region re-uses lookups instead of repeating them', async () => {
    const { fake, api } = setup(make([FRANKFURT, TOKYO, TOKYO]));
    const cache = new Map();
    await finder.createRegionSearch({ api, placeId: PLACE, regionId: 'de-frankfurt', locationCache: cache, sleep: noSleep }).run();
    assert.equal(fake.joinCount, 3);
    const tokyo = await finder.createRegionSearch({ api, placeId: PLACE, regionId: 'jp-tokyo', locationCache: cache, sleep: noSleep }).run();
    assert.equal(tokyo.matches.length, 2);
    assert.equal(fake.joinCount, 3); // no new join calls
});

test('requests are paced: sleep is awaited between lookups', async () => {
    const { api } = setup(make([TOKYO, TOKYO, TOKYO]));
    const waits = [];
    await finder.createRegionSearch({ api, placeId: PLACE, regionId: 'de-frankfurt', sleep: async (ms) => waits.push(ms) }).run();
    assert.deepEqual(waits, [250, 250]);
});

test('cancel: aborting returns a "cancelled" snapshot', async () => {
    const { api } = setup(make(Array(20).fill(TOKYO)));
    const controller = new AbortController();
    const snap = await finder
        .createRegionSearch({ api, placeId: PLACE, regionId: 'de-frankfurt', limits: { delayMs: 5 } })
        .run({ signal: controller.signal, onProgress: (s) => s.checked === 3 && controller.abort() });
    assert.equal(snap.stopReason, 'cancelled');
    assert.equal(snap.checked, 3);
});

test('unknown region ids are rejected', () => {
    assert.throws(() => finder.createRegionSearch({ api: {}, placeId: PLACE, regionId: 'atlantis' }), /unknown region/);
});

test('closest mode: one request, no join lookups, uses cached locations only', async () => {
    const { fake, api } = setup(make([FRANKFURT, TOKYO]));
    const cache = new Map([[sid(0), 'de-frankfurt']]);
    const result = await finder.findClosestServers({ api, placeId: PLACE, locationCache: cache });
    assert.equal(result.error, null);
    assert.deepEqual(result.servers.map((s) => s.regionId), ['de-frankfurt', null]);
    assert.equal(fake.joinCount, 0);
    assert.equal(fake.requests.length, 1);
});

test('closest mode: API failure becomes an error, not an exception', async () => {
    const { api } = setup([], { listStatus: 429 });
    const result = await finder.findClosestServers({ api, placeId: PLACE });
    assert.equal(result.error.kind, 'rate-limited');
});
