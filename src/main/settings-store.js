const fs = require('node:fs');
const path = require('node:path');

const HOTKEY_OPTIONS = Object.freeze({
  darwin: ['Control+Command+A', 'Command+Shift+A', 'Alt+A'],
  win32: ['Alt+A', 'Control+Shift+A', 'Alt+Shift+A'],
});

function platformHotkeys(platform = process.platform) {
  return HOTKEY_OPTIONS[platform] || ['Control+Shift+A', 'Alt+Shift+A'];
}

function defaultSettings(platform = process.platform) {
  return {
    hotkey: platformHotkeys(platform)[0],
    launchAtLogin: false,
    showMagnifier: true,
    firstRun: true,
  };
}

function sanitizeSettings(candidate, platform = process.platform) {
  const defaults = defaultSettings(platform);
  const source = candidate && typeof candidate === 'object' ? candidate : {};
  const allowedHotkeys = platformHotkeys(platform);
  return {
    hotkey: allowedHotkeys.includes(source.hotkey) ? source.hotkey : defaults.hotkey,
    launchAtLogin:
      typeof source.launchAtLogin === 'boolean' ? source.launchAtLogin : defaults.launchAtLogin,
    showMagnifier:
      typeof source.showMagnifier === 'boolean' ? source.showMagnifier : defaults.showMagnifier,
    firstRun: typeof source.firstRun === 'boolean' ? source.firstRun : defaults.firstRun,
  };
}

class SettingsStore {
  constructor(directory, platform = process.platform) {
    this.directory = directory;
    this.platform = platform;
    this.file = path.join(directory, 'settings.json');
    this.data = defaultSettings(platform);
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      this.data = sanitizeSettings(JSON.parse(raw), this.platform);
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
        throw error;
      }
      this.data = defaultSettings(this.platform);
    }
    return { ...this.data };
  }

  get() {
    return { ...this.data };
  }

  update(patch) {
    this.data = sanitizeSettings({ ...this.data, ...patch }, this.platform);
    this.save();
    return this.get();
  }

  save() {
    fs.mkdirSync(this.directory, { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.data, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(temporary, this.file);
  }
}

module.exports = {
  HOTKEY_OPTIONS,
  SettingsStore,
  defaultSettings,
  platformHotkeys,
  sanitizeSettings,
};
