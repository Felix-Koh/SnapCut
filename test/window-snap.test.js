const test = require('node:test');
const assert = require('node:assert/strict');

const { windowsForDisplay } = require('../src/main/window-snap');

const display = { bounds: { x: 100, y: -50, width: 800, height: 600 } };

test('window snapping excludes the SnapCut process and tiny windows', () => {
  const windows = [
    { id: 1, owner: { processId: 42 }, bounds: { x: 120, y: 0, width: 400, height: 300 } },
    { id: 2, owner: { processId: 7 }, bounds: { x: 130, y: 10, width: 20, height: 200 } },
  ];
  assert.deepEqual(windowsForDisplay(windows, display, { currentPid: 42 }), []);
});

test('window snapping clips crossing windows into display-local coordinates', () => {
  const windows = [
    { id: 7, owner: { processId: 7 }, bounds: { x: 50, y: -80, width: 300, height: 200 } },
  ];
  assert.deepEqual(windowsForDisplay(windows, display, { currentPid: 42 }), [
    { id: '7', x: 0, y: 0, width: 250, height: 170 },
  ]);
});

test('window snapping preserves front-to-back order and supports coordinate conversion', () => {
  const windows = [
    { id: 9, owner: { processId: 9 }, bounds: { x: 10, y: 20, width: 200, height: 100 } },
    { id: 8, owner: { processId: 8 }, bounds: { x: 20, y: 30, width: 300, height: 200 } },
  ];
  const result = windowsForDisplay(windows, { bounds: { x: 0, y: 0, width: 1000, height: 700 } }, {
    currentPid: 42,
    convertBounds: (rect) => ({
      x: rect.x * 2,
      y: rect.y * 2,
      width: rect.width * 2,
      height: rect.height * 2,
    }),
  });
  assert.deepEqual(result.map((item) => item.id), ['9', '8']);
  assert.deepEqual(result[0], { id: '9', x: 20, y: 40, width: 400, height: 200 });
});

test('window snapping safely handles missing or invalid window data', () => {
  assert.deepEqual(windowsForDisplay(null, display), []);
  assert.deepEqual(windowsForDisplay([{ id: 1, bounds: { x: 1 } }], display), []);
});
