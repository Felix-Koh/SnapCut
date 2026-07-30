(function initializeSettings() {
  'use strict';

  const elements = {
    capture: document.querySelector('#capture-button'),
    dismissError: document.querySelector('#dismiss-error'),
    errorBanner: document.querySelector('#error-banner'),
    errorMessage: document.querySelector('#error-message'),
    heroHotkey: document.querySelector('#hero-hotkey'),
    hotkey: document.querySelector('#hotkey-select'),
    launch: document.querySelector('#launch-toggle'),
    magnifier: document.querySelector('#magnifier-toggle'),
    permissionButton: document.querySelector('#permission-button'),
    permissionCard: document.querySelector('#permission-card'),
    permissionCopy: document.querySelector('#permission-copy'),
    quit: document.querySelector('#quit-button'),
    releases: document.querySelector('#releases-button'),
    status: document.querySelector('#status-pill'),
    version: document.querySelector('#version-label'),
  };

  let context = null;
  const settingsQueue = [];
  let processingSettingsQueue = false;

  function friendlyHotkey(accelerator, platform) {
    const mac = platform === 'darwin';
    return accelerator
      .replaceAll('Control', mac ? '⌃' : 'Ctrl')
      .replaceAll('Command', mac ? '⌘' : 'Cmd')
      .replaceAll('Shift', mac ? '⇧' : 'Shift')
      .replaceAll('Alt', mac ? '⌥' : 'Alt')
      .replaceAll('+', mac ? '' : ' + ');
  }

  function showError(message) {
    elements.errorMessage.textContent = message;
    elements.errorBanner.hidden = false;
  }

  function hideError() {
    elements.errorBanner.hidden = true;
    elements.errorMessage.textContent = '';
  }

  function applyPendingSettings(settings) {
    return settingsQueue.reduce(
      (nextSettings, entry) => ({ ...nextSettings, ...entry.patch }),
      settings,
    );
  }

  function render(nextContext) {
    if (!nextContext) return;
    context = nextContext;
    // Context updates are also sent when the window regains focus. Keep those
    // fresh permission/status fields without visually rolling back changes
    // that are still waiting to be persisted.
    const settings = applyPendingSettings(nextContext.settings);
    elements.version.textContent = `${nextContext.appName} ${nextContext.version}`;
    elements.heroHotkey.textContent = friendlyHotkey(settings.hotkey, nextContext.platform);
    elements.launch.checked = settings.launchAtLogin;
    elements.magnifier.checked = settings.showMagnifier;

    const optionValues = Array.from(elements.hotkey.options).map((option) => option.value);
    if (
      optionValues.length !== settings.hotkeyOptions.length ||
      !settings.hotkeyOptions.every((value) => optionValues.includes(value))
    ) {
      elements.hotkey.replaceChildren(
        ...settings.hotkeyOptions.map((value) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = friendlyHotkey(value, nextContext.platform);
          return option;
        }),
      );
    }
    elements.hotkey.value = settings.hotkey;

    elements.status.textContent = settings.hotkeyRegistered ? '后台已就绪' : '快捷键不可用';
    elements.status.classList.toggle('is-error', !settings.hotkeyRegistered);

    const isMac = nextContext.platform === 'darwin';
    elements.permissionCard.hidden = !isMac;
    if (isMac) {
      const granted = nextContext.screenPermission === 'granted';
      elements.permissionCopy.textContent = granted
        ? '权限已开启。截图只在本机处理，不会上传。'
        : '首次截图需要授权。若刚刚开启权限，请退出并重新打开 SnapCut。';
      elements.permissionButton.textContent = granted ? '查看权限' : '打开系统设置';
    }

    if (nextContext.lastCaptureError) showError(nextContext.lastCaptureError);
  }

  async function renderReturnedSettings(settings) {
    if (context) {
      render({ ...context, settings });
      return;
    }

    const nextContext = await window.snapcut.getAppContext();
    render({ ...nextContext, settings });
  }

  async function restoreAppContext() {
    const nextContext = await window.snapcut.getAppContext();
    render(nextContext);
  }

  async function processSettingsQueue() {
    if (processingSettingsQueue || !window.snapcut) return;
    processingSettingsQueue = true;
    let batchHadError = false;

    try {
      while (settingsQueue.length > 0) {
        const entry = settingsQueue[0];

        try {
          const result = await window.snapcut.updateSettings(entry.patch);
          settingsQueue.shift();

          if (!result || typeof result !== 'object' || !result.settings) {
            throw new Error('设置没有返回有效结果，请重试。');
          }

          await renderReturnedSettings(result.settings);
          if (!result.ok) {
            batchHadError = true;
            showError(result.error || '设置未能保存，已恢复原来的状态。');
          } else if (!batchHadError) {
            hideError();
          }
        } catch (error) {
          if (settingsQueue[0] === entry) settingsQueue.shift();
          batchHadError = true;
          showError(error.message || String(error));

          try {
            await restoreAppContext();
          } catch {
            // Keep the original, actionable error visible. A later focus
            // refresh will reconcile the controls with the main process.
          }
        }
      }
    } finally {
      processingSettingsQueue = false;
      if (settingsQueue.length > 0) void processSettingsQueue();
    }
  }

  function updateSettings(patch) {
    if (!window.snapcut || !patch || typeof patch !== 'object') return;
    settingsQueue.push({ patch: { ...patch } });
    if (context) render(context);
    void processSettingsQueue();
  }

  elements.capture.addEventListener('click', async () => {
    hideError();
    elements.capture.disabled = true;
    try {
      const result = await window.snapcut?.startCapture();
      if (
        result &&
        !result.ok &&
        result.reason !== 'busy' &&
        result.reason !== 'cancelled'
      ) {
        showError(result.message || '截图没有启动，请检查屏幕录制权限后重试。');
      }
    } catch (error) {
      showError(error.message || String(error));
    } finally {
      elements.capture.disabled = false;
    }
  });
  elements.hotkey.addEventListener('change', () => updateSettings({ hotkey: elements.hotkey.value }));
  elements.launch.addEventListener('change', () =>
    updateSettings({ launchAtLogin: elements.launch.checked }),
  );
  elements.magnifier.addEventListener('change', () =>
    updateSettings({ showMagnifier: elements.magnifier.checked }),
  );
  elements.dismissError.addEventListener('click', hideError);
  elements.permissionButton.addEventListener('click', () => window.snapcut?.openScreenPermission());
  elements.releases.addEventListener('click', () => window.snapcut?.openReleases());
  elements.quit.addEventListener('click', () => window.snapcut?.quit());

  if (window.snapcut) {
    window.snapcut.onSettingsChanged(render);
    window.snapcut.onCaptureError((error) => showError(error.message));
    window.snapcut.getAppContext().then(render).catch((error) => showError(error.message));
  } else {
    render({
      appName: 'SnapCut',
      version: '1.0.1 preview',
      platform: navigator.platform.includes('Mac') ? 'darwin' : 'win32',
      screenPermission: 'granted',
      lastCaptureError: null,
      settings: {
        hotkey: navigator.platform.includes('Mac') ? 'Control+Command+A' : 'Alt+A',
        hotkeyOptions: navigator.platform.includes('Mac')
          ? ['Control+Command+A', 'Command+Shift+A', 'Alt+A']
          : ['Alt+A', 'Control+Shift+A', 'Alt+Shift+A'],
        hotkeyRegistered: true,
        launchAtLogin: false,
        showMagnifier: true,
      },
    });
  }
})();
