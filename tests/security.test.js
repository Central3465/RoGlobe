// Static checks of the shipped extension. These guard against regressions; they are
// not a substitute for reading the code (see docs/security-review.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
const SHIPPED = walk(path.join(ROOT, 'src'));
const SHIPPED_CODE = SHIPPED.filter((f) => /\.(js|html|css)$/.test(f));
const read = (f) => fs.readFileSync(f, 'utf8');
const rel = (f) => path.relative(ROOT, f);

test('manifest: MV3, only the storage permission, no host permissions or background', () => {
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.permissions, ['storage']);
    for (const key of ['host_permissions', 'optional_permissions', 'optional_host_permissions', 'background', 'web_accessible_resources', 'externally_connectable', 'declarative_net_request']) {
        assert.equal(manifest[key], undefined, `${key} must not be present`);
    }
});

test('manifest: content scripts only on www.roblox.com game pages', () => {
    for (const cs of manifest.content_scripts) {
        assert.deepEqual(cs.matches, ['https://www.roblox.com/games/*', 'https://www.roblox.com/*/games/*']);
        assert.ok(!cs.all_frames);
    }
    const mainWorld = manifest.content_scripts.filter((cs) => cs.world === 'MAIN');
    assert.equal(mainWorld.length, 1);
    assert.deepEqual(mainWorld[0].js, ['src/content/launcher-main.js']);
});

test('manifest: strict CSP for extension pages', () => {
    const csp = manifest.content_security_policy.extension_pages;
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /connect-src 'none'/);
    assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline|https?:/);
});

test('manifest: every referenced file exists', () => {
    const files = [
        ...Object.values(manifest.icons),
        ...Object.values(manifest.action.default_icon),
        manifest.action.default_popup,
        ...manifest.content_scripts.flatMap((cs) => [...(cs.js || []), ...(cs.css || [])]),
    ];
    for (const f of files) assert.ok(fs.existsSync(path.join(ROOT, f)), `missing ${f}`);
});

test('no dynamic code execution or HTML injection sinks in shipped code', () => {
    const banned = [/\beval\s*\(/, /new\s+Function\s*\(/, /\binnerHTML\b/, /\bouterHTML\b/, /insertAdjacentHTML/, /document\.write/, /\bimport\s*\(/, /importScripts/, /setTimeout\s*\(\s*['"`]/, /setInterval\s*\(\s*['"`]/, /chrome\.scripting/, /\.setAttribute\(\s*['"]on/];
    for (const f of SHIPPED_CODE) {
        const src = read(f);
        for (const re of banned) assert.doesNotMatch(src, re, `${rel(f)} matches ${re}`);
    }
});

test('no remote scripts or styles in extension pages', () => {
    for (const f of SHIPPED.filter((x) => x.endsWith('.html'))) {
        assert.doesNotMatch(read(f), /<script[^>]+src=["']https?:/i, rel(f));
        assert.doesNotMatch(read(f), /<link[^>]+href=["']https?:/i, rel(f));
        assert.doesNotMatch(read(f), /<script>(?!<\/script>)/i, `${rel(f)} has an inline script`);
    }
});

test('network: only roblox-api.js uses fetch, and only Roblox game hosts appear as request URLs', () => {
    for (const f of SHIPPED_CODE) {
        const src = read(f);
        if (!f.endsWith(path.join('content', 'roblox-api.js'))) {
            assert.doesNotMatch(src, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/, `${rel(f)} must not make requests`);
        }
        const hosts = [...src.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());
        // Allowed: the two Roblox API hosts, www.roblox.com (named in comments), the SVG namespace,
        // and the data-source credit link. Actual requests are also locked down by ALLOWED_HOSTS below.
        const allowed = new Set(['games.roblox.com', 'gamejoin.roblox.com', 'www.roblox.com', 'www.w3.org', 'github.com']);
        for (const host of hosts) assert.ok(allowed.has(host), `${rel(f)} references unexpected host ${host}`);
    }
    const apiSrc = read(path.join(ROOT, 'src/content/roblox-api.js'));
    assert.match(apiSrc, /ALLOWED_HOSTS = Object\.freeze\(\['games\.roblox\.com', 'gamejoin\.roblox\.com'\]\)/);
});

test('no credential handling: cookies and storage of tokens are never touched', () => {
    for (const f of SHIPPED_CODE) {
        const src = read(f);
        assert.doesNotMatch(src, /document\.cookie|chrome\.cookies|ROBLOSECURITY/i, rel(f));
        assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB/, rel(f));
    }
    // The only thing ever written to chrome.storage is the settings object.
    const writers = SHIPPED_CODE.filter((f) => /storage\.set\(|chrome\.storage\.(local|sync)\.set/.test(read(f)));
    assert.deepEqual(writers.map(rel), ['src/shared/settings.js']);
    assert.doesNotMatch(read(path.join(ROOT, 'src/shared/settings.js')), /chrome\.storage\.sync/);
});

test('no runtime dependencies', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.devDependencies, undefined);
});
