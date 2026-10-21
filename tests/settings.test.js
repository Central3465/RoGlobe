const test = require('node:test');
const assert = require('node:assert/strict');
const settings = require('../src/shared/settings.js');

function fakeStorage(initial = {}) {
    const data = { ...initial };
    return {
        data,
        async get(key) {
            return key in data ? { [key]: data[key] } : {};
        },
        async set(obj) {
            Object.assign(data, obj);
        },
    };
}

test('sanitize falls back to safe defaults', () => {
    assert.deepEqual(settings.sanitize(undefined), { mode: 'off', regionId: null });
    assert.deepEqual(settings.sanitize('garbage'), { mode: 'off', regionId: null });
    assert.deepEqual(settings.sanitize({ mode: 'evil', regionId: 'de-frankfurt' }), { mode: 'off', regionId: 'de-frankfurt' });
    assert.deepEqual(settings.sanitize({ mode: 'region', regionId: 'atlantis' }), { mode: 'region', regionId: null });
    assert.deepEqual(settings.sanitize({ mode: 'closest', regionId: null, extra: 'dropped' }), { mode: 'closest', regionId: null });
});

test('save then load round-trips (persistence)', async () => {
    const storage = fakeStorage();
    await settings.save({ mode: 'region', regionId: 'jp-tokyo' }, storage);
    assert.deepEqual(storage.data[settings.STORAGE_KEY], { mode: 'region', regionId: 'jp-tokyo' });
    assert.deepEqual(await settings.load(storage), { mode: 'region', regionId: 'jp-tokyo' });
});

test('load with nothing stored or a broken storage returns defaults', async () => {
    assert.deepEqual(await settings.load(fakeStorage()), { mode: 'off', regionId: null });
    const broken = { get: async () => { throw new Error('boom'); } };
    assert.deepEqual(await settings.load(broken), { mode: 'off', regionId: null });
});
