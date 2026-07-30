const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const APP_BUNDLE_NAME = 'SnapCut.app';
const HELPER_NAME = 'mac-update-helper.sh';

function resolveMacAppBundle(executablePath) {
  let current = path.resolve(String(executablePath || ''));
  while (current !== path.dirname(current)) {
    if (path.extname(current).toLowerCase() === '.app') return current;
    current = path.dirname(current);
  }
  throw new Error('找不到当前 SnapCut 应用程序位置');
}

function safeUpdateVersion(value) {
  const version = String(value || '').trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('自动升级版本号无效');
  }
  return version;
}

async function prepareMacUpdate({
  dmgPath,
  version,
  executablePath,
  tempDirectory,
  processId = process.pid,
  updateToken = crypto.randomBytes(12).toString('hex'),
  spawnImpl = spawn,
}) {
  const safeVersion = safeUpdateVersion(version);
  const appBundle = resolveMacAppBundle(executablePath);
  if (path.basename(appBundle) !== APP_BUNDLE_NAME) {
    throw new Error('当前应用不是标准的 SnapCut.app，无法安全自动替换');
  }
  const resolvedDmg = path.resolve(String(dmgPath || ''));
  const resolvedTemp = path.resolve(String(tempDirectory || ''));
  if (!/^[a-f0-9]{16,64}$/.test(updateToken)) throw new Error('自动升级任务标识无效');
  const updateDirectory = path.join(resolvedTemp, 'SnapCut Updates');
  if (path.dirname(resolvedDmg) !== updateDirectory || path.extname(resolvedDmg) !== '.dmg') {
    throw new Error('自动升级安装包位置无效');
  }
  if (!fs.existsSync(resolvedDmg) || !fs.existsSync(path.join(appBundle, 'Contents', 'Info.plist'))) {
    throw new Error('自动升级所需文件不完整');
  }

  const helperSource = path.join(__dirname, HELPER_NAME);
  const helperPath = path.join(updateDirectory, `mac-update-${safeVersion}-${updateToken}.sh`);
  const logPath = path.join(updateDirectory, `mac-update-${safeVersion}-${updateToken}.log`);
  const helperContents = await fs.promises.readFile(helperSource, 'utf8');
  await fs.promises.writeFile(helperPath, helperContents, { mode: 0o700, flag: 'w' });

  const child = spawnImpl(
    '/bin/sh',
    [helperPath, resolvedDmg, appBundle, safeVersion, String(processId), updateToken, logPath],
    {
      detached: true,
      stdio: 'ignore',
    },
  );
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.removeAllListeners('error');
  child.on('error', () => {});
  child.unref();
  return { appBundle, helperPath, logPath, updateToken, version: safeVersion };
}

module.exports = {
  prepareMacUpdate,
  resolveMacAppBundle,
  safeUpdateVersion,
};
