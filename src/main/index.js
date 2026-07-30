const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  shell,
  systemPreferences,
} = require('electron');

const { SettingsStore, platformHotkeys, sanitizeSettings } = require('./settings-store');
const { displayMetricsAffectCaptureMapping } = require('./display-metrics');

const APP_NAME = 'SnapCut';
const CAPTURE_SOURCE_ATTEMPTS = 2;
const MAX_PNG_BYTES = 128 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 100_000_000;
const ROOT = path.join(__dirname, '..', '..');
const PRELOAD = path.join(ROOT, 'src', 'preload', 'index.js');
const RENDERER = path.join(ROOT, 'src', 'renderer');

let settingsStore;
let settingsWindow = null;
let overlayWindow = null;
let tray = null;
let captureInProgress = false;
let registeredHotkey = null;
let hotkeyRegistered = false;
let lastCaptureError = null;
let isQuitting = false;
let overlayLoadTimer = null;
let capturePixelSize = null;
let captureAttempt = 0;
let overlayClosing = false;
let overlayAwaitingLoad = false;

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isMac() {
  return process.platform === 'darwin';
}

function permissionStatus() {
  if (!isMac()) return 'not-required';
  return systemPreferences.getMediaAccessStatus('screen');
}

function publicSettings() {
  return {
    ...settingsStore.get(),
    hotkeyOptions: platformHotkeys(),
    hotkeyRegistered,
  };
}

function appContext() {
  return {
    appName: APP_NAME,
    version: app.getVersion(),
    platform: process.platform,
    screenPermission: permissionStatus(),
    settings: publicSettings(),
    lastCaptureError,
  };
}

function safeWindowOptions(extra = {}) {
  const { webPreferences: extraWebPreferences = {}, ...windowOptions } = extra;
  return {
    ...windowOptions,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged || process.argv.includes('--dev'),
      ...extraWebPreferences,
    },
  };
}

function senderIsPage(event, window, htmlFile) {
  if (!window || window.isDestroyed() || event.sender !== window.webContents) return false;
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
  const expectedUrl = pathToFileURL(path.join(RENDERER, htmlFile)).href;
  return event.senderFrame.url === expectedUrl;
}

function assertSettingsSender(event) {
  if (!senderIsPage(event, settingsWindow, 'settings.html')) {
    throw new Error('Untrusted settings renderer request');
  }
}

function assertOverlaySender(event) {
  if (!senderIsPage(event, overlayWindow, 'overlay.html')) {
    throw new Error('Untrusted capture renderer request');
  }
}

function focusAccessoryApp() {
  if (!isMac()) return;
  try {
    app.focus({ steal: true });
  } catch {
    // Electron 43 supports FocusOptions; the fallback keeps older runtimes usable.
    app.focus();
  }
}

function exitSimpleFullscreen(window) {
  if (!isMac() || !window || window.isDestroyed()) return;
  try {
    if (window.isSimpleFullScreen()) window.setSimpleFullScreen(false);
  } catch {
    // The native window may already be tearing down.
  }
}

function lockWindowToLocalPage(window, htmlFile) {
  const expectedUrl = pathToFileURL(path.join(RENDERER, htmlFile)).href;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== expectedUrl) event.preventDefault();
  });
}

function createSettingsWindow({ show = true } = {}) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (show) {
      focusAccessoryApp();
      settingsWindow.show();
      settingsWindow.focus();
    }
    return settingsWindow;
  }

  settingsWindow = new BrowserWindow(
    safeWindowOptions({
      width: 480,
      height: 610,
      minWidth: 440,
      minHeight: 560,
      maxWidth: 620,
      title: APP_NAME,
      show: false,
      backgroundColor: '#f4f8f8',
      autoHideMenuBar: true,
      fullscreenable: false,
    }),
  );

  lockWindowToLocalPage(settingsWindow, 'settings.html');
  settingsWindow.loadFile(path.join(RENDERER, 'settings.html'));
  settingsWindow.once('ready-to-show', () => {
    settingsWindow.webContents.send('settings:changed', appContext());
    if (show) {
      focusAccessoryApp();
      settingsWindow.show();
      settingsWindow.focus();
    }
  });
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
  settingsWindow.on('focus', () => sendSettingsChanged());
  return settingsWindow;
}

