(function attachAnnotations(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.SnapAnnotations = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAnnotations() {
  'use strict';

  function bounds(annotation) {
    if (!annotation || typeof annotation !== 'object') return null;
    if (annotation.type === 'text') {
      return {
        x: annotation.x,
        y: annotation.y,
        width: Math.max(1, annotation.renderWidth || annotation.maxWidth || annotation.fontSize || 1),
        height: Math.max(1, annotation.renderHeight || annotation.fontSize * 1.35 || 1),
      };
    }
    const points = annotation.points || (
      ['rect', 'ellipse', 'arrow'].includes(annotation.type)
        ? [
          { x: annotation.x1, y: annotation.y1 },
          { x: annotation.x2, y: annotation.y2 },
        ]
        : []
    );
    if (!points.length) return null;
    const xs = points.map((point) => point.x).filter(Number.isFinite);
    const ys = points.map((point) => point.y).filter(Number.isFinite);
    if (!xs.length || !ys.length) return null;
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return {
      x: left,
      y: top,
      width: Math.max(1, Math.max(...xs) - left),
      height: Math.max(1, Math.max(...ys) - top),
    };
  }

  function contains(rect, point, padding = 0) {
    return Boolean(
      rect &&
      point.x >= rect.x - padding &&
      point.x <= rect.x + rect.width + padding &&
      point.y >= rect.y - padding &&
      point.y <= rect.y + rect.height + padding
    );
  }

  function segmentDistance(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
    const ratio = Math.max(
      0,
      Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)),
    );
    return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy));
  }

  function pathHit(points, point, tolerance) {
    if (!Array.isArray(points) || !points.length) return false;
    if (points.length === 1) return segmentDistance(point, points[0], points[0]) <= tolerance;
    for (let index = 1; index < points.length; index += 1) {
      if (segmentDistance(point, points[index - 1], points[index]) <= tolerance) return true;
    }
    return false;
  }

  function hit(annotation, point, tolerance = 7) {
    const rect = bounds(annotation);
    if (!contains(rect, point, tolerance)) return false;
    if (annotation.type === 'text') return true;
    if (annotation.type === 'pen') {
      return pathHit(annotation.points, point, tolerance + (annotation.width || 1) / 2);
    }
    if (annotation.type === 'mosaic') {
      return pathHit(annotation.points, point, tolerance + (annotation.brushSize || 1) / 2);
    }
    if (annotation.type === 'arrow') {
      return segmentDistance(
        point,
        { x: annotation.x1, y: annotation.y1 },
        { x: annotation.x2, y: annotation.y2 },
      ) <= tolerance + (annotation.width || 1) / 2;
    }
    if (annotation.type === 'rect') {
      const edgeDistance = Math.min(
        Math.abs(point.x - rect.x),
        Math.abs(point.x - (rect.x + rect.width)),
        Math.abs(point.y - rect.y),
        Math.abs(point.y - (rect.y + rect.height)),
      );
      return edgeDistance <= tolerance + (annotation.width || 1) / 2;
    }
    if (annotation.type === 'ellipse') {
      const radiusX = Math.max(0.5, rect.width / 2);
      const radiusY = Math.max(0.5, rect.height / 2);
      const normalized = Math.hypot(
        (point.x - (rect.x + radiusX)) / radiusX,
        (point.y - (rect.y + radiusY)) / radiusY,
      );
      const normalizedTolerance = (tolerance + (annotation.width || 1) / 2) / Math.min(radiusX, radiusY);
      return Math.abs(normalized - 1) <= normalizedTolerance;
    }
    return false;
  }

  function hitTest(annotations, point, tolerance = 7) {
    for (let index = annotations.length - 1; index >= 0; index -= 1) {
      if (hit(annotations[index], point, tolerance)) return index;
    }
    return -1;
  }

  function translate(annotation, deltaX, deltaY) {
    const translated = { ...annotation };
    ['x', 'x1', 'x2'].forEach((key) => {
      if (typeof translated[key] === 'number') translated[key] += deltaX;
    });
    ['y', 'y1', 'y2'].forEach((key) => {
      if (typeof translated[key] === 'number') translated[key] += deltaY;
    });
    if (translated.points) {
      translated.points = translated.points.map((point) => ({
        x: point.x + deltaX,
        y: point.y + deltaY,
      }));
    }
    return translated;
  }

  function moveWithin(annotation, delta, container) {
    const rect = bounds(annotation);
    if (!rect) return annotation;
    const minimumX = container.x - rect.x;
    const maximumX = container.x + container.width - (rect.x + rect.width);
    const minimumY = container.y - rect.y;
    const maximumY = container.y + container.height - (rect.y + rect.height);
    return translate(
      annotation,
      Math.max(minimumX, Math.min(maximumX, delta.x)),
      Math.max(minimumY, Math.min(maximumY, delta.y)),
    );
  }

  function mapCoordinate(value, oldStart, oldSize, newStart, newSize) {
    if (!oldSize) return newStart;
    return newStart + ((value - oldStart) / oldSize) * newSize;
  }

  function resize(annotation, sourceBounds, targetBounds) {
    const resized = { ...annotation };
    const mapX = (value) => mapCoordinate(
      value,
      sourceBounds.x,
      sourceBounds.width,
      targetBounds.x,
      targetBounds.width,
    );
    const mapY = (value) => mapCoordinate(
      value,
      sourceBounds.y,
      sourceBounds.height,
      targetBounds.y,
      targetBounds.height,
    );
    ['x', 'x1', 'x2'].forEach((key) => {
      if (typeof resized[key] === 'number') resized[key] = mapX(resized[key]);
    });
    ['y', 'y1', 'y2'].forEach((key) => {
      if (typeof resized[key] === 'number') resized[key] = mapY(resized[key]);
    });
    if (resized.points) {
      resized.points = resized.points.map((point) => ({ x: mapX(point.x), y: mapY(point.y) }));
    }
    const scaleX = targetBounds.width / Math.max(1, sourceBounds.width);
    const scaleY = targetBounds.height / Math.max(1, sourceBounds.height);
    const scale = Math.max(0.2, (scaleX + scaleY) / 2);
    if (resized.type === 'text') {
      resized.fontSize = Math.max(8, (resized.fontSize || 16) * scaleY);
      resized.maxWidth = Math.max(24, targetBounds.width);
      resized.renderWidth = targetBounds.width;
      resized.renderHeight = targetBounds.height;
    } else if (resized.type === 'mosaic') {
      resized.brushSize = Math.max(2, (resized.brushSize || 2) * scale);
    } else if (typeof resized.width === 'number') {
      resized.width = Math.max(0.5, resized.width * scale);
    }
    return resized;
  }

  return { bounds, hit, hitTest, moveWithin, resize, segmentDistance, translate };
});
