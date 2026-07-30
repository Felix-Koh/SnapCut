const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  SettingsStore,
  defaultSettings,
  sanitizeSettings,
} = require('../src/main/settings-store');

test('platform defaults mirror familiar screenshot shortcuts', () => {
  assert.equal(defaultSettings('darwin').hotkey, 'Control+Command+A');
  assert.equal(defaultSettings('win32').hotkey, 'Alt+A');
});

test('sanitizeSettings rejects unknown accelerators and non-booleans', () => {
  assert.deepEqual(
    sanitizeSettings(
      {
        hotkey: 'CommandOrControl+Q',
        launchAtLogin: 'yes',
        showTrayIcon: false,
        showMagnifier: false,
        firstRun: false,
      },
      'win32',
    ),
    {
      hotkey: 'Alt+A',
      launchAtLogin: false,
      showTrayIcon: false,
      showMagnifier: false,
      firstRun: false,
    },
  );
});

test('SettingsStore recovers from malformed JSON and persists atomically', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'snapcut-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'settings.json'), '{not-json');

  const store = new SettingsStore(directory, 'darwin');
  assert.deepEqual(store.load(), defaultSettings('darwin'));
  store.update({ hotkey: 'Command+Shift+A', launchAtLogin: true, showTrayIcon: false });

  const persisted = JSON.parse(fs.readFileSync(path.join(directory, 'settings.json'), 'utf8'));
  assert.equal(persisted.hotkey, 'Command+Shift+A');
  assert.equal(persisted.launchAtLogin, true);
  assert.equal(persisted.showTrayIcon, false);
});
