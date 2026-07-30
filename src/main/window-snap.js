'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const MIN_WINDOW_SIZE = 32;
const IGNORED_MAC_OWNERS = new Set([
  'Dock',
  'Window Server',
  'Notification Center',
  'UserNotificationCenter',
  '通知中心',
]);

function intersectRect(left, right) {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const rightEdge = Math.min(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.min(left.y + left.height, right.y + right.height);
  return {
    x,
    y,
    width: Math.max(0, rightEdge - x),
    height: Math.max(0, bottomEdge - y),
  };
}

function normalizeWindowBounds(windowInfo, convertBounds) {
  const raw = windowInfo?.bounds;
  if (!raw || ![raw.x, raw.y, raw.width, raw.height].every(Number.isFinite)) return null;
  const bounds = convertBounds ? convertBounds(raw) : raw;
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) {
    return null;
  }
  return bounds;
}

function windowsForDisplay(openWindows, display, options = {}) {
  if (!Array.isArray(openWindows) || !display?.bounds) return [];
  const currentPid = options.currentPid ?? process.pid;
  const convertBounds = options.convertBounds;

  return openWindows.flatMap((windowInfo) => {
    if (windowInfo?.owner?.processId === currentPid) return [];
    if (process.platform === 'darwin' && IGNORED_MAC_OWNERS.has(windowInfo?.owner?.name)) return [];
    const bounds = normalizeWindowBounds(windowInfo, convertBounds);
    if (!bounds || bounds.width < MIN_WINDOW_SIZE || bounds.height < MIN_WINDOW_SIZE) return [];
    const visible = intersectRect(bounds, display.bounds);
    if (visible.width < MIN_WINDOW_SIZE || visible.height < MIN_WINDOW_SIZE) return [];
    return [{
      id: String(windowInfo.id ?? ''),
      x: visible.x - display.bounds.x,
      y: visible.y - display.bounds.y,
      width: visible.width,
      height: visible.height,
    }];
  });
}

let getWindowsModulePromise;

function preloadWindowEnumerator() {
  if (process.platform === 'darwin') return Promise.resolve(true);
  getWindowsModulePromise ||= import('get-windows');
  return getWindowsModulePromise.catch(() => null);
}

async function openWindowsRaw(options = {}) {
  if (process.platform === 'darwin') {
    const binary = options.binaryPath || path.join(
      __dirname,
      '..',
      '..',
      'node_modules',
      'get-windows',
      'main',
    );
    const { stdout } = await execFileAsync(binary, [
      '--no-accessibility-permission',
      '--no-screen-recording-permission',
      '--open-windows-list',
    ], { maxBuffer: 8 * 1024 * 1024 });
    return JSON.parse(stdout);
  }
  const module = await preloadWindowEnumerator();
  if (!module) return [];
  return module.openWindows();
}

async function enumerateWindowsForDisplay(display, options = {}) {
  try {
    const openWindows = await openWindowsRaw(options);
    return windowsForDisplay(openWindows, display, options);
  } catch {
    return [];
  }
}

async function enumerateWindowsWithTimeout(display, options = {}, timeoutMs = 350) {
  let timer;
  try {
    return await Promise.race([
      enumerateWindowsForDisplay(display, options),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve([]), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  MIN_WINDOW_SIZE,
  enumerateWindowsForDisplay,
  enumerateWindowsWithTimeout,
  intersectRect,
  openWindowsRaw,
  preloadWindowEnumerator,
  windowsForDisplay,
};