function showSettings() {
  createSettingsWindow({ show: true });
}

function sendSettingsChanged() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('settings:changed', appContext());
  }
}

function setLaunchAtLogin(enabled) {
  const options = {
    openAtLogin: enabled,
    openAsHidden: true,
  };
  if (process.platform === 'win32') {
    options.path = app.getPath('exe');
    options.args = ['--autostart'];
  }
  app.setLoginItemSettings(options);
}

function unregisterHotkey() {
  if (registeredHotkey) {
    globalShortcut.unregister(registeredHotkey);
  }
  registeredHotkey = null;
  hotkeyRegistered = false;
}

function onGlobalCaptureHotkey() {
  startCapture().catch(handleCaptureError);
}

function registerInitialHotkey(accelerator) {
  try {
    hotkeyRegistered = globalShortcut.register(accelerator, onGlobalCaptureHotkey);
  } catch {
    hotkeyRegistered = false;
  }
  registeredHotkey = hotkeyRegistered ? accelerator : null;
  return hotkeyRegistered;
}

function switchHotkey(accelerator) {
  if (accelerator === registeredHotkey && hotkeyRegistered) return true;
  let candidateRegistered = false;
  try {
    candidateRegistered = globalShortcut.register(accelerator, onGlobalCaptureHotkey);
  } catch {
    candidateRegistered = false;
  }
  if (!candidateRegistered) return false;

  const previous = registeredHotkey;
  if (previous && previous !== accelerator) globalShortcut.unregister(previous);
  registeredHotkey = accelerator;
  hotkeyRegistered = true;
  return true;
}

function chooseCaptureSource(sources, display) {
  return sources.find((source) => String(source.display_id) === String(display.id)) || null;
}

async function captureDisplay(display) {
  const scaleFactor = display.scaleFactor || 1;
  const thumbnailSize = {
    width: Math.max(1, Math.round(display.size.width * scaleFactor)),
    height: Math.max(1, Math.round(display.size.height * scaleFactor)),
  };

  for (let attempt = 0; attempt < CAPTURE_SOURCE_ATTEMPTS; attempt += 1) {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize,
      fetchWindowIcons: false,
    });
    const source = chooseCaptureSource(sources, display);
    if (source && !source.thumbnail.isEmpty()) {
      const png = source.thumbnail.toPNG();
      const pngBytes = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
      return { pngBytes, pixelSize: source.thumbnail.getSize() };
    }
    if (attempt + 1 < CAPTURE_SOURCE_ATTEMPTS) await delay(160);
  }

  const error = new Error('没有取得屏幕画面，请允许 SnapCut 访问屏幕录制权限后重试。');
  error.code = 'EMPTY_SCREEN_CAPTURE';
  throw error;
}

