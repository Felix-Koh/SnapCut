const test = require('node:test');
const assert = require('node:assert/strict');

const { displayMetricsAffectCaptureMapping } = require('../src/main/display-metrics');

test('work-area-only changes do not cancel an active capture', () => {
  assert.equal(displayMetricsAffectCaptureMapping(['workArea']), false);
});

test('pixel mapping changes cancel an active capture', () => {
  for (const metric of ['bounds', 'size', 'scaleFactor', 'rotation']) {
    assert.equal(displayMetricsAffectCaptureMapping([metric]), true, metric);
  }
});

test('work area mixed with a mapping change still cancels capture', () => {
  assert.equal(displayMetricsAffectCaptureMapping(['workArea', 'bounds']), true);
});

test('empty metric notifications are ignored and unknown metrics fail safe', () => {
  assert.equal(displayMetricsAffectCaptureMapping([]), false);
  assert.equal(displayMetricsAffectCaptureMapping(['futureDisplayMetric']), true);
  assert.equal(displayMetricsAffectCaptureMapping(undefined), true);
});
