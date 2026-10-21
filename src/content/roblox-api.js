// RoGlobe — Roblox API client.
//
// SECURITY: this is the ONLY file in RoGlobe that makes network requests.
// It talks to exactly two Roblox hosts (see ALLOWED_HOSTS) and nothing else.
//
// Requests run from the content script on https://www.roblox.com, so the browser
// attaches the user's Roblox cookies itself, exactly as for the website's own
// requests. RoGlobe never reads, stores, logs or forwards cookies or tokens.
// The only header we set ourselves is Roblox's anti-CSRF token (see below).
(() => {
    'use strict';

    const ALLOWED_HOSTS = Object.freeze(['games.roblox.com', 'gamejoin.roblox.com']);
    const PLACE_ID_RE = /^\d{1,20}$/;
    const SERVER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const TIMEOUT_MS = 10_000;

    class RobloxApiError extends Error {
        /**
         * @param {'rate-limited' | 'signed-out' | 'http' | 'network' | 'timeout' | 'bad-response'} kind
         */
        constructor(kind, message, status = 0) {
            super(message);
            this.name = 'RobloxApiError';
            this.kind = kind;
            this.status = status;
        }
    }

    function isValidPlaceId(value) {
        return PLACE_ID_RE.test(String(value));
    }

    function isValidServerId(value) {
        return typeof value === 'string' && SERVER_ID_RE.test(value);
    }

    /** Keep only the fields RoGlobe uses from a server-list entry. */
    function normalizeServer(raw) {
        if (!raw || !isValidServerId(raw.id)) return null;
        const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
        return { id: raw.id, playing: num(raw.playing), maxPlayers: num(raw.maxPlayers), ping: num(raw.ping), fps: num(raw.fps) };
    }

    /**
     * The join endpoint may answer with plain JSON or with a server-sent-event
     * stream whose "ResponseReady" event carries the JSON. Accept both.
     * @returns {object | null}
     */
    function parseJoinBody(text, contentType) {
        if (typeof text !== 'string') return null;
        if (!/text\/event-stream/i.test(contentType || '')) {
            try {
                return JSON.parse(text);
            } catch {
                return null;
            }
        }
        const events = text.split(/\r?\n\r?\n/).map((block) => {
            let name = 'message';
            const data = [];
            for (const line of block.split(/\r?\n/)) {
                if (line.startsWith('event:')) name = line.slice(6).trim();
                else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
            }
            return { name, data: data.join('\n') };
        });
        const ready = events.find((e) => e.name === 'ResponseReady' && e.data) || events.find((e) => e.data.trim());
        if (!ready) return null;
        try {
            return JSON.parse(ready.data);
        } catch {
            return null;
        }
    }

    /**
     * Pull the server's public address out of a join response.
     * We only read the address; the rest of the join ticket is discarded and never stored.
     */
    function extractServerAddress(body) {
        const script = body && typeof body === 'object' ? body.joinScript : null;
        if (!script || typeof script !== 'object') return null;
        const udmux = Array.isArray(script.UdmuxEndpoints) ? script.UdmuxEndpoints[0] : null;
        const address = (udmux && udmux.Address) || script.MachineAddress || null;
        return typeof address === 'string' ? address : null;
    }

    /**
     * @param {{ fetch?: typeof fetch, readPageCsrfToken?: () => string | null }} [deps]
     *   Injected for unit tests; the browser defaults are used otherwise.
     */
    function createRobloxApi(deps = {}) {
        const doFetch = deps.fetch || ((...args) => globalThis.fetch(...args));
        const readPageCsrfToken =
            deps.readPageCsrfToken ||
            (() => document.querySelector('meta[name="csrf-token"]')?.getAttribute('data-token') || null);

        // Roblox's anti-CSRF token. Roblox puts it in the page and also returns a fresh one
        // in the `x-csrf-token` header of a 403 response; that handshake is Roblox's standard
        // protection for POST requests. Kept in memory only, never stored.
        let csrfToken = null;

        async function request(url, { method = 'GET', body, signal } = {}) {
            const parsed = new URL(url);
            // Defence in depth: refuse to talk to anything except the two Roblox hosts.
            if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.includes(parsed.hostname)) {
                throw new Error(`RoGlobe: blocked request to unexpected host ${parsed.hostname}`);
            }

            const send = async () => {
                const headers = { Accept: 'application/json' };
                if (method === 'POST') {
                    headers['Content-Type'] = 'application/json';
                    csrfToken = csrfToken || readPageCsrfToken();
                    if (csrfToken) headers['X-CSRF-TOKEN'] = csrfToken;
                }
                const timeout = AbortSignal.timeout(TIMEOUT_MS);
                const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
                try {
                    return await doFetch(parsed.href, {
                        method,
                        headers,
                        body: body === undefined ? undefined : JSON.stringify(body),
                        credentials: 'include', // send Roblox's own cookies, as the website does
                        signal: combined,
                    });
                } catch (error) {
                    if (signal?.aborted) throw error; // user cancelled: let caller see AbortError
                    if (timeout.aborted) throw new RobloxApiError('timeout', 'Roblox took too long to respond.');
                    throw new RobloxApiError('network', 'Could not reach Roblox. Check your connection.');
                }
            };

            let response = await send();
            if (response.status === 403 && method === 'POST') {
                const fresh = response.headers.get('x-csrf-token');
                if (fresh && fresh !== csrfToken) {
                    csrfToken = fresh;
                    response = await send();
                }
            }
            if (response.status === 429) {
                throw new RobloxApiError('rate-limited', 'Roblox is rate limiting requests. Wait a minute and try again.', 429);
            }
            if (response.status === 401) {
                throw new RobloxApiError('signed-out', 'Sign in to Roblox to look up server locations.', 401);
            }
            if (!response.ok) {
                throw new RobloxApiError('http', `Roblox returned HTTP ${response.status}.`, response.status);
            }
            return response;
        }

        async function readServerPage(url, signal) {
            const response = await request(url, { signal });
            let data;
            try {
                data = await response.json();
            } catch {
                throw new RobloxApiError('bad-response', 'Roblox sent an unexpected response.');
            }
            if (!data || !Array.isArray(data.data)) {
                throw new RobloxApiError('bad-response', 'Roblox sent an unexpected response.');
            }
            return {
                servers: data.data.map(normalizeServer).filter(Boolean),
                nextCursor: typeof data.nextPageCursor === 'string' && data.nextPageCursor ? data.nextPageCursor : null,
            };
        }

        /** One page (up to 100) of public servers that aren't full. */
        function listPublicServers(placeId, cursor = null, { signal } = {}) {
            if (!isValidPlaceId(placeId)) throw new Error('RoGlobe: invalid place id');
            const url = new URL(`https://games.roblox.com/v1/games/${placeId}/servers/Public`);
            url.searchParams.set('limit', '100');
            url.searchParams.set('excludeFullGames', 'true');
            if (cursor) url.searchParams.set('cursor', cursor);
            return readServerPage(url.href, signal);
        }

        /**
         * Servers ordered by Roblox's own "best latency" estimate for this user.
         * Undocumented ordering parameter; if Roblox stops supporting it we show an error.
         */
        function listClosestServers(placeId, { signal } = {}) {
            if (!isValidPlaceId(placeId)) throw new Error('RoGlobe: invalid place id');
            const url = new URL(`https://games.roblox.com/v2/games/${placeId}/servers/Public`);
            url.searchParams.set('sortOrder', 'Desc');
            url.searchParams.set('excludeFullGames', 'true');
            url.searchParams.set('orderBy', 'BestLatency');
            return readServerPage(url.href, signal);
        }

        /**
         * Ask Roblox for a join ticket for one server, only to read its IP address.
         * This does NOT start the game. Undocumented endpoint; rate limited by Roblox.
         * @returns {Promise<{ address: string | null, joinStatus: number | null }>}
         */
        async function lookupServerAddress(placeId, serverId, { signal } = {}) {
            if (!isValidPlaceId(placeId) || !isValidServerId(serverId)) throw new Error('RoGlobe: invalid ids');
            const response = await request('https://gamejoin.roblox.com/v1/join-game-instance', {
                method: 'POST',
                body: { placeId: Number(placeId), gameId: serverId, gameJoinAttemptId: crypto.randomUUID() },
                signal,
            });
            const body = parseJoinBody(await response.text(), response.headers.get('content-type'));
            return {
                address: extractServerAddress(body),
                joinStatus: body && Number.isFinite(body.status) ? body.status : null,
            };
        }

        return { listPublicServers, listClosestServers, lookupServerAddress };
    }

    const api = {
        ALLOWED_HOSTS,
        RobloxApiError,
        createRobloxApi,
        isValidPlaceId,
        isValidServerId,
        parseJoinBody,
        extractServerAddress,
        normalizeServer,
    };
    globalThis.RoGlobe = Object.assign(globalThis.RoGlobe || {}, { robloxApi: api });
    if (typeof module === 'object' && module.exports) module.exports = api;
})();
