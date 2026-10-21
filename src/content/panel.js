// RoGlobe — the on-page panel shown above Roblox's server list.
//
// SECURITY: all text is inserted with textContent / createElement, never HTML-string APIs,
// so nothing coming from Roblox's API can be interpreted as HTML or script.
(() => {
    'use strict';

    const { regions, settings: settingsStore, finder, datacenters } = globalThis.RoGlobe;

    const MODE_LABELS = { off: 'Off', closest: 'Closest to me', region: 'Pick a region' };
    let uid = 0;

    /** Tiny DOM helper: h('div', { class: 'x', text: 'hi' }, child, ...) */
    function h(tag, props = {}, ...children) {
        const el = document.createElement(tag);
        for (const [key, value] of Object.entries(props)) {
            if (value === undefined || value === null || value === false) continue;
            if (key === 'text') el.textContent = value;
            else if (key === 'class') el.className = value;
            else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
            else el.setAttribute(key, value === true ? '' : value);
        }
        for (const child of children) if (child) el.append(child);
        return el;
    }

    function globeIcon() {
        // Built with DOM APIs, not an HTML string. Simple globe: circle, meridian, equator.
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('class', 'rg-logo');
        const paths = ['M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20', 'M2 12h20', 'M12 2c3 3 4.5 6.5 4.5 10S15 19 12 22c-3-3-4.5-6.5-4.5-10S9 5 12 2'];
        for (const d of paths) {
            const p = document.createElementNS(NS, 'path');
            p.setAttribute('d', d);
            svg.append(p);
        }
        return svg;
    }

    /**
     * @param {{ placeId: string, api: object, join: (serverId: string) => Promise<boolean> }} deps
     */
    function createPanel({ placeId, api, join }) {
        const id = `roglobe-${++uid}`;
        const locationCache = new Map(); // serverId -> regionId | null, for this tab only
        let current = { ...settingsStore.DEFAULTS };
        let search = null; // active region search (resumable)
        let abort = null;

        // ---------- structure ----------
        const pill = h('span', { class: 'rg-pill', 'aria-live': 'polite' });
        const header = h(
            'div',
            { class: 'rg-header' },
            h('div', { class: 'rg-brand' }, globeIcon(), h('div', {}, h('h2', { class: 'rg-title', text: 'RoGlobe' }), h('p', { class: 'rg-tagline', text: 'Your Roblox. Your region.' }))),
            pill,
        );

        const modeGroup = h('div', { class: 'rg-modes', role: 'radiogroup', 'aria-label': 'Server filter mode' });
        const modeInputs = {};
        for (const mode of settingsStore.MODES) {
            const input = h('input', { type: 'radio', name: `${id}-mode`, value: mode, id: `${id}-mode-${mode}`, onchange: () => update({ mode }) });
            modeInputs[mode] = input;
            modeGroup.append(h('label', { class: 'rg-mode', for: input.id }, input, h('span', { text: MODE_LABELS[mode] })));
        }

        const select = h('select', { id: `${id}-region`, class: 'rg-select', onchange: () => update({ regionId: select.value || null }) });
        select.append(h('option', { value: '', text: 'Choose a region…' }));
        for (const group of regions.groupedRegions()) {
            const og = h('optgroup', { label: group.continent });
            for (const r of group.regions) og.append(h('option', { value: r.id, text: `${regions.flagEmoji(r.country)} ${regions.regionLabel(r.id)}` }));
            select.append(og);
        }
        const regionField = h('div', { class: 'rg-field' }, h('label', { for: select.id, class: 'rg-label', text: 'Region' }), select);

        const findButton = h('button', { type: 'button', class: 'rg-btn rg-btn-primary', onclick: () => startSearch(false) });
        const cancelButton = h('button', { type: 'button', class: 'rg-btn', text: 'Stop', hidden: true, onclick: () => abort?.abort() });
        const controls = h('div', { class: 'rg-controls' }, modeGroup, regionField, h('div', { class: 'rg-actions' }, findButton, cancelButton));

        const status = h('div', { class: 'rg-status', role: 'status', 'aria-live': 'polite' });
        const list = h('ul', { class: 'rg-results', 'aria-label': 'Servers found by RoGlobe' });
        const moreButton = h('button', { type: 'button', class: 'rg-btn rg-btn-ghost', text: 'Check 100 more servers', hidden: true, onclick: () => startSearch(true) });
        const note = h('p', {
            class: 'rg-note',
            text: `Locations are approximate: matched from server IP ranges in a community list (${datacenters.DATA_VERSION}), not official Roblox data. Servers we can't match are counted as unknown, never guessed.`,
        });
        const body = h('div', { class: 'rg-body' }, controls, status, list, h('div', { class: 'rg-footer' }, moreButton), note);

        const root = h('section', { class: 'roglobe', id, 'aria-label': 'RoGlobe region finder' }, header, body);
        if (document.body?.classList.contains('dark-theme')) root.classList.add('rg-dark');

        // ---------- rendering ----------
        function render() {
            modeInputs[current.mode].checked = true;
            select.value = current.regionId || '';
            regionField.hidden = current.mode !== 'region';
            controls.classList.toggle('rg-compact', current.mode === 'off');
            findButton.hidden = current.mode === 'off';
            findButton.disabled = current.mode === 'region' && !current.regionId;
            findButton.textContent = current.mode === 'closest' ? 'Show closest servers' : 'Find servers';

            pill.textContent =
                current.mode === 'off'
                    ? 'Filter off'
                    : current.mode === 'closest'
                      ? 'Closest to me'
                      : current.regionId
                        ? `${regions.flagEmoji(regions.getRegion(current.regionId).country)} ${regions.regionLabel(current.regionId)}`
                        : 'No region chosen';
            pill.classList.toggle('rg-pill-on', current.mode !== 'off');
            root.classList.toggle('rg-off', current.mode === 'off');
        }

        function setStatus(kind, text) {
            status.className = `rg-status rg-status-${kind}`;
            status.replaceChildren();
            if (kind === 'loading') status.append(h('span', { class: 'rg-spinner', 'aria-hidden': 'true' }));
            if (text) status.append(h('span', { text }));
        }

        function clearResults() {
            list.replaceChildren();
            moreButton.hidden = true;
            setStatus('idle', '');
        }

        function serverRow(server, { showRegion }) {
            const regionText = server.regionId ? regions.regionLabel(server.regionId) : 'Location unknown';
            const players = server.playing !== null && server.maxPlayers ? `${server.playing}/${server.maxPlayers} players` : '';
            const joinBtn = h('button', {
                type: 'button',
                class: 'rg-btn rg-btn-join',
                text: 'Join',
                'aria-label': `Join server${server.regionId ? ' in ' + regionText : ''}${players ? ', ' + players : ''}`,
            });
            joinBtn.addEventListener('click', async () => {
                joinBtn.disabled = true;
                const ok = await join(server.id);
                joinBtn.disabled = false;
                if (!ok) setStatus('error', "Couldn't start Roblox's launcher from this page. Try reloading the page.");
            });
            const fill = server.maxPlayers ? Math.min(100, Math.round((100 * (server.playing || 0)) / server.maxPlayers)) : 0;
            const barFill = h('span');
            barFill.style.width = `${fill}%`; // CSSOM, not a style attribute, so Roblox's CSP can't block it
            return h(
                'li',
                { class: 'rg-server' },
                h(
                    'div',
                    { class: 'rg-server-main' },
                    showRegion || server.regionId
                        ? h('span', { class: `rg-loc${server.regionId ? '' : ' rg-loc-unknown'}`, text: `${server.regionId ? regions.flagEmoji(regions.getRegion(server.regionId).country) + ' ' : ''}${regionText}${server.regionId ? ' (approx.)' : ''}` })
                        : null,
                    h('span', { class: 'rg-players', text: players }),
                    h('span', { class: 'rg-bar', 'aria-hidden': 'true' }, barFill),
                ),
                joinBtn,
            );
        }

        function renderRegionResult(snap) {
            list.replaceChildren(...snap.matches.map((s) => serverRow(s, { showRegion: true })));
            const label = regions.regionLabel(snap.regionId);
            const counts = `Checked ${snap.checked} server${snap.checked === 1 ? '' : 's'} · ${snap.matches.length} in ${label} · ${snap.unknown} unknown location`;
            moreButton.hidden = !snap.canContinue || snap.stopReason === 'running';

            if (snap.stopReason === 'running') return setStatus('loading', `${counts}…`);
            if (snap.error) {
                const prefix = snap.error.kind === 'rate-limited' ? 'Paused: ' : 'Stopped: ';
                moreButton.hidden = snap.error.kind === 'signed-out' || !snap.canContinue;
                moreButton.textContent = 'Try again';
                return setStatus('error', `${prefix}${snap.error.message} (${counts})`);
            }
            moreButton.textContent = 'Check 100 more servers';
            if (snap.stopReason === 'cancelled') return setStatus('idle', `Stopped. ${counts}`);
            if (snap.matches.length === 0) {
                const where = snap.stopReason === 'end' ? 'No servers found there in the whole list.' : 'None found yet.';
                return setStatus('empty', `${where} ${counts}`);
            }
            if (snap.stopReason === 'end') return setStatus('done', `${counts}. That's the whole server list.`);
            return setStatus('done', counts);
        }

        // ---------- actions ----------
        function setBusy(busy) {
            findButton.disabled = busy || (current.mode === 'region' && !current.regionId);
            cancelButton.hidden = !busy;
            moreButton.disabled = busy;
            for (const input of Object.values(modeInputs)) input.disabled = busy;
            select.disabled = busy;
        }

        async function startSearch(continueExisting) {
            if (abort) return;
            abort = new AbortController();
            setBusy(true);
            try {
                if (current.mode === 'closest') {
                    list.replaceChildren();
                    setStatus('loading', 'Asking Roblox for the lowest-latency servers…');
                    const result = await finder.findClosestServers({ api, placeId, locationCache, signal: abort.signal });
                    if (result.cancelled) return setStatus('idle', 'Stopped.');
                    if (result.error) return setStatus('error', result.error.message);
                    if (!result.servers.length) return setStatus('empty', 'No open public servers right now.');
                    list.replaceChildren(...result.servers.map((s) => serverRow(s, { showRegion: false })));
                    setStatus('done', `Ordered by Roblox's own latency estimate for you. No location lookups were made.`);
                } else if (current.mode === 'region' && current.regionId) {
                    if (!continueExisting || !search || search.regionId !== current.regionId) {
                        search = finder.createRegionSearch({ api, placeId, regionId: current.regionId, locationCache });
                        list.replaceChildren();
                    }
                    setStatus('loading', 'Checking server locations…');
                    const snap = await search.run({ signal: abort.signal, onProgress: renderRegionResult });
                    renderRegionResult(snap);
                }
            } finally {
                abort = null;
                setBusy(false);
            }
        }

        async function update(patch) {
            abort?.abort();
            const before = current;
            current = await settingsStore.save({ ...current, ...patch });
            if (before.mode !== current.mode || before.regionId !== current.regionId) {
                search = null;
                clearResults();
            }
            render();
        }

        // ---------- init ----------
        settingsStore.load().then((loaded) => {
            current = loaded;
            render();
        });
        settingsStore.onChange((next) => {
            if (next.mode === current.mode && next.regionId === current.regionId) return;
            abort?.abort();
            current = next;
            search = null;
            clearResults();
            render();
        });
        render();

        return root;
    }

    globalThis.RoGlobe = Object.assign(globalThis.RoGlobe || {}, { panel: { createPanel } });
})();
