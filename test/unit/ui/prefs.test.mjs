import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_PREFS, STORAGE_KEY, loadPrefs, parsePrefs, savePrefs } from '../../../public/js/ui/prefs.js';

describe('parsePrefs', () => {
  test('defaults for nothing stored, invalid JSON, or the wrong shape', () => {
    assert.deepEqual(parsePrefs(null), DEFAULT_PREFS);
    assert.deepEqual(parsePrefs(undefined), DEFAULT_PREFS);
    assert.deepEqual(parsePrefs('{not json'), DEFAULT_PREFS);
    assert.deepEqual(parsePrefs('[1,2]'), DEFAULT_PREFS);
    assert.deepEqual(parsePrefs('"text"'), DEFAULT_PREFS);
  });

  test('keeps valid fields and drops invalid ones', () => {
    const prefs = parsePrefs(JSON.stringify({ sound: true, volume: 0.3, theme: 'dark', speed: 4, tab: 'tasks', timeMode: 'night' }));
    assert.equal(prefs.sound, true);
    assert.equal(prefs.volume, 0.3);
    assert.equal(prefs.theme, 'dark');
    assert.equal(prefs.speed, 4);
    assert.equal(prefs.tab, 'tasks');
    assert.equal(prefs.timeMode, 'night');
    const bad = parsePrefs(JSON.stringify({ sound: 'yes', volume: 7, theme: 'purple', speed: 3, tab: 'secrets', motion: null, extra: 1 }));
    assert.deepEqual(bad, DEFAULT_PREFS);
  });

  test('the director camera and the side panels follow the situation by default', () => {
    assert.equal(DEFAULT_PREFS.directorCam, 'auto');
    assert.equal(DEFAULT_PREFS.panels, 'auto');
    const prefs = parsePrefs(JSON.stringify({ directorCam: 'off', panels: 'hidden' }));
    assert.equal(prefs.directorCam, 'off');
    assert.equal(prefs.panels, 'hidden');
    const bad = parsePrefs(JSON.stringify({ directorCam: true, panels: 'gone' }));
    assert.equal(bad.directorCam, 'auto');
    assert.equal(bad.panels, 'auto');
  });

  test('place names fit on the buildings by default', () => {
    assert.equal(DEFAULT_PREFS.placeNames, 'auto');
    assert.equal(parsePrefs(JSON.stringify({ placeNames: 'off' })).placeNames, 'off');
    assert.equal(parsePrefs(JSON.stringify({ placeNames: true })).placeNames, 'auto');
  });

  test('ignores keys inherited from the prototype', () => {
    const prefs = parsePrefs('{"__proto__": {"sound": true}}');
    assert.equal(prefs.sound, false);
  });
});

describe('loadPrefs / savePrefs', () => {
  test('round trip through a storage', () => {
    const data = new Map();
    const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
    savePrefs({ ...DEFAULT_PREFS, sound: true, speed: 2 }, storage);
    assert.ok(data.has(STORAGE_KEY));
    const loaded = loadPrefs(storage);
    assert.equal(loaded.sound, true);
    assert.equal(loaded.speed, 2);
  });

  test('storage that throws never breaks the app', () => {
    const broken = {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('QuotaExceededError');
      },
    };
    assert.deepEqual(loadPrefs(broken), DEFAULT_PREFS);
    assert.doesNotThrow(() => savePrefs(DEFAULT_PREFS, broken));
    assert.deepEqual(loadPrefs(null), DEFAULT_PREFS);
  });
});
