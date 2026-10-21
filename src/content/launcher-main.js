// RoGlobe — join bridge. Runs in the PAGE's JavaScript world ("world": "MAIN"),
// because Roblox's own join function lives there and content scripts can't see it.
//
// SECURITY:
// - Static file shipped with the extension. No strings are ever evaluated as code.
// - It does one thing: call Roblox's own Roblox.GameLauncher.joinGameInstance, which
//   is what the website's Join button calls. Roblox then shows its usual launch flow.
// - Inputs are validated (numeric place id, UUID server id) before use.
// - Any script on the page could send this message, but it could just as well call
//   Roblox.GameLauncher directly, so this bridge grants no extra capability.
(() => {
    'use strict';

    const PLACE_ID_RE = /^\d{1,20}$/;
    const SERVER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    window.addEventListener('message', (event) => {
        if (event.source !== window || event.origin !== window.location.origin) return;
        const data = event.data;
        if (!data || data.source !== 'roglobe' || data.type !== 'join') return;

        const placeId = String(data.placeId);
        const serverId = String(data.serverId);
        let ok = false;
        if (PLACE_ID_RE.test(placeId) && SERVER_ID_RE.test(serverId)) {
            const launcher = window.Roblox && window.Roblox.GameLauncher;
            if (launcher && typeof launcher.joinGameInstance === 'function') {
                launcher.joinGameInstance(Number(placeId), serverId);
                ok = true;
            }
        }
        window.postMessage({ source: 'roglobe', type: 'join-result', serverId, ok }, window.location.origin);
    });
})();