async function startCapture() {
  if (captureInProgress || overlayWindow) return { ok: false, reason: 'busy' };
  const attempt = ++captureAttempt;
  captureInProgress = true;
  overlayClosing = false;
  overlayAwaitingLoad = false;
  lastCaptureError = null;

  try {
    const status = permissionStatus();
    if (status === 'denied' || status === 'restricted') {
      const error = new Error('macOS 尚未允许 SnapCut 截图，请在系统设置中开启“屏幕与系统音频录制”权限。');
      error.code = 'SCREEN_PERMISSION_DENIED';
      throw error;
    }

    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.hide();
    await delay(140);
    if (attempt !== captureAttempt || !captureInProgress) {
      return { ok: false, reason: 'cancelled' };
    }

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const capture = await captureDisplay(display);
    if (attempt !== captureAttempt || !captureInProgress) {
      return { ok: false, reason: 'cancelled' };
    }
    const bounds = display.bounds;
    capturePixelSize = { ...capture.pixelSize };

    const captureWindow = new BrowserWindow(
      safeWindowOptions({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        frame: false,
        transparent: false,
        backgroundColor: '#000000',
        show: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: false,
        acceptFirstMouse: true,
        hiddenInMissionControl: true,
        roundedCorners: false,
        autoHideMenuBar: true,
        title: `${APP_NAME} Capture`,
      }),
    );
    overlayWindow = captureWindow;

    if (isMac()) {
      captureWindow.setSimpleFullScreen(true);
      captureWindow.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
    }
    captureWindow.setAlwaysOnTop(true, 'screen-saver');
    lockWindowToLocalPage(captureWindow, 'overlay.html');
    captureWindow.on('close', () => {
      if (overlayWindow !== captureWindow) return;
      if (!overlayClosing) {
        overlayClosing = true;
        captureAttempt += 1;
      }
      overlayAwaitingLoad = false;
      exitSimpleFullscreen(captureWindow);
    });
    captureWindow.on('closed', () => {
      if (overlayWindow !== captureWindow) return;
      if (overlayLoadTimer) clearTimeout(overlayLoadTimer);
      overlayLoadTimer = null;
      overlayWindow = null;
      captureInProgress = false;
      capturePixelSize = null;
      overlayClosing = false;
      overlayAwaitingLoad = false;
      if (settingsWindow?.isVisible()) focusAccessoryApp();
    });
    captureWindow.webContents.on('render-process-gone', (_event, details) => {
      if (
        details.reason !== 'clean-exit' &&
        !isQuitting &&
        !overlayClosing &&
        overlayWindow === captureWindow &&
        !captureWindow.isDestroyed()
      ) {
        const error = new Error(`截图界面异常退出：${details.reason}`);
        error.code = 'CAPTURE_RENDERER_GONE';
        handleCaptureError(error);
      }
    });
    captureWindow.on('unresponsive', () => {
      if (!isQuitting && !overlayClosing && overlayWindow === captureWindow) {
        const error = new Error('截图界面暂时没有响应，已安全取消本次截图。');
        error.code = 'CAPTURE_UNRESPONSIVE';
        handleCaptureError(error);
      }
    });

    await captureWindow.loadFile(path.join(RENDERER, 'overlay.html'));
    if (
      attempt !== captureAttempt ||
      !captureInProgress ||
      overlayWindow !== captureWindow ||
      captureWindow.isDestroyed()
    ) {
      return { ok: false, reason: 'cancelled' };
    }
    overlayAwaitingLoad = true;
    captureWindow.webContents.send('capture:ready', {
      ...capture,
      display: {
        id: display.id,
        bounds,
        size: display.size,
        scaleFactor: display.scaleFactor,
      },
      settings: publicSettings(),
    });
    overlayLoadTimer = setTimeout(() => {
      if (
        attempt === captureAttempt &&
        overlayAwaitingLoad &&
        overlayWindow === captureWindow &&
        !captureWindow.isDestroyed()
      ) {
        const error = new Error('截图画面加载超时，请重试。');
        error.code = 'CAPTURE_LOAD_TIMEOUT';
        handleCaptureError(error);
      }
    }, 8_000);
    return { ok: true };
  } catch (error) {
    if (attempt !== captureAttempt) {
      return { ok: false, reason: 'cancelled' };
    }
    captureInProgress = false;
    handleCaptureError(error);
    return {
      ok: false,
      reason: error.code || 'capture-failed',
      message: error?.message || '截图没有启动，请重试。',
    };
  }
}

