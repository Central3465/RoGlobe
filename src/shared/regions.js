// RoGlobe — regions: turn a server IP into a region, and describe regions for the UI.
// Pure functions; depends only on ip.js and datacenters.js.
(() => {
    'use strict';

    const ip = globalThis.RoGlobe?.ip ?? require('./ip.js');
    const { DATACENTERS } = globalThis.RoGlobe?.datacenters ?? require('./datacenters.js');

    const CONTINENT_ORDER = ['North America', 'South America', 'Europe', 'Asia', 'Oceania'];

    // Pre-parse every range once.
    const RANGE_INDEX = DATACENTERS.flatMap((dc) =>
        dc.ranges.map((cidr) => ({ range: ip.parseCidr(cidr), regionId: dc.id })),
    );
    const BY_ID = new Map(DATACENTERS.map((dc) => [dc.id, dc]));

    /**
     * Look up which region an IP belongs to.
     * Returns null when the IP is missing, malformed or not in the bundled table —
     * callers must then treat the location as unknown.
     * @param {unknown} address
     * @returns {string | null} region id
     */
    function regionIdForIp(address) {
        const value = ip.parseIPv4(address);
        if (value === null) return null;
        const hit = RANGE_INDEX.find((entry) => ip.cidrContains(entry.range, value));
        return hit ? hit.regionId : null;
    }

    function getRegion(regionId) {
        return BY_ID.get(regionId) || null;
    }

    function isKnownRegion(regionId) {
        return BY_ID.has(regionId);
    }

    /** "Frankfurt, Germany" / "Ashburn, VA, United States" */
    function regionLabel(regionId) {
        const dc = BY_ID.get(regionId);
        return dc ? `${dc.city}, ${dc.countryName}` : 'Unknown location';
    }

    /** Regions grouped by continent, in a stable display order. */
    function groupedRegions() {
        return CONTINENT_ORDER.map((continent) => ({
            continent,
            regions: DATACENTERS.filter((dc) => dc.continent === continent),
        })).filter((group) => group.regions.length > 0);
    }

    /** Emoji flag from a 2-letter country code (purely cosmetic). */
    function flagEmoji(countryCode) {
        if (!/^[A-Z]{2}$/.test(countryCode || '')) return '🌐';
        return String.fromCodePoint(...[...countryCode].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
    }

    const api = { regionIdForIp, getRegion, isKnownRegion, regionLabel, groupedRegions, flagEmoji, CONTINENT_ORDER };
    globalThis.RoGlobe = Object.assign(globalThis.RoGlobe || {}, { regions: api });
    if (typeof module === 'object' && module.exports) module.exports = api;
})();
