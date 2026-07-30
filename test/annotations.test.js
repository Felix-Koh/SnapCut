const test = require('node:test');
const assert = require('node:assert/strict');

const annotations = require('../src/shared/annotations');

test('annotation hit testing prefers the visually topmost editable object', () => {
  const shapes = [
    { type: 'rect', x1: 10, y1: 10, x2: 80, y2: 80, width: 4 },
    { type: 'text', x: 8, y: 8, text: 'top', fontSize: 20, renderWidth: 50, renderHeight: 27 },
  ];
  assert.equal(annotations.hitTest(shapes, { x: 12, y: 12 }), 1);
  assert.equal(annotations.hitTest(shapes, { x: 79, y: 45 }), 0);
  assert.equal(annotations.hitTest(shapes, { x: 45, y: 45 }), -1);
});

test('freehand and ellipse annotations use shape-aware hit areas', () => {
  const pen = { type: 'pen', points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], width: 4 };
  const ellipse = { type: 'ellipse', x1: 20, y1: 20, x2: 120, y2: 80, width: 3 };
  assert.equal(annotations.hit(pen, { x: 52, y: 48 }), true);
  assert.equal(annotations.hit(pen, { x: 80, y: 20 }), false);
  assert.equal(annotations.hit(ellipse, { x: 20, y: 50 }), true);
  assert.equal(annotations.hit(ellipse, { x: 70, y: 50 }), false);
});

test('selected annotations move within the screenshot and resize without losing their type', () => {
  const arrow = { type: 'arrow', x1: 10, y1: 20, x2: 50, y2: 60, color: '#ef4444', width: 4 };
  const moved = annotations.moveWithin(
    arrow,
    { x: 100, y: 100 },
    { x: 0, y: 0, width: 120, height: 100 },
  );
  assert.deepEqual({ x1: moved.x1, y1: moved.y1, x2: moved.x2, y2: moved.y2 }, {
    x1: 80,
    y1: 60,
    x2: 120,
    y2: 100,
  });

  const resized = annotations.resize(
    arrow,
    { x: 10, y: 20, width: 40, height: 40 },
    { x: 20, y: 30, width: 80, height: 60 },
  );
  assert.equal(resized.type, 'arrow');
  assert.deepEqual({ x1: resized.x1, y1: resized.y1, x2: resized.x2, y2: resized.y2 }, {
    x1: 20,
    y1: 30,
    x2: 100,
    y2: 90,
  });
  assert.ok(resized.width > arrow.width);
});