function closeOverlay({ destroy = false } = {}) {
  if (overlayLoadTimer) clearTimeout(overlayLoadTimer);
  overlayLoadTimer = null;
  overlayAwaitingLoad = false;
  const window = overlayWindow;
  if (!window || window.isDestroyed()) {
    captureAttempt += 1;
    overlayWindow = null;
    captureInProgress = false;
    capturePixelSize = null;
    overlayClosing = false;
    return;
  }
  if (!overlayClosing) {
    overlayClosing = true;
    captureAttempt += 1;
  }
  exitSimpleFullscreen(window);
  if (destroy) window.destroy();
  else window.close();
}

function handleCaptureError(error) {
  lastCaptureError = error?.message || String(error);
  closeOverlay({ destroy: true });
  showSettings();
  sendSettingsChanged();
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('capture:error', {
      code: error?.code || 'CAPTURE_FAILED',
      message: lastCaptureError,
    });
  }
}

function validatePngBytes(pngBytes) {
  const validType =
    pngBytes instanceof ArrayBuffer ||
    ArrayBuffer.isView(pngBytes) ||
    Buffer.isBuffer(pngBytes);
  if (!validType) throw new Error('Invalid PNG image payload');
  const buffer = Buffer.isBuffer(pngBytes)
    ? pngBytes
    : pngBytes instanceof ArrayBuffer
      ? Buffer.from(pngBytes)
      : Buffer.from(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_PNG_BYTES) {
    throw new Error('Invalid PNG image payload size');
  }
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.byteLength < pngSignature.length || !buffer.subarray(0, 8).equals(pngSignature)) {
    throw new Error('Image payload is not a PNG');
  }
  if (
    buffer.byteLength < 24 ||
    buffer.toString('ascii', 12, 16) !== 'IHDR' ||
    buffer.readUInt32BE(8) !== 13
  ) {
    throw new Error('PNG header is invalid');
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const pixelCount = width * height;
  if (
    width < 1 ||
    height < 1 ||
    pixelCount > MAX_IMAGE_PIXELS ||
    !capturePixelSize ||
    width > capturePixelSize.width ||
    height > capturePixelSize.height ||
    pixelCount > capturePixelSize.width * capturePixelSize.height
  ) {
    throw new Error('PNG dimensions exceed the active capture bounds');
  }
  const image = nativeImage.createFromBuffer(buffer);
  if (image.isEmpty()) throw new Error('The exported image is empty');
  return { buffer, image };
}

