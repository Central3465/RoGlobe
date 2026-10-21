// RoGlobe — server discovery and region filtering.
// No DOM and no direct network access: it receives the API client, so it can be
// unit-tested with a fake one.
(() => {
    'use strict';

    const regions = globalThis.RoGlobe?.regions ?? require('../shared/regions.js');

    // Safety limits (see docs/stage-2-architecture.md §4).
    const DEFAULT_LIMITS = Object.freeze({
        maxChecksPerRun: 100, // join-ticket lookups per click of "Find" / "Check more"
        maxMatches: 10, // stop early once this many matching servers are found
        delayMs: 250, // pause between lookups, one at a time
        maxConsecutiveFailures: 3,
    });

    // Errors after which continuing makes no sense for this run.
    const FATAL_KINDS = new Set(['rate-limited', 'signed-out', 'network', 'timeout']);

    const defaultSleep = (ms, signal) =>
        new Promise((resolve, reject) => {
            if (signal?.aborted) return reject(signal.reason);
            const timer = setTimeout(resolve, ms);
            signal?.addEventListener(
                'abort',
                () => {
                    clearTimeout(timer);
                    reject(signal.reason);
                },
                { once: true },
            );
        });

    /**
     * A resumable search for servers in one region.
     * Each call to `run()` performs at most `maxChecksPerRun` lookups and returns a snapshot.
     *
     * @param {object} options
     * @param {object} options.api  client from roblox-api.js createRobloxApi()
     * @param {string} options.placeId
     * @param {string} options.regionId
     * @param {Map<string, string | null>} [options.locationCache] serverId -> regionId (null = unknown), shared across searches
     */
    function createRegionSearch({ api, placeId, regionId, locationCache = new Map(), limits = {}, sleep = defaultSleep }) {
        if (!regions.isKnownRegion(regionId)) throw new Error('RoGlobe: unknown region');
        const cfg = { ...DEFAULT_LIMITS, ...limits };

        const state = {
            matches: [], // servers located in the selected region
            checked: 0, // servers whose location we tried to determine
            unknown: 0, // location could not be determined (no IP, IP not in table, lookup error)
            elsewhere: {}, // regionId -> count, for servers located in other regions
            queue: [], // servers from the current page not yet checked
            cursor: null,
            listExhausted: false,
            seen: new Set(),
        };

        function snapshot(stopReason, error = null) {
            return {
                regionId,
                matches: state.matches.slice(),
                checked: state.checked,
                unknown: state.unknown,
                elsewhere: { ...state.elsewhere },
                canContinue: !state.listExhausted || state.queue.length > 0,
                stopReason, // 'enough' | 'limit' | 'end' | 'cancelled' | 'error'
                error, // RobloxApiError-like { kind, message } or null
            };
        }

        function record(server, foundRegion) {
            state.checked += 1;
            if (foundRegion === null) state.unknown += 1;
            else if (foundRegion === regionId) state.matches.push({ ...server, regionId });
            else state.elsewhere[foundRegion] = (state.elsewhere[foundRegion] || 0) + 1;
        }

        async function nextServer(signal) {
            while (state.queue.length === 0) {
                if (state.listExhausted) return null;
                const page = await api.listPublicServers(placeId, state.cursor, { signal });
                state.cursor = page.nextCursor;
                if (!page.nextCursor) state.listExhausted = true;
                for (const s of page.servers) {
                    if (!state.seen.has(s.id)) {
                        state.seen.add(s.id);
                        state.queue.push(s);
                    }
                }
            }
            return state.queue.shift();
        }

        /** @param {{ signal?: AbortSignal, onProgress?: (snap: object) => void }} [opts] */
        async function run({ signal, onProgress } = {}) {
            let lookups = 0;
            let consecutiveFailures = 0;
            const startMatches = state.matches.length;
            try {
                while (true) {
                    if (signal?.aborted) return snapshot('cancelled');
                    if (state.matches.length - startMatches >= cfg.maxMatches) return snapshot('enough');
                    if (lookups >= cfg.maxChecksPerRun) return snapshot('limit');

                    const server = await nextServer(signal);
                    if (!server) return snapshot('end');

                    if (locationCache.has(server.id)) {
                        record(server, locationCache.get(server.id));
                        continue; // already known: no request, no delay
                    }

                    if (lookups > 0) await sleep(cfg.delayMs, signal);
                    lookups += 1;
                    try {
                        const { address } = await api.lookupServerAddress(placeId, server.id, { signal });
                        const found = regions.regionIdForIp(address);
                        locationCache.set(server.id, found);
                        record(server, found);
                        consecutiveFailures = 0;
                    } catch (error) {
                        if (signal?.aborted) throw error;
                        if (FATAL_KINDS.has(error?.kind)) {
                            state.queue.unshift(server); // retry this server on the next run
                            return snapshot('error', toPlainError(error));
                        }
                        // One server failed (full, shut down, odd response): its location is unknown.
                        record(server, null);
                        consecutiveFailures += 1;
                        if (consecutiveFailures >= cfg.maxConsecutiveFailures) {
                            return snapshot('error', toPlainError(error));
                        }
                    }
                    onProgress?.(snapshot('running'));
                }
            } catch (error) {
                if (signal?.aborted) return snapshot('cancelled');
                return snapshot('error', toPlainError(error));
            }
        }

        return { run, get regionId() { return regionId; } };
    }

    function toPlainError(error) {
        return { kind: error?.kind || 'unknown', message: error?.message || 'Something went wrong.' };
    }

    /**
     * "Closest to me": a single request using Roblox's latency ordering. No per-server lookups.
     * Location labels are shown only for servers already located earlier (cache), otherwise unknown.
     */
    async function findClosestServers({ api, placeId, locationCache = new Map(), signal, count = 10 }) {
        try {
            const page = await api.listClosestServers(placeId, { signal });
            const servers = page.servers.slice(0, count).map((s) => ({ ...s, regionId: locationCache.get(s.id) ?? null }));
            return { servers, error: null };
        } catch (error) {
            if (signal?.aborted) return { servers: [], error: null, cancelled: true };
            return { servers: [], error: toPlainError(error) };
        }
    }

    const api = { DEFAULT_LIMITS, createRegionSearch, findClosestServers };
    globalThis.RoGlobe = Object.assign(globalThis.RoGlobe || {}, { finder: api });
    if (typeof module === 'object' && module.exports) module.exports = api;
})();
