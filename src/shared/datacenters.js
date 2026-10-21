// RoGlobe — bundled Roblox datacenter IP ranges.
//
// SOURCE: community list "Maneetbal/roblox-server-locations",
//   https://github.com/Maneetbal/roblox-server-locations (robloxserveriplist.txt,
//   "Last updated: 2026-10-18"). Only facts (range -> city) are reproduced.
//
// WHAT WAS KEPT: /24 ranges inside 128.116.0.0/17, the block registered to
// Roblox (AS22697 ROBLOX-PRODUCTION).
// WHAT WAS LEFT OUT: ranges marked "(AWS)", ranges outside Roblox's own block,
// ranges marked "Not sure", and the "(Decommissioned?)" section.
//
// RELIABILITY: best effort. These are community observations, not data
// published by Roblox, and Roblox can move ranges at any time. A server whose
// IP is not listed here is shown as "Unknown location" — never guessed.
//
// To update: edit this array, then run `npm test` (tests check the format,
// that every range is inside 128.116.0.0/17 and that no two ranges overlap).
(() => {
    'use strict';

    const DATA_VERSION = '2026-10-18';
    const SOURCE_URL = 'https://github.com/Maneetbal/roblox-server-locations';

    /** @type {{ id: string, city: string, country: string, countryName: string, continent: string, ranges: string[] }[]} */
    const DATACENTERS = [
        // North America
        { id: 'us-ashburn', city: 'Ashburn, VA', country: 'US', countryName: 'United States', continent: 'North America', ranges: ['128.116.53.0/24', '128.116.56.0/24', '128.116.102.0/24'] },
        { id: 'us-atlanta', city: 'Atlanta, GA', country: 'US', countryName: 'United States', continent: 'North America', ranges: ['128.116.2.0/24'] },
        { id: 'us-chicago', city: 'Chicago, IL', country: 'US', countryName: 'United States', continent: 'North America', ranges: ['128.116.48.0/24'] },
        { id: 'us-dallas', city: 'Dallas, TX', country: 'US', countryName: 'United States', continent: 'North America', ranges: ['128.116.14.0/24', '128.116.95.0/24'] },
        { id: 'us-losangeles', city: 'Los Angeles, CA', country: 'US', countryName: 'United States', continent: 'North America', ranges: ['128.116.1.0/24', '128.116.63.0/24', '128.116.116.0/24'] },
        { id: 'us-miami', city: 'Miami, FL', country: 'US', countryName: 'United States', continent: 'North America', ranges: ['128.116.45.0/24', '128.116.127.0/24'] },
        { id: 'us-newyork', city: 'New York, NY', country: 'US', countryName: 'United States', continent: 'North America', ranges: ['128.116.32.0/24'] },
        { id: 'us-sanjose', city: 'San Jose, CA', country: 'US', countryName: 'United States', continent: 'North America', ranges: ['128.116.67.0/24', '128.116.117.0/24'] },
        { id: 'us-seattle', city: 'Seattle, WA', country: 'US', countryName: 'United States', continent: 'North America', ranges: ['128.116.115.0/24'] },
        // South America
        { id: 'br-saopaulo', city: 'São Paulo', country: 'BR', countryName: 'Brazil', continent: 'South America', ranges: ['128.116.86.0/24'] },
        // Europe
        { id: 'gb-london', city: 'London', country: 'GB', countryName: 'United Kingdom', continent: 'Europe', ranges: ['128.116.31.0/24'] },
        { id: 'nl-amsterdam', city: 'Amsterdam', country: 'NL', countryName: 'Netherlands', continent: 'Europe', ranges: ['128.116.21.0/24'] },
        { id: 'fr-paris', city: 'Paris', country: 'FR', countryName: 'France', continent: 'Europe', ranges: ['128.116.13.0/24'] },
        { id: 'de-frankfurt', city: 'Frankfurt', country: 'DE', countryName: 'Germany', continent: 'Europe', ranges: ['128.116.5.0/24', '128.116.44.0/24'] },
        // Asia
        { id: 'in-mumbai', city: 'Mumbai', country: 'IN', countryName: 'India', continent: 'Asia', ranges: ['128.116.47.0/24'] },
        { id: 'sg-singapore', city: 'Singapore', country: 'SG', countryName: 'Singapore', continent: 'Asia', ranges: ['128.116.46.0/24', '128.116.50.0/24', '128.116.54.0/24', '128.116.97.0/24'] },
        { id: 'jp-tokyo', city: 'Tokyo', country: 'JP', countryName: 'Japan', continent: 'Asia', ranges: ['128.116.55.0/24', '128.116.120.0/24'] },
        // Oceania
        { id: 'au-sydney', city: 'Sydney', country: 'AU', countryName: 'Australia', continent: 'Oceania', ranges: ['128.116.51.0/24'] },
    ];

    const api = { DATA_VERSION, SOURCE_URL, DATACENTERS };
    globalThis.RoGlobe = Object.assign(globalThis.RoGlobe || {}, { datacenters: api });
    if (typeof module === 'object' && module.exports) module.exports = api;
})();