function sanitizedFilename(value) {
  const fallback = `SnapCut-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
  if (typeof value !== 'string') return fallback;
  const safe = path.basename(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim();
  if (!safe) return fallback;
  return safe.toLowerCase().endsWith('.png') ? safe : `${safe}.png`;
}

function captureActionLabel(settings) {
  return hotkeyRegistered
    ? `立即截图    ${settings.hotkey}`
    : '立即截图（快捷键不可用，点击仍可截图）';
}

function trayTooltip(settings) {
  return hotkeyRegistered
    ? `${APP_NAME} · ${settings.hotkey}`
    : `${APP_NAME} · 快捷键不可用，可双击截图`;
}

function rebuildTrayMenu() {
  if (!tray) return;
  const settings = settingsStore.get();
  const template = [
    {
      label: captureActionLabel(settings),
      click: () => startCapture().catch(handleCaptureError),
    },
    { type: 'separator' },
    { label: '偏好设置…', click: showSettings },
    {
      label: '开机时启动',
      type: 'checkbox',
      checked: settings.launchAtLogin,
      click: (item) => {
        const next = settingsStore.update({ launchAtLogin: item.checked });
        setLaunchAtLogin(next.launchAtLogin);
        sendSettingsChanged();
        rebuildTrayMenu();
      },
    },
  ];
  if (isMac()) {
    template.push({
      label: '打开屏幕录制权限设置',
      click: () => openScreenPermissionSettings(),
    });
  }
  template.push(
    { type: 'separator' },
    {
      label: `关于 ${APP_NAME}`,
      click: () => {
        dialog.showMessageBox({
          type: 'info',
          title: `关于 ${APP_NAME}`,
          message: `${APP_NAME} ${app.getVersion()}`,
          detail: '快速、私密的本地截图与标注工具。\n截图不会上传，应用不包含遥测。',
          buttons: ['好'],
        });
      },
    },
    {
      label: `退出 ${APP_NAME}`,
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  );
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  const trayPath = isMac()
    ? path.join(ROOT, 'src', 'assets', 'trayTemplate.png')
    : path.join(ROOT, 'build', 'icon.ico');
  let image = nativeImage.createFromPath(trayPath);
  if (image.isEmpty()) {
    image = nativeImage
      .createFromPath(path.join(ROOT, 'src', 'assets', 'tray.png'))
      .resize({ width: 18, height: 18 });
  }
  if (isMac()) image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip(trayTooltip(settingsStore.get()));
  tray.on('double-click', () => startCapture().catch(handleCaptureError));
  rebuildTrayMenu();
}

function openScreenPermissionSettings() {
  if (!isMac()) return Promise.resolve(false);
  return shell
    .openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
    .then(() => true)
    .catch(async () => {
      await dialog.showMessageBox({
        type: 'info',
        title: '打开屏幕录制权限',
        message: '请手动打开 macOS 的截图权限',
        detail: '系统设置 → 隐私与安全性 → 屏幕与系统音频录制，然后允许 SnapCut。',
        buttons: ['知道了'],
      });
      return false;
    });
}

function installIpcHandlers() {
  ipcMain.handle('app:context', (event) => {
    assertSettingsSender(event);
    return appContext();
  });
  ipcMain.handle('settings:get', (event) => {
    assertSettingsSender(event);
    return publicSettings();
  });
  ipcMain.handle('settings:update', (event, patch) => {
    assertSettingsSender(event);
    const current = settingsStore.get();
    const patchObject = patch && typeof patch === 'object' ? patch : {};
    const candidate = sanitizeSettings({ ...current, ...patchObject });

    if (Object.hasOwn(patchObject, 'hotkey') && candidate.hotkey !== patchObject.hotkey) {
      return {
        ok: false,
        error: '这个快捷键不在可用列表中，原快捷键已保留。',
        settings: publicSettings(),
      };
    }

    if (candidate.hotkey !== current.hotkey) {
      if (!switchHotkey(candidate.hotkey)) {
        return {
          ok: false,
          error: '这个快捷键已被其他应用占用，请选择另一个。',
          settings: publicSettings(),
        };
      }
    }

    const next = settingsStore.update(candidate);
    setLaunchAtLogin(next.launchAtLogin);
    rebuildTrayMenu();
    if (tray) tray.setToolTip(trayTooltip(next));
    sendSettingsChanged();
    return { ok: true, settings: publicSettings() };
  });
  ipcMain.handle('capture:start', async (event) => {
    assertSettingsSender(event);
    return startCapture();
  });
  ipcMain.handle('capture:loaded', (event) => {
    assertOverlaySender(event);
    if (!captureInProgress || overlayClosing || !overlayAwaitingLoad) {
      return { ok: false, reason: 'capture-not-awaiting-load' };
    }
    if (overlayLoadTimer) clearTimeout(overlayLoadTimer);
    overlayLoadTimer = null;
    overlayAwaitingLoad = false;
    overlayWindow.show();
    overlayWindow.focus();
    return { ok: true };
  });
  ipcMain.handle('capture:load-failed', (event, message) => {
    assertOverlaySender(event);
    if (!captureInProgress || overlayClosing || !overlayAwaitingLoad) {
      return { ok: false, reason: 'capture-not-awaiting-load' };
    }
    const error = new Error(typeof message === 'string' ? message : '截图画面加载失败');
    error.code = 'CAPTURE_LOAD_FAILED';
    handleCaptureError(error);
    return { ok: false };
  });
  ipcMain.handle('capture:close', (event) => {
    assertOverlaySender(event);
    closeOverlay();
    return { ok: true };
  });
  ipcMain.handle('capture:copy', (event, pngBytes) => {
    assertOverlaySender(event);
    clipboard.writeImage(validatePngBytes(pngBytes).image);
    return { ok: true };
  });
  ipcMain.handle('capture:save', async (event, payload) => {
    assertOverlaySender(event);
    const { buffer } = validatePngBytes(payload?.pngBytes);
    const filename = sanitizedFilename(payload?.suggestedName);
    const result = await dialog.showSaveDialog(overlayWindow, {
      title: '保存截图',
      defaultPath: path.join(app.getPath('pictures'), filename),
      buttonLabel: '保存',
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await fs.promises.writeFile(result.filePath, buffer, { flag: 'w' });
    return { ok: true, filePath: result.filePath };
  });
  ipcMain.handle('permission:open-screen-settings', (event) => {
    assertSettingsSender(event);
    return openScreenPermissionSettings();
  });
  ipcMain.handle('shell:open-releases', (event) => {
    assertSettingsSender(event);
    return shell.openExternal('https://github.com/Felix-Koh/SnapCut/releases');
  });
  ipcMain.handle('shell:show-item', (event, filePath) => {
    assertSettingsSender(event);
    if (typeof filePath !== 'string' || !fs.existsSync(filePath)) return false;
    shell.showItemInFolder(filePath);
    return true;
  });
  ipcMain.handle('app:quit', (event) => {
    assertSettingsSender(event);
    isQuitting = true;
    app.quit();
    return true;
  });
}

async function initialize() {
  app.setName(APP_NAME);
  if (isMac()) app.setActivationPolicy('accessory');
  if (process.platform === 'win32') app.setAppUserModelId('com.felixkoh.snapcut');
  Menu.setApplicationMenu(null);

  settingsStore = new SettingsStore(app.getPath('userData'));
  const initial = settingsStore.load();
  setLaunchAtLogin(initial.launchAtLogin);
  registerInitialHotkey(initial.hotkey);
  installIpcHandlers();
  createTray();

  const cancelActiveCaptureForDisplayChange = () => {
    if (!captureInProgress && !overlayWindow) return;
    const error = new Error('显示器配置已变化，请重新截图。');
    error.code = 'DISPLAY_CONFIGURATION_CHANGED';
    handleCaptureError(error);
  };
  screen.on('display-added', cancelActiveCaptureForDisplayChange);
  screen.on('display-removed', cancelActiveCaptureForDisplayChange);
  screen.on('display-metrics-changed', (_event, display, changedMetrics) => {
    if (!captureInProgress && !overlayWindow) return;
    if (!app.isPackaged) {
      const displayId = display?.id ?? 'unknown';
      const metricNames = Array.isArray(changedMetrics) ? changedMetrics.join(',') : 'unknown';
      console.debug(
        `[SnapCut] display ${displayId} metrics changed: ${metricNames || 'none'}`,
      );
    }
    if (!displayMetricsAffectCaptureMapping(changedMetrics)) return;
    cancelActiveCaptureForDisplayChange();
  });

  const launchedHidden = process.argv.includes('--autostart') || process.argv.includes('--hidden');
  if (initial.firstRun && !launchedHidden) {
    createSettingsWindow({ show: true });
    settingsStore.update({ firstRun: false });
  }
}

if (singleInstance) {
  app.on('second-instance', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.focus();
    } else {
      showSettings();
    }
  });

  app.whenReady().then(initialize).catch((error) => {
    dialog.showErrorBox(`${APP_NAME} 启动失败`, error?.stack || String(error));
    app.quit();
  });

  app.on('activate', () => {
    if (!overlayWindow) showSettings();
  });
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    isQuitting = true;
    closeOverlay({ destroy: true });
    unregisterHotkey();
  });
}
