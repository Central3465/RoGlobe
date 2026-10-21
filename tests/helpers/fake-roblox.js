// A fake Roblox backend for tests: implements just enough of the two endpoints RoGlobe uses.
// Records every request so tests can assert exactly which hosts were contacted.

/** Deterministic UUID-shaped server id. */
function sid(n) {
    return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/**
 * @param {object} opts
 * @param {{ id: string, ip: string | null }[]} opts.servers  all servers, in list order
 * @param {number} [opts.pageSize]
 * @param {number} [opts.rateLimitAfterJoins]  respond 429 to join calls after this many
 * @param {Set<string>} [opts.failJoinFor]      server ids whose join call returns HTTP 500
 * @param {boolean} [opts.sse]                  answer join calls as text/event-stream
 * @param {boolean} [opts.requireCsrf]          first POST gets 403 + x-csrf-token
 * @param {number} [opts.listStatus]            force an HTTP status for the list endpoint
 */
function createFakeRoblox(opts) {
    const pageSize = opts.pageSize || 100;
    const requests = [];
    let joins = 0;
    const validToken = 'csrf-123';

    const json = (body, status = 200, headers = {}) =>
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

    async function fetch(url, init = {}) {
        const u = new URL(url);
        requests.push({ host: u.hostname, path: u.pathname, search: u.search, method: init.method || 'GET', headers: init.headers || {}, credentials: init.credentials, body: init.body });

        if (u.hostname === 'games.roblox.com' && /\/servers\/Public$/.test(u.pathname)) {
            if (opts.listStatus) return json({ errors: [] }, opts.listStatus);
            const start = Number(u.searchParams.get('cursor') || 0);
            const slice = opts.servers.slice(start, start + pageSize);
            const next = start + pageSize < opts.servers.length ? String(start + pageSize) : null;
            return json({
                previousPageCursor: null,
                nextPageCursor: next,
                data: slice.map((s, i) => ({ id: s.id, maxPlayers: 20, playing: (start + i) % 20, ping: 50, fps: 60, playerTokens: [] })),
            });
        }

        if (u.hostname === 'gamejoin.roblox.com' && u.pathname === '/v1/join-game-instance') {
            if (opts.requireCsrf && init.headers['X-CSRF-TOKEN'] !== validToken) {
                return json({ errors: [{ message: 'Token Validation Failed' }] }, 403, { 'x-csrf-token': validToken });
            }
            joins += 1;
            if (opts.rateLimitAfterJoins !== undefined && joins > opts.rateLimitAfterJoins) return json({ errors: [] }, 429);
            const { gameId } = JSON.parse(init.body);
            if (opts.failJoinFor?.has(gameId)) return json({ errors: [] }, 500);
            const server = opts.servers.find((s) => s.id === gameId);
            const body = server?.ip
                ? { status: 2, joinScript: { UdmuxEndpoints: [{ Address: server.ip, Port: 53640 }], MachineAddress: '10.0.0.1' } }
                : { status: 22, joinScript: null };
            if (opts.sse) {
                const text = `event: Progress\ndata: {"status":0}\n\nevent: ResponseReady\ndata: ${JSON.stringify(body)}\n\n`;
                return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
            }
            return json(body);
        }

        return json({ errors: [{ message: 'not found' }] }, 404);
    }

    return { fetch, requests, get joinCount() { return joins; } };
}

module.exports = { createFakeRoblox, sid };
