// Optional end-to-end check in a real Chromium with the unpacked extension loaded.
// Roblox itself is NOT contacted: every request is answered by a local mock, and any
// request to another host is blocked and reported.
//
// Not part of `npm test` (needs Playwright, which RoGlobe does not depend on):
//   npm i -g playwright && NODE_PATH="$(npm root -g)" node tests/e2e/browser-check.js
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXT = path.resolve(__dirname, '..', '..');
const OUT = process.env.ROGLOBE_SHOTS || path.join(os.tmpdir(), 'roglobe-shots');
const PLACE = '1818';
const sid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Unpacked extension id = first 32 hex chars of sha256(absolute path), mapped 0-f -> a-p.
const EXT_ID = crypto.createHash('sha256').update(EXT).digest('hex').slice(0, 32).replace(/./g, (c) => String.fromCharCode(97 + parseInt(c, 16)));

// 30 servers: every 7th in Frankfurt, every 5th in Tokyo, every 6th unknown IP, rest Ashburn.
const SERVERS = Array.from({ length: 30 }, (_, i) => ({
    id: sid(i),
    ip: i % 7 === 0 ? `128.116.5.${i}` : i % 5 === 0 ? `128.116.55.${i}` : i % 6 === 0 ? `128.116.84.${i}` : `128.116.53.${i}`,
}));
const mock = { rateLimitAfter: Infinity, joins: 0, lists: 0 };

const PAGE_HTML = (dark) => `<!doctype html><html><head><meta charset="utf-8"><meta name="csrf-token" data-token="tok-1"><title>Test game</title>
<style>body{font-family:sans-serif;margin:0;padding:24px;background:${dark ? '#111214' : '#f7f7f8'};color:${dark ? '#eee' : '#111'}} #content{max-width:900px;margin:auto}</style></head>
<body class="${dark ? 'dark-theme' : 'light-theme'}"><div id="content"><h1>Mock game page</h1><div id="game-instances">
<div id="running-game-instances-container"><h3>Servers</h3><p>(Roblox's own list would be here)</p></div></div></div>
<script>window.__joins=[];window.Roblox={GameLauncher:{joinGameInstance:(p,g)=>window.__joins.push([p,g])}};</script></body></html>`;

