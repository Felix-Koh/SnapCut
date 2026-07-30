const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '../src/main/index.js'), 'utf8');

test('capture renderer is loaded in the background before the global shortcut is pressed', () => {
  assert.match(main, /function prepareOverlayWindow\(\)/);
  assert.match(main, /preparedOverlayPromise = window[\s\S]*?\.loadFile\(/);
  assert.match(main, /setImmediate\(\(\) => \{[\s\S]*?prepareOverlayWindow\(\)/);
  assert.match(main, /const captureWindow = await acquireOverlayWindow\(bounds\)/);
  assert.match(main, /captureWindow\.webContents\.send\('capture:ready'/);
});

test('used or failed capture windows are replaced with a fresh background renderer', () => {
  assert.match(main, /captureWindow\.on\('closed'[\s\S]*?setImmediate\(\(\) => prepareOverlayWindow\(\)\)/);
  assert.match(main, /if \(preparedOverlayWindow && !preparedOverlayWindow\.isDestroyed\(\)\)/);
});
