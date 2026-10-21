const test = require('node:test');
const assert = require('node:assert/strict');
const robloxApi = require('../src/content/roblox-api.js');
const { createFakeRoblox, sid } = require('./helpers/fake-roblox.js');

const PLACE = '1818';

function setup(opts) {
    const fake = createFakeRoblox(opts);
    const api = robloxApi.createRobloxApi({ fetch: fake.fetch, readPageCsrfToken: () => opts.pageToken || null });
    return { fake, api };
}

test('listPublicServers: one page, normalised fields, cursor handling', async () => {
    const servers = Array.from({ length: 150 }, (_, i) => ({ id: sid(i), ip: null }));
    const { fake, api } = setup({ servers });
    const p1 = await api.listPublicServers(PLACE);
    assert.equal(p1.servers.length, 100);
    assert.deepEqual(Object.keys(p1.servers[0]).sort(), ['fps', 'id', 'maxPlayers', 'ping', 'playing']);
    assert.equal(p1.nextCursor, '100');
    const p2 = await api.listPublicServers(PLACE, p1.nextCursor);
    assert.equal(p2.servers.length, 50);
    assert.equal(p2.nextCursor, null);
    assert.equal(fake.requests[0].search, '?limit=100&excludeFullGames=true');
    assert.equal(fake.requests[0].credentials, 'include');
});

test('lookupServerAddress reads the UDMUX address (JSON and event-stream)', async () => {
    for (const sse of [false, true]) {
        const { fake, api } = setup({ servers: [{ id: sid(1), ip: '128.116.5.20' }], sse });
        const res = await api.lookupServerAddress(PLACE, sid(1));
        assert.equal(res.address, '128.116.5.20');
        assert.equal(res.joinStatus, 2);
        const body = JSON.parse(fake.requests[0].body);
        assert.equal(body.placeId, 1818);
        assert.equal(body.gameId, sid(1));
        assert.match(body.gameJoinAttemptId, /^[0-9a-f-]{36}$/);
    }
});

test('lookupServerAddress: server without joinScript gives null address, not a guess', async () => {
    const { api } = setup({ servers: [{ id: sid(1), ip: null }] });
    assert.deepEqual(await api.lookupServerAddress(PLACE, sid(1)), { address: null, joinStatus: 22 });
});

test('CSRF: 403 with x-csrf-token is retried once with the new token', async () => {
    const { fake, api } = setup({ servers: [{ id: sid(1), ip: '128.116.5.20' }], requireCsrf: true });
    const res = await api.lookupServerAddress(PLACE, sid(1));
    assert.equal(res.address, '128.116.5.20');
    assert.equal(fake.requests.length, 2);
    assert.equal(fake.requests[1].headers['X-CSRF-TOKEN'], 'csrf-123');
    // token is reused afterwards: no second handshake
    await api.lookupServerAddress(PLACE, sid(1));
    assert.equal(fake.requests.length, 3);
});

test('errors are classified: 429 rate-limited, 401 signed-out, 5xx http, junk bad-response', async () => {
    const servers = [{ id: sid(1), ip: '128.116.5.20' }];
    await assert.rejects(setup({ servers, rateLimitAfterJoins: 0 }).api.lookupServerAddress(PLACE, sid(1)), { kind: 'rate-limited' });
    await assert.rejects(setup({ servers, listStatus: 401 }).api.listPublicServers(PLACE), { kind: 'signed-out' });
    await assert.rejects(setup({ servers, listStatus: 503 }).api.listPublicServers(PLACE), { kind: 'http', status: 503 });
    const junk = robloxApi.createRobloxApi({ fetch: async () => new Response('<html>', { status: 200 }) });
    await assert.rejects(junk.listPublicServers(PLACE), { kind: 'bad-response' });
    const offline = robloxApi.createRobloxApi({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
    await assert.rejects(offline.listPublicServers(PLACE), { kind: 'network' });
});

test('invalid ids are refused before any request', async () => {
    const { fake, api } = setup({ servers: [] });
    assert.throws(() => api.listPublicServers('12; drop'), /invalid place id/);
    await assert.rejects(api.lookupServerAddress(PLACE, 'not-a-uuid'), /invalid ids/);
    assert.equal(fake.requests.length, 0);
});

test('closest servers use Roblox latency ordering on games.roblox.com only', async () => {
    const { fake, api } = setup({ servers: [{ id: sid(1), ip: null }] });
    await api.listClosestServers(PLACE);
    assert.equal(fake.requests[0].host, 'games.roblox.com');
    assert.equal(fake.requests[0].path, `/v2/games/${PLACE}/servers/Public`);
    assert.match(fake.requests[0].search, /orderBy=BestLatency/);
});

test('parseJoinBody tolerates garbage', () => {
    assert.equal(robloxApi.parseJoinBody('nope', 'application/json'), null);
    assert.equal(robloxApi.parseJoinBody('event: x\n\n', 'text/event-stream'), null);
    assert.equal(robloxApi.extractServerAddress({ joinScript: { UdmuxEndpoints: [] } }), null);
    assert.equal(robloxApi.extractServerAddress(null), null);
});
