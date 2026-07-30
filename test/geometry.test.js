const test = require('node:test');
const assert = require('node:assert/strict');

const geometry = require('../src/shared/geometry');

test('rectFromPoints normalizes reverse drags', () => {
  assert.deepEqual(
    geometry.rectFromPoints({ x: 80, y: 60 }, { x: 20, y: 10 }),
    { x: 20, y: 10, width: 60, height: 50 },
  );
});

test('clampRect keeps a moved selection within the display', () => {
  assert.deepEqual(
    geometry.clampRect(
      { x: 90, y: -20, width: 30, height: 140 },
      { x: 0, y: 0, width: 100, height: 100 },
    ),
    { x: 70, y: 0, width: 30, height: 100 },
  );
});

test('hitTestHandle detects corners before edge handles', () => {
  const rect = { x: 10, y: 20, width: 100, height: 60 };
  assert.equal(geometry.hitTestHandle(rect, { x: 12, y: 22 }), 'nw');
  assert.equal(geometry.hitTestHandle(rect, { x: 60, y: 20 }), 'n');
  assert.equal(geometry.hitTestHandle(rect, { x: 60, y: 50 }), null);
});

test('resizeRect enforces a minimum size and display bounds', () => {
  const bounds = { x: 0, y: 0, width: 300, height: 200 };
  const original = { x: 50, y: 50, width: 100, height: 80 };
  assert.deepEqual(
    geometry.resizeRect(original, 'nw', { x: 149, y: 129 }, bounds, 12),
    { x: 138, y: 118, width: 12, height: 12 },
  );
  assert.deepEqual(
    geometry.resizeRect(original, 'se', { x: 500, y: 500 }, bounds, 12),
    { x: 50, y: 50, width: 250, height: 150 },
  );
});

test('moveRect preserves dimensions while clamping position', () => {
  assert.deepEqual(
    geometry.moveRect(
      { x: 30, y: 40, width: 50, height: 60 },
      { x: 100, y: -100 },
      { x: 0, y: 0, width: 120, height: 100 },
    ),
    { x: 70, y: 0, width: 50, height: 60 },
  );
});

test('toolbarPosition prefers below then above and clamps horizontally', () => {
  assert.deepEqual(
    geometry.toolbarPosition(
      { x: 220, y: 20, width: 70, height: 40 },
      { width: 180, height: 44 },
      { width: 300, height: 200 },
      10,
    ),
    { x: 110, y: 70 },
  );
  assert.deepEqual(
    geometry.toolbarPosition(
      { x: 10, y: 150, width: 60, height: 40 },
      { width: 180, height: 44 },
      { width: 300, height: 200 },
      10,
    ),
    { x: 8, y: 96 },
  );
});

test('mapRect maps logical coordinates to captured pixel coordinates', () => {
  assert.deepEqual(
    geometry.mapRect(
      { x: 25, y: 10, width: 50, height: 20 },
      { width: 100, height: 50 },
      { width: 200, height: 100 },
    ),
    { x: 50, y: 20, width: 100, height: 40 },
  );
});
