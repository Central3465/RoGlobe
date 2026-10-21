// RoGlobe — content-script entry point (isolated world).
// Finds the server list on a Roblox game page and mounts the RoGlobe panel above it.
(() => {
    'use strict';

    const { robloxApi, panel } = globalThis.RoGlobe;

    const placeId = (window.location.pathname.match(/\/games\/(\d+)/) || [])[1];
    if (!placeId || !robloxApi.isValidPlaceId(placeId)) return;

    // Roblox's server-list containers, newest first. These ids aren't a public
    // contract, so several are tried; if none appears we fall back to the
    // servers tab, then to the main content area.
    const ANCHORS = ['#running-game-instances-container', '#rbx-public-running-games', '#rbx-game-server-item-container'];
    const FALLBACKS = ['#game-instances', '#content'];
    const FALLBACK_AFTER_MS = 8000;

    // Joining goes through launcher-main.js in the page world (see that file).
    const pendingJoins = new Map();
    window.addEventListener('message', (event) => {
        const data = event.data;
        if (event.source !== window || !data || data.source !== 'roglobe' || data.type !== 'join-result') return;
        pendingJoins.get(data.serverId)?.(data.ok === true);
        pendingJoins.delete(data.serverId);
    });
    function join(serverId) {
        return new Promise((resolve) => {
            pendingJoins.set(serverId, resolve);
            window.postMessage({ source: 'roglobe', type: 'join', placeId, serverId }, window.location.origin);
            setTimeout(() => {
                if (pendingJoins.delete(serverId)) resolve(false);
            }, 3000);
        });
    }

    const api = robloxApi.createRobloxApi();
    const element = panel.createPanel({ placeId, api, join });
    const startedAt = Date.now();

    function mount() {
        if (element.isConnected) return true;
        for (const selector of ANCHORS) {
            const anchor = document.querySelector(selector);
            if (anchor?.parentElement) {
                anchor.parentElement.insertBefore(element, anchor);
                return true;
            }
        }
        if (Date.now() - startedAt > FALLBACK_AFTER_MS) {
            for (const selector of FALLBACKS) {
                const host = document.querySelector(selector);
                if (host) {
                    host.prepend(element);
                    return true;
                }
            }
        }
        return false;
    }

    // Roblox renders the page progressively and may re-render the list, which can
    // remove our panel. Re-check on DOM changes, at most once per animation frame.
    let scheduled = false;
    const observer = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            mount();
        });
    });
    mount();
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(mount, FALLBACK_AFTER_MS + 100);
})();