async function main() {
    fs.mkdirSync(OUT, { recursive: true });
    const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roglobe-profile-'));
    const context = await chromium.launchPersistentContext(userDir, {
        channel: 'chromium',
        headless: true,
        viewport: { width: 1000, height: 760 },
        args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });

    const seenHosts = new Set();
    const unexpected = [];
    let dark = false;
    await context.route('**/*', async (route) => {
        const req = route.request();
        const u = new URL(req.url());
        if (u.protocol === 'chrome-extension:' || u.protocol === 'data:') return route.continue();
        seenHosts.add(u.hostname);
        const json = (body, status = 200) =>
            route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': 'https://www.roblox.com', 'access-control-allow-credentials': 'true' }, body: JSON.stringify(body) });

        if (req.method() === 'OPTIONS') {
            return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': 'https://www.roblox.com', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type,x-csrf-token,accept', 'access-control-allow-methods': 'GET,POST' } });
        }
        if (u.hostname === 'www.roblox.com' && u.pathname.startsWith(`/games/${PLACE}`)) {
            return route.fulfill({ status: 200, contentType: 'text/html', body: PAGE_HTML(dark) });
        }
        if (u.hostname === 'games.roblox.com' && u.pathname.endsWith('/servers/Public')) {
            mock.lists += 1;
            const start = Number(u.searchParams.get('cursor') || 0);
            const size = u.pathname.startsWith('/v2/') ? 30 : 10; // small pages to exercise pagination
            const slice = SERVERS.slice(start, start + size);
            return json({ nextPageCursor: start + size < SERVERS.length ? String(start + size) : null, data: slice.map((s, i) => ({ id: s.id, playing: (i * 3) % 20, maxPlayers: 20, ping: 40, fps: 60 })) });
        }
        if (u.hostname === 'gamejoin.roblox.com' && u.pathname === '/v1/join-game-instance') {
            assert.equal(req.headers()['x-csrf-token'], 'tok-1', 'CSRF token from page meta is sent');
            mock.joins += 1;
            if (mock.joins > mock.rateLimitAfter) return json({ errors: [] }, 429);
            const { gameId } = JSON.parse(req.postData());
            const s = SERVERS.find((x) => x.id === gameId);
            return json({ status: 2, joinScript: { UdmuxEndpoints: [{ Address: s.ip, Port: 1 }] } });
        }
        unexpected.push(req.url());
        return route.abort();
    });

    const page = await context.newPage();
    const results = [];
    const check = async (name, fn) => {
        try {
            await fn();
            results.push(`PASS  ${name}`);
        } catch (e) {
            results.push(`FAIL  ${name}\n      ${e.message.split('\n')[0]}`);
        }
    };

    await page.goto(`https://www.roblox.com/games/${PLACE}/Mock-Game`);
    const panel = page.locator('section.roglobe');

    await check('panel mounts directly above the server list', async () => {
        await panel.waitFor({ timeout: 5000 });
        const nextId = await panel.evaluate((el) => el.nextElementSibling?.id);
        assert.equal(nextId, 'running-game-instances-container');
    });
    await check('filter off by default: no Roblox API requests, compact bar', async () => {
        await page.waitForTimeout(500);
        assert.equal(await panel.locator('.rg-pill').textContent(), 'Filter off');
        assert.equal(mock.lists + mock.joins, 0);
        assert.equal(await panel.getByRole('button', { name: 'Find servers' }).isVisible(), false);
    });
    await page.screenshot({ path: path.join(OUT, '1-off.png'), clip: await clip(panel) });

    await check('keyboard: modes are reachable radio buttons', async () => {
        await panel.getByRole('radio', { name: 'Off' }).focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await panel.getByRole('radio', { name: 'Closest to me' }).isChecked(), true);
    });

    await check('closest mode: one list request, zero location lookups', async () => {
        await panel.getByRole('button', { name: 'Show closest servers' }).click();
        await panel.locator('.rg-server').first().waitFor();
        assert.equal(await panel.locator('.rg-server').count(), 10);
        assert.equal(mock.joins, 0);
        assert.equal(mock.lists, 1);
    });

    // Choose a region in the popup, as a user would.
    const popup = await context.newPage();
    await check('popup: shows current filter and saves a region', async () => {
        await popup.goto(`chrome-extension://${EXT_ID}/src/popup/popup.html`);
        assert.equal(await popup.locator('#current').textContent(), 'Closest to me');
        await popup.getByLabel(/Pick a region/).check();
        await popup.locator('#region').selectOption('de-frankfurt');
        assert.match(await popup.locator('#current').textContent(), /Frankfurt, Germany/);
    });
    await popup.screenshot({ path: path.join(OUT, '2-popup.png'), fullPage: true });
    await popup.close();

    await check('panel updates live from popup change', async () => {
        await page.bringToFront();
        await page.waitForFunction(() => document.querySelector('.roglobe .rg-pill')?.textContent.includes('Frankfurt'));
    });

    await check('region search: paginates, filters, labels unknowns, never guesses', async () => {
        await panel.getByRole('button', { name: 'Find servers' }).click();
        await page.waitForFunction(() => !document.querySelector('.roglobe .rg-spinner'), null, { timeout: 30000 });
        const expected = SERVERS.filter((s) => s.ip.startsWith('128.116.5.')).length; // 5
        assert.equal(await panel.locator('.rg-server').count(), expected);
        const status = await panel.locator('.rg-status').textContent();
        assert.match(status, /Checked 30 servers · 5 in Frankfurt, Germany · 4 unknown location/);
        assert.match(status, /whole server list/);
        assert.equal(mock.lists, 1 + 3); // 1 closest + 3 pages of 10
        assert.equal(mock.joins, 30);
    });
    await page.screenshot({ path: path.join(OUT, '3-results-light.png'), clip: await clip(panel) });

    await check('join: calls Roblox.GameLauncher.joinGameInstance with place + server id', async () => {
        await panel.locator('.rg-btn-join').first().click();
        await page.waitForFunction(() => window.__joins.length === 1);
        assert.deepEqual(await page.evaluate(() => window.__joins[0]), [1818, sid(0)]);
    });

    await check('persistence: selection survives a reload', async () => {
        dark = true;
        await page.reload();
        await page.waitForFunction(() => document.querySelector('.roglobe .rg-pill')?.textContent.includes('Frankfurt'));
    });

    await check('rate limit: stops on first 429 and offers retry, no automatic retries', async () => {
        mock.joins = 0;
        mock.rateLimitAfter = 4;
        await panel.getByRole('button', { name: 'Find servers' }).click();
        await page.waitForFunction(() => document.querySelector('.roglobe .rg-status-error'), null, { timeout: 15000 });
        assert.match(await panel.locator('.rg-status').textContent(), /Paused: Roblox is rate limiting/);
        await page.waitForTimeout(1000);
        assert.equal(mock.joins, 5);
        assert.equal(await panel.getByRole('button', { name: 'Try again' }).isVisible(), true);
    });
    await page.screenshot({ path: path.join(OUT, '4-ratelimited-dark.png'), clip: await clip(panel) });

    await check('switching filter off clears results and stops requests', async () => {
        const before = mock.joins + mock.lists;
        await panel.getByRole('radio', { name: 'Off' }).check({ force: true });
        assert.equal(await panel.locator('.rg-server').count(), 0);
        await page.waitForTimeout(600);
        assert.equal(mock.joins + mock.lists, before);
    });

    await check('only Roblox hosts were contacted', async () => {
        assert.deepEqual(unexpected, []);
        assert.deepEqual([...seenHosts].sort(), ['gamejoin.roblox.com', 'games.roblox.com', 'www.roblox.com']);
    });

    await context.close();
    console.log(results.join('\n'));
    console.log(`\nScreenshots: ${OUT}`);
    if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
}

async function clip(locator) {
    const b = await locator.boundingBox();
    return { x: Math.max(0, b.x - 12), y: Math.max(0, b.y - 12), width: b.width + 24, height: b.height + 24 };
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
