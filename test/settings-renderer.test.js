const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const settingsScript = fs.readFileSync(
  path.join(__dirname, '../src/renderer/settings.js'),
  'utf8',
);

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function fakeElement() {
  const listeners = new Map();
  return {
    checked: false,
    classList: {
      values: new Set(),
      toggle(name, force) {
        if (force) this.values.add(name);
        else this.values.delete(name);
      },
    },
    disabled: false,
    hidden: false,
    options: [],
    attributes: new Map(),
    style: {},
    textContent: '',
    value: '',
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    dispatch(type) {
      return listeners.get(type)?.({ type, target: this });
    },
    replaceChildren(...children) {
      this.options = children;
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
  };
}

function createHarness({ startCaptureResult = { ok: true } } = {}) {
  const selectors = [
    '#capture-button',
    '#dismiss-error',
    '#error-banner',
    '#error-message',
    '#hero-hotkey',
    '#hotkey-select',
    '#launch-toggle',
    '#magnifier-toggle',
    '#permission-button',
    '#permission-card',
    '#permission-copy',
    '#quit-button',
    '#releases-button',
    '#status-pill',
    '#update-button',
    '#update-detail',
    '#update-progress',
    '#update-progress-bar',
    '#update-status',
    '#version-label',
  ];
  const elements = Object.fromEntries(selectors.map((selector) => [selector, fakeElement()]));
  const requests = [];
  let settingsChanged;

  const initialContext = {
    appName: 'SnapCut',
    version: '1.0.0',
    platform: 'darwin',
    screenPermission: 'granted',
    lastCaptureError: null,
    update: {
      phase: 'idle',
      currentVersion: '1.0.0',
      latestVersion: null,
      progress: 0,
      message: '尚未检查更新',
    },
    settings: {
      hotkey: 'Control+Command+A',
      hotkeyOptions: ['Control+Command+A', 'Command+Shift+A', 'Alt+A'],
      hotkeyRegistered: true,
      launchAtLogin: false,
      showMagnifier: true,
    },
  };
  let actualContext = structuredClone(initialContext);

  const snapcut = {
    getAppContext: async () => structuredClone(actualContext),
    checkForUpdates: async () => structuredClone(actualContext.update),
    downloadAndInstallUpdate: async () => ({ ok: true }),
    onCaptureError: () => {},
    onSettingsChanged: (listener) => {
      settingsChanged = listener;
    },
    onUpdateChanged: () => {},
    openReleases: async () => {},
    openScreenPermission: async () => {},
    quit: async () => {},
    startCapture: async () => structuredClone(startCaptureResult),
    updateSettings: (patch) => {
      const response = deferred();
      requests.push({ patch, response });
      return response.promise;
    },
  };

  const sandbox = {
    document: {
      createElement: () => fakeElement(),
      querySelector: (selector) => elements[selector],
    },
    navigator: { platform: 'MacIntel' },
    window: { snapcut },
  };
  vm.runInNewContext(settingsScript, sandbox, { filename: 'settings.js' });

  return {
    elements,
    initialContext,
    requests,
    sendContext(nextContext) {
      actualContext = structuredClone(nextContext);
      settingsChanged(structuredClone(nextContext));
    },
    setActualContext(nextContext) {
      actualContext = structuredClone(nextContext);
    },
  };
}

function flushTasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('settings renderer serializes rapid changes and preserves them across focus refreshes', async () => {
  const harness = createHarness();
  await flushTasks();

  harness.elements['#launch-toggle'].checked = true;
  harness.elements['#launch-toggle'].dispatch('change');
  harness.elements['#magnifier-toggle'].checked = false;
  harness.elements['#magnifier-toggle'].dispatch('change');

  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].patch.launchAtLogin, true);
  assert.deepEqual(Object.keys(harness.requests[0].patch), ['launchAtLogin']);
  assert.equal(harness.elements['#launch-toggle'].checked, true);
  assert.equal(harness.elements['#magnifier-toggle'].checked, false);

  harness.sendContext({
    ...harness.initialContext,
    screenPermission: 'denied',
  });
  assert.equal(harness.elements['#launch-toggle'].checked, true);
  assert.equal(harness.elements['#magnifier-toggle'].checked, false);
  assert.match(harness.elements['#permission-copy'].textContent, /首次截图需要授权/);

  const afterLaunch = {
    ...harness.initialContext.settings,
    launchAtLogin: true,
  };
  harness.requests[0].response.resolve({ ok: true, settings: afterLaunch });
  await flushTasks();

  assert.equal(harness.requests.length, 2);
  assert.equal(harness.requests[1].patch.showMagnifier, false);
  assert.deepEqual(Object.keys(harness.requests[1].patch), ['showMagnifier']);

  const finalSettings = { ...afterLaunch, showMagnifier: false };
  harness.setActualContext({ ...harness.initialContext, settings: finalSettings });
  harness.requests[1].response.resolve({ ok: true, settings: finalSettings });
  await flushTasks();

  assert.equal(harness.elements['#launch-toggle'].checked, true);
  assert.equal(harness.elements['#magnifier-toggle'].checked, false);
});

test('settings renderer restores the returned main-process state after a rejected change', async () => {
  const harness = createHarness();
  await flushTasks();

  harness.elements['#hotkey-select'].value = 'Command+Shift+A';
  harness.elements['#hotkey-select'].dispatch('change');
  assert.equal(harness.elements['#hotkey-select'].value, 'Command+Shift+A');

  harness.requests[0].response.resolve({
    ok: false,
    error: '这个快捷键已被其他应用占用，请选择另一个。',
    settings: harness.initialContext.settings,
  });
  await flushTasks();

  assert.equal(harness.elements['#hotkey-select'].value, 'Control+Command+A');
  assert.equal(harness.elements['#error-banner'].hidden, false);
  assert.match(harness.elements['#error-message'].textContent, /已被其他应用占用/);
});

test('settings status pill is announced as a polite live status', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/settings.html'), 'utf8');
  const status = html.match(/<span[\s\S]*?id="status-pill"[\s\S]*?>准备中<\/span>/)?.[0];

  assert.ok(status);
  assert.match(status, /role="status"/);
  assert.match(status, /aria-live="polite"/);
});

test('settings capture action preserves the precise main-process failure message', async () => {
  const harness = createHarness({
    startCaptureResult: {
      ok: false,
      reason: 'SCREEN_PERMISSION_DENIED',
      message: 'macOS 尚未允许 SnapCut 截图，请在系统设置中开启权限。',
    },
  });
  await flushTasks();

  await harness.elements['#capture-button'].dispatch('click');

  assert.equal(
    harness.elements['#error-message'].textContent,
    'macOS 尚未允许 SnapCut 截图，请在系统设置中开启权限。',
  );
});
