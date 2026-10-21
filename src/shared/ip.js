// RoGlobe — IPv4 helpers.
// Pure functions, no browser APIs, no network. Shared by the content script,
// the popup and the Node unit tests.
(() => {
    'use strict';

    /**
     * Parse a dotted IPv4 string ("128.116.5.10") into an unsigned 32-bit number.
     * Returns null for anything that isn't a plain IPv4 address (IPv6, hostnames,
     * ports, leading zeros, out-of-range octets).
     * @param {unknown} text
     * @returns {number | null}
     */
    function parseIPv4(text) {
        if (typeof text !== 'string') return null;
        const parts = text.trim().split('.');
        if (parts.length !== 4) return null;
        let value = 0;
        for (const part of parts) {
            if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
            const octet = Number(part);
            if (octet > 255) return null;
            value = value * 256 + octet;
        }
        return value;
    }

    /**
     * Parse "a.b.c.d/len" into { base, mask } with the base already masked.
     * @param {string} cidr
     * @returns {{ base: number, prefix: number } | null}
     */
    function parseCidr(cidr) {
        if (typeof cidr !== 'string') return null;
        const [address, lengthText, extra] = cidr.split('/');
        if (extra !== undefined || !/^\d{1,2}$/.test(lengthText || '')) return null;
        const prefix = Number(lengthText);
        const ip = parseIPv4(address);
        if (ip === null || prefix > 32) return null;
        const size = 2 ** (32 - prefix);
        return { base: ip - (ip % size), prefix };
    }

    /**
     * True when `ip` (number) is inside the parsed CIDR range.
     * Uses arithmetic instead of bitwise ops because JS bitwise ops are signed 32-bit.
     */
    function cidrContains(range, ip) {
        const size = 2 ** (32 - range.prefix);
        return ip >= range.base && ip < range.base + size;
    }

    const api = { parseIPv4, parseCidr, cidrContains };
    globalThis.RoGlobe = Object.assign(globalThis.RoGlobe || {}, { ip: api });
    if (typeof module === 'object' && module.exports) module.exports = api;
})();
