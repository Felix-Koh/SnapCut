'use strict';

const PIXEL_MAPPING_METRICS = new Set(['bounds', 'size', 'scaleFactor', 'rotation']);

function displayMetricsAffectCaptureMapping(changedMetrics) {
  if (!Array.isArray(changedMetrics)) return true;
  if (changedMetrics.length === 0) return false;

  for (const metric of changedMetrics) {
    if (PIXEL_MAPPING_METRICS.has(metric)) return true;
    // Electron currently documents workArea as the only non-mapping metric.
    // Treat future unknown metrics conservatively instead of exporting stale pixels.
    if (metric !== 'workArea') return true;
  }
  return false;
}

module.exports = { displayMetricsAffectCaptureMapping };
