// RoGlobe — toolbar popup. Reads and writes the same local settings as the on-page panel.
// Makes no network requests (the popup's CSP also forbids them: connect-src 'none').
(() => {
    'use strict';

    const { regions, settings: store, datacenters } = globalThis.RoGlobe;
    const currentEl = document.getElementById('current');
    const select = document.getElementById('region');
    const regionField = select.closest('.rg-region');
    const modeInputs = [...document.querySelectorAll('input[name="mode"]')];

    select.append(new Option('Choose a region…', ''));
    for (const group of regions.groupedRegions()) {
        const og = document.createElement('optgroup');
        og.label = group.continent;
        for (const r of group.regions) og.append(new Option(`${regions.flagEmoji(r.country)} ${regions.regionLabel(r.id)}`, r.id));
        select.append(og);
    }
    document.getElementById('data-version').textContent = `IP-range data: community list, ${datacenters.DATA_VERSION}. Locations are approximate.`;

    let current = { ...store.DEFAULTS };

    function describe({ mode, regionId }) {
        if (mode === 'off') return 'Off';
        if (mode === 'closest') return 'Closest to me';
        if (!regionId) return 'Choose a region below';
        return `${regions.flagEmoji(regions.getRegion(regionId).country)} ${regions.regionLabel(regionId)}`;
    }

    function render() {
        for (const input of modeInputs) input.checked = input.value === current.mode;
        select.value = current.regionId || '';
        regionField.hidden = current.mode !== 'region';
        currentEl.textContent = describe(current);
    }

    async function save(patch) {
        current = await store.save({ ...current, ...patch });
        render();
        if (patch.mode === 'region' && !current.regionId) select.focus();
    }

    for (const input of modeInputs) input.addEventListener('change', () => save({ mode: input.value }));
    select.addEventListener('change', () => save({ regionId: select.value || null }));

    store.onChange((next) => {
        current = next;
        render();
    });
    store.load().then((loaded) => {
        current = loaded;
        render();
    });
})();
