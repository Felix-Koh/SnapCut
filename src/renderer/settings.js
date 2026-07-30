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
    tray: document.querySelector('#tray-toggle'),
    trayHelp: document.querySelector('#tray-help'),
    trayLabel: document.querySelector('#tray-label'),
    updateButton: document.querySelector('#update-button'),
    updateDetail: document.querySelector('#update-detail'),
    updateProgress: document.querySelector('#update-progress'),
    updateProgressBar: document.querySelector('#update-progress-bar'),
    updateStatus: document.querySelector('#update-status'),
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

  function renderUpdate(update, platform) {
    const state = update || {
      phase: 'idle',
      currentVersion: context?.version || '',
      latestVersion: null,
      progress: 0,
      message: '尚未检查更新',
    };
    const busy = ['checking', 'downloading', 'installing'].includes(state.phase);
    const available = state.phase === 'available';
    const progress = Math.max(0, Math.min(100, Number(state.progress) || 0));
    elements.updateStatus.textContent = state.message || '尚未检查更新';
    elements.updateButton.disabled = busy || state.phase === 'ready' || state.phase === 'unsupported';
    elements.updateButton.textContent = available
      ? '下载并升级'
      : state.phase === 'checking'
        ? '检查中…'
        : state.phase === 'downloading'
          ? `${progress}%`
          : state.phase === 'installing'
            ? '正在安装…'
          : state.phase === 'ready'
            ? '安装程序已启动'
            : state.phase === 'up-to-date'
              ? '再次检查'
              : '检查更新';
    const showProgress = state.phase === 'downloading' || state.phase === 'installing';
    elements.updateProgress.hidden = !showProgress;
    elements.updateProgress.setAttribute('aria-hidden', String(!showProgress));
    elements.updateProgressBar.style.width = `${progress}%`;
    if (state.phase === 'available') {
      elements.updateDetail.textContent = platform === 'darwin'
        ? `当前 ${state.currentVersion}，最新 ${state.latestVersion}。校验后会自动安装并重新启动。`
        : `当前 ${state.currentVersion}，最新 ${state.latestVersion}。下载后会先校验安装包。`;
    } else if (state.phase === 'installing') {
      elements.updateDetail.textContent = 'SnapCut 将自动退出、替换旧版本并重新启动，请稍候。';
    } else if (state.phase === 'unsupported') {
      elements.updateDetail.textContent = 'SnapCut 仅提供 Windows x64 和 Apple Silicon Mac 安装包。';
    } else {
      elements.updateDetail.textContent = '检查并下载适合当前系统的正式版本。';
    }
  }

  function render(nextContext) {
    if (!nextContext) return;
    context = nextContext;
    // Context updates are also sent when the window regains focus. Keep those
    // fresh permission/status fields without visually rolling back changes
    // that are still waiting to be persisted.
    const settings = applyPendingSettings(nextContext.settings);
    elements.version.textContent = `${nextContext.appName} ${nextContext.version}`;
    renderUpdate(nextContext.update, nextContext.platform);
    elements.heroHotkey.textContent = friendlyHotkey(settings.hotkey, nextContext.platform);
    elements.launch.checked = settings.launchAtLogin;
    elements.tray.checked = settings.showTrayIcon;
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
    elements.trayLabel.textContent = isMac ? '在菜单栏显示图标' : '在系统托盘显示图标';
    elements.trayHelp.textContent = isMac
      ? '隐藏后快捷键仍有效；从“应用程序”重新打开 SnapCut 可恢复。'
      : '隐藏后快捷键仍有效；从开始菜单重新打开 SnapCut 可恢复。';
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
  elements.tray.addEventListener('change', () =>
    updateSettings({ showTrayIcon: elements.tray.checked }),
  );
  elements.magnifier.addEventListener('change', () =>
    updateSettings({ showMagnifier: elements.magnifier.checked }),
  );
  elements.dismissError.addEventListener('click', hideError);
  elements.permissionButton.addEventListener('click', () => window.snapcut?.openScreenPermission());
  elements.updateButton.addEventListener('click', async () => {
    if (!window.snapcut) return;
    hideError();
    elements.updateButton.disabled = true;
    try {
      if (context?.update?.phase === 'available') {
        await window.snapcut.downloadAndInstallUpdate();
      } else {
        await window.snapcut.checkForUpdates();
      }
    } catch (error) {
      showError(error.message || String(error));
    }
  });
  elements.releases.addEventListener('click', () => window.snapcut?.openReleases());
  elements.quit.addEventListener('click', () => window.snapcut?.quit());

  if (window.snapcut) {
    window.snapcut.onSettingsChanged(render);
    window.snapcut.onUpdateChanged((update) => {
      if (!context) return;
      render({ ...context, update });
    });
    window.snapcut.onCaptureError((error) => showError(error.message));
    window.snapcut.getAppContext().then(render).catch((error) => showError(error.message));
  } else {
    render({
      appName: 'SnapCut',
      version: '1.2.7 preview',
      platform: navigator.platform.includes('Mac') ? 'darwin' : 'win32',
      screenPermission: 'granted',
      lastCaptureError: null,
      update: {
        phase: 'available',
        currentVersion: '1.2.0',
        latestVersion: '1.2.7',
        progress: 0,
        message: '发现新版本 1.2.7',
      },
      settings: {
        hotkey: navigator.platform.includes('Mac') ? 'Control+Command+A' : 'Alt+A',
        hotkeyOptions: navigator.platform.includes('Mac')
          ? ['Control+Command+A', 'Command+Shift+A', 'Alt+A']
          : ['Alt+A', 'Control+Shift+A', 'Alt+Shift+A'],
        hotkeyRegistered: true,
        launchAtLogin: false,
        showTrayIcon: true,
        showMagnifier: true,
      },
    });
  }
})();
