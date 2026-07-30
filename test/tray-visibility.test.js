const test = require('node:test');
const assert = require('node:assert/strict');

const { reconcileTrayVisibility } = require('../src/main/tray-visibility');

test('tray visibility creates, preserves, and destroys the tray deterministically', () => {
  let creates = 0;
  let destroys = 0;
  const createdTray = { destroy: () => { destroys += 1; } };
  const createTray = () => {
    creates += 1;
    return createdTray;
  };

  const visibleTray = reconcileTrayVisibility({ shouldShow: true, tray: null, createTray });
  assert.equal(visibleTray, createdTray);
  assert.equal(creates, 1);

  const preservedTray = reconcileTrayVisibility({
    shouldShow: true,
    tray: visibleTray,
    createTray,
  });
  assert.equal(preservedTray, createdTray);
  assert.equal(creates, 1);

  const hiddenTray = reconcileTrayVisibility({
    shouldShow: false,
    tray: preservedTray,
    createTray,
  });
  assert.equal(hiddenTray, null);
  assert.equal(destroys, 1);
});
