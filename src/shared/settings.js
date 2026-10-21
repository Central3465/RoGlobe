// RoGlobe — local settings.
// Stored with chrome.storage.local: stays on this device, never synced or sent anywhere.
// Only two values are stored: the mode and the chosen region id.
(() => {
    'use strict';

    const regions = globalThis.RoGlobe?.regions ?? require('./regions.js');

    const STORAGE_KEY = 'roglobeSettings';
    const MODES = ['off', 'closest', 'region'];
    const DEFAULTS = Object.freeze({ mode: 'off', regionId: null });

    /**
     * Never trust stored data blindly (it may come from an older version or be edited
     * by hand in DevTools). Anything invalid falls back to the defaults.
     */
    function sanitize(raw) {
        const value = raw && typeof raw === 'object' ? raw : {};
        const regionId = regions.isKnownRegion(value.regionId) ? value.regionId : null;
        // mode 'region' with regionId null is valid: "region mode, nothing chosen yet".
        const mode = MODES.includes(value.mode) ? value.mode : DEFAULTS.mode;
        return { mode, regionId };
    }

    async function load(storage = chrome.storage.local) {
        try {
            const result = await storage.get(STORAGE_KEY);
            return sanitize(result[STORAGE_KEY]);
        } catch {
            return { ...DEFAULTS };
        }
    }

    async function save(next, storage = chrome.storage.local) {
        const clean = sanitize(next);
        await storage.set({ [STORAGE_KEY]: clean });
        return clean;
    }

    /** Calls `callback(settings)` whenever settings change in any tab or the popup. */
    function onChange(callback) {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes[STORAGE_KEY]) callback(sanitize(changes[STORAGE_KEY].newValue));
        });
    }

    const api = { STORAGE_KEY, MODES, DEFAULTS, sanitize, load, save, onChange };
    globalThis.RoGlobe = Object.assign(globalThis.RoGlobe || {}, { settings: api });
    if (typeof module === 'object' && module.exports) module.exports = api;
})();
