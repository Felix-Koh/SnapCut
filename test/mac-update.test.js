const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');

const {
  prepareMacUpdate,
  resolveMacAppBundle,
  safeUpdateVersion,
} = require('../src/main/mac-update');

const helperPath = path.join(__dirname, '..', 'src', 'main', 'mac-update-helper.sh');

test('macOS updater resolves only an enclosing app bundle and validates versions', () => {
  assert.equal(
    resolveMacAppBundle('/Applications/SnapCut.app/Contents/MacOS/SnapCut'),
    '/Applications/SnapCut.app',
  );
  assert.equal(safeUpdateVersion('1.2.5'), '1.2.5');
  assert.throws(() => resolveMacAppBundle('/usr/local/bin/SnapCut'), /找不到/);
  assert.throws(() => safeUpdateVersion('1.2.5; reboot'), /版本号无效/);
});

test('macOS updater writes a private helper and launches it detached with positional arguments', async (context) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'snapcut-mac-update-'));
  context.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const updateDirectory = path.join(root, 'SnapCut Updates');
  const dmgPath = path.join(updateDirectory, 'SnapCut-1.2.5-macos-arm64.dmg');
  const appBundle = path.join(root, 'Applications', 'SnapCut.app');
  const executablePath = path.join(appBundle, 'Contents', 'MacOS', 'SnapCut');
  await fs.promises.mkdir(updateDirectory, { recursive: true });
  await fs.promises.mkdir(path.join(appBundle, 'Contents'), { recursive: true });
  await fs.promises.writeFile(dmgPath, 'verified dmg placeholder');
  await fs.promises.writeFile(path.join(appBundle, 'Contents', 'Info.plist'), 'plist');

  let invocation;
  const spawnImpl = (command, args, options) => {
    invocation = { command, args, options };
    const child = new EventEmitter();
    child.unref = () => { invocation.unref = true; };
    setImmediate(() => child.emit('spawn'));
    return child;
  };
  const updateToken = 'a'.repeat(24);
  const result = await prepareMacUpdate({
    dmgPath,
    version: '1.2.5',
    executablePath,
    tempDirectory: root,
    processId: 4321,
    updateToken,
    spawnImpl,
  });

  assert.equal(invocation.command, '/bin/sh');
  assert.deepEqual(invocation.args, [
    result.helperPath,
    dmgPath,
    appBundle,
    '1.2.5',
    '4321',
    updateToken,
    result.logPath,
  ]);
  assert.deepEqual(invocation.options, { detached: true, stdio: 'ignore' });
  assert.equal(invocation.unref, true);
  assert.equal((await fs.promises.stat(result.helperPath)).mode & 0o777, 0o700);
});

test('macOS helper validates, stages, rolls back, and relaunches without opening the DMG UI', () => {
  const helper = fs.readFileSync(helperPath, 'utf8');
  assert.match(helper, /hdiutil attach[\s\S]*-nobrowse[\s\S]*-readonly/);
  assert.match(helper, /CFBundleIdentifier[\s\S]*com\.felixkoh\.snapcut/);
  assert.match(helper, /CFBundleShortVersionString/);
  assert.match(helper, /file "\$SOURCE_EXECUTABLE"[\s\S]*arm64/);
  assert.match(helper, /ditto "\$SOURCE_APP" "\$STAGED_APP"/);
  assert.match(helper, /mv "\$TARGET_APP" "\$BACKUP_APP"/);
  assert.match(helper, /fail_update "新版本启动后意外退出"/);
  assert.match(helper, /open -n "\$TARGET_APP" --args --snapcut-update-complete/);
  assert.doesNotMatch(helper, /open "\$DMG_PATH"/);

  if (process.platform !== 'win32') {
    const syntax = spawnSync('/bin/sh', ['-n', helperPath], { encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
  }
});

test('settings describe and lock the fully automatic macOS install phase', () => {
  const renderer = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'settings.js'),
    'utf8',
  );
  assert.match(renderer, /'checking', 'downloading', 'installing'/);
  assert.match(renderer, /校验后会自动安装并重新启动/);
  assert.match(renderer, /SnapCut 将自动退出、替换旧版本并重新启动/);
  assert.doesNotMatch(renderer, /请在已打开的 DMG 中将 SnapCut 拖入/);
});
