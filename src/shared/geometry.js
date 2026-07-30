(function attachGeometry(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.SnapGeometry = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createGeometry() {
  'use strict';

  const HANDLE_ORDER = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function normalizeRect(rect) {
    const x = rect.width < 0 ? rect.x + rect.width : rect.x;
    const y = rect.height < 0 ? rect.y + rect.height : rect.y;
    return {
      x,
      y,
      width: Math.abs(rect.width),
      height: Math.abs(rect.height),
    };
  }

  function rectFromPoints(start, end) {
    return normalizeRect({
      x: start.x,
      y: start.y,
      width: end.x - start.x,
      height: end.y - start.y,
    });
  }

  function clampPoint(point, bounds) {
    return {
      x: clamp(point.x, bounds.x, bounds.x + bounds.width),
      y: clamp(point.y, bounds.y, bounds.y + bounds.height),
    };
  }

  function clampRect(rect, bounds) {
    const normalized = normalizeRect(rect);
    const width = Math.min(normalized.width, bounds.width);
    const height = Math.min(normalized.height, bounds.height);
    return {
      x: clamp(normalized.x, bounds.x, bounds.x + bounds.width - width),
      y: clamp(normalized.y, bounds.y, bounds.y + bounds.height - height),
      width,
      height,
    };
  }

  function containsPoint(rect, point, padding = 0) {
    const normalized = normalizeRect(rect);
    return (
      point.x >= normalized.x - padding &&
      point.x <= normalized.x + normalized.width + padding &&
      point.y >= normalized.y - padding &&
      point.y <= normalized.y + normalized.height + padding
    );
  }

  function getHandlePoints(rect) {
    const normalized = normalizeRect(rect);
    const left = normalized.x;
    const centerX = normalized.x + normalized.width / 2;
    const right = normalized.x + normalized.width;
    const top = normalized.y;
    const centerY = normalized.y + normalized.height / 2;
    const bottom = normalized.y + normalized.height;

    return {
      nw: { x: left, y: top },
      n: { x: centerX, y: top },
      ne: { x: right, y: top },
      e: { x: right, y: centerY },
      se: { x: right, y: bottom },
      s: { x: centerX, y: bottom },
      sw: { x: left, y: bottom },
      w: { x: left, y: centerY },
    };
  }

  function hitTestHandle(rect, point, radius = 8) {
    const handles = getHandlePoints(rect);
    for (const name of HANDLE_ORDER) {
      const handle = handles[name];
      if (Math.abs(point.x - handle.x) <= radius && Math.abs(point.y - handle.y) <= radius) {
        return name;
      }
    }
    return null;
  }

  function enforceMinimumEdge(value, anchor, minimum, direction) {
    if (direction < 0) {
      return Math.min(value, anchor - minimum);
    }
    return Math.max(value, anchor + minimum);
  }

  function resizeRect(rect, handle, point, bounds, minimumSize = 8) {
    const source = normalizeRect(rect);
    const p = clampPoint(point, bounds);
    let left = source.x;
    let top = source.y;
    let right = source.x + source.width;
    let bottom = source.y + source.height;

    if (handle.includes('w')) {
      left = enforceMinimumEdge(p.x, right, minimumSize, -1);
    }
    if (handle.includes('e')) {
      right = enforceMinimumEdge(p.x, left, minimumSize, 1);
    }
    if (handle.includes('n')) {
      top = enforceMinimumEdge(p.y, bottom, minimumSize, -1);
    }
    if (handle.includes('s')) {
      bottom = enforceMinimumEdge(p.y, top, minimumSize, 1);
    }

    return clampRect(
      {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      },
      bounds,
    );
  }

  function moveRect(rect, delta, bounds) {
    const normalized = normalizeRect(rect);
    return clampRect(
      {
        x: normalized.x + delta.x,
        y: normalized.y + delta.y,
        width: normalized.width,
        height: normalized.height,
      },
      bounds,
    );
  }

  function toolbarPosition(selection, toolbar, viewport, gap = 12) {
    const rect = normalizeRect(selection);
    const width = Math.min(toolbar.width, Math.max(0, viewport.width - 16));
    const height = toolbar.height;
    const x = clamp(
      rect.x + rect.width - width,
      8,
      Math.max(8, viewport.width - width - 8),
    );
    const below = rect.y + rect.height + gap;
    const above = rect.y - height - gap;
    let y;

    if (below + height <= viewport.height - 8) {
      y = below;
    } else if (above >= 8) {
      y = above;
    } else {
      y = clamp(rect.y + gap, 8, Math.max(8, viewport.height - height - 8));
    }

    return { x, y };
  }

  function mapPoint(point, fromSize, toSize) {
    return {
      x: point.x * (toSize.width / fromSize.width),
      y: point.y * (toSize.height / fromSize.height),
    };
  }

  function mapRect(rect, fromSize, toSize) {
    const topLeft = mapPoint({ x: rect.x, y: rect.y }, fromSize, toSize);
    const bottomRight = mapPoint(
      { x: rect.x + rect.width, y: rect.y + rect.height },
      fromSize,
      toSize,
    );
    return rectFromPoints(topLeft, bottomRight);
  }

  return {
    HANDLE_ORDER,
    clamp,
    normalizeRect,
    rectFromPoints,
    clampPoint,
    clampRect,
    containsPoint,
    getHandlePoints,
    hitTestHandle,
    resizeRect,
    moveRect,
    toolbarPosition,
    mapPoint,
    mapRect,
  };
});
