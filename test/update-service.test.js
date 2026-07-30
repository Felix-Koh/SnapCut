const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

const {
  UpdateService,
  checksumForFile,
  compareVersions,
  createElectronFetch,
  installerName,
  readableNetworkError,
  validateRelease,
} = require('../src/main/update-service');

function response(body, url, contentType = 'application/octet-stream') {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return {
    ok: true,
    status: 200,
    url,
    headers: new Headers({
      'content-length': String(buffer.byteLength),
      'content-type': contentType,
    }),
    body: Readable.from([buffer]),
  };
}

function releasePayload(version, installer, installerBytes) {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    assets: [
      {
        name: installer,
        size: installerBytes,
        browser_download_url: `https://github.com/Felix-Koh/SnapCut/releases/download/v${version}/${installer}`,
      },
      {
        name: 'SHA256SUMS.txt',
        size: 100,
        browser_download_url: `https://github.com/Felix-Koh/SnapCut/releases/download/v${version}/SHA256SUMS.txt`,
      },
    ],
  };
}

test('version comparison handles stable and prerelease versions', () => {
  assert.equal(compareVersions('1.2.0', '1.1.9'), 1);
  assert.equal(compareVersions('1.2.0', '1.2.0'), 0);
  assert.equal(compareVersions('1.2.0-beta.2', '1.2.0'), -1);
  assert.equal(compareVersions('1.2.0-beta.10', '1.2.0-beta.2'), 1);
});

test('release validation accepts only the exact platform installer', () => {
  const installer = installerName('1.2.0', 'darwin', 'arm64');
  const result = validateRelease(releasePayload('1.2.0', installer, 1234), '1.1.0', 'darwin', 'arm64');
  assert.equal(result.available, true);
  assert.equal(result.installer.name, 'SnapCut-1.2.0-macos-arm64.dmg');
  assert.throws(
    () => validateRelease(releasePayload('1.2.0', 'SnapCut-1.2.0-macos-x64.dmg', 1234), '1.1.0', 'darwin', 'arm64'),
    /安装包或校验文件尚未准备完整/,
  );
});

test('checksum parser requires an exact asset filename', () => {
  const hash = 'a'.repeat(64);
  assert.equal(checksumForFile(`${hash}  SnapCut-1.2.0-windows-x64.exe\n`, 'SnapCut-1.2.0-windows-x64.exe'), hash);
  assert.throws(() => checksumForFile(`${hash}  another.exe\n`, 'SnapCut-1.2.0-windows-x64.exe'));
});

test('updater translates a generic fetch failure into an actionable message', async () => {
  const fetchImpl = async () => {
    throw new TypeError('fetch failed');
  };
  const service = new UpdateService({
    currentVersion: '1.2.2',
    platform: 'darwin',
    arch: 'arm64',
    tempDirectory: os.tmpdir(),
    fetchImpl,
  });

  await assert.rejects(
    () => service.check(),
    /无法连接 GitHub 下载服务器，请检查网络、代理或 VPN 后重试/,
  );
});

test('updater explains certificate failures without disabling verification', () => {
  const failure = new TypeError('fetch failed');
  failure.cause = Object.assign(new Error('self-signed certificate in certificate chain'), {
    code: 'SELF_SIGNED_CERT_IN_CHAIN',
  });

  assert.match(
    readableNetworkError(failure).message,
    /无法验证 GitHub 下载服务器的安全证书.*代理、VPN 或系统证书/,
  );
});

test('Electron system network adapter rejects redirects outside the trusted hosts', async () => {
  class FakeRequest extends EventEmitter {
    setHeader() {}

    abort() {}

    followRedirect() {
      assert.fail('An untrusted redirect must not be followed');
    }

    end() {
      setImmediate(() => this.emit('redirect', 302, 'GET', 'https://example.com/update.exe'));
    }
  }

  const systemFetch = createElectronFetch({ request: () => new FakeRequest() });
  await assert.rejects(
    () => systemFetch('https://github.com/Felix-Koh/SnapCut/releases/download/v1.2.3/test'),
    /更新下载地址不受信任/,
  );
});

test('main process injects the Electron system network adapter into the updater', async () => {
  const mainSource = await fs.promises.readFile(
    path.join(__dirname, '..', 'src', 'main', 'index.js'),
    'utf8',
  );
  assert.match(mainSource, /\bnet,\s*\n\s*screen,/);
  assert.match(mainSource, /fetchImpl:\s*createElectronFetch\(net\)/);
});

test('updater downloads, verifies, and atomically keeps a valid installer', async (context) => {
  const installer = 'SnapCut-1.2.0-windows-x64.exe';
  const installerBody = Buffer.from('verified installer bytes');
  const hash = crypto.createHash('sha256').update(installerBody).digest('hex');
  const payload = releasePayload('1.2.0', installer, installerBody.byteLength);
  const tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'snapcut-update-'));
  context.after(() => fs.promises.rm(tempDirectory, { recursive: true, force: true }));
  const fetchImpl = async (url) => {
    if (url.includes('api.github.com')) {
      return response(JSON.stringify(payload), url, 'application/json');
    }
    if (url.endsWith('SHA256SUMS.txt')) {
      return response(`${hash}  ${installer}\n`, url, 'text/plain');
    }
    return response(installerBody, url);
  };
  const service = new UpdateService({
    currentVersion: '1.1.0',
    platform: 'win32',
    arch: 'x64',
    tempDirectory,
    fetchImpl,
  });

  const check = await service.check();
  assert.equal(check.available, true);
  const progress = [];
  const download = await service.download((value) => progress.push(value));
  assert.deepEqual(await fs.promises.readFile(download.filePath), installerBody);
  assert.equal(progress.at(-1).received, installerBody.byteLength);
});

test('updater deletes a partial installer when SHA-256 verification fails', async (context) => {
  const installer = 'SnapCut-1.2.0-windows-x64.exe';
  const installerBody = Buffer.from('tampered installer bytes');
  const payload = releasePayload('1.2.0', installer, installerBody.byteLength);
  const tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'snapcut-update-bad-'));
  context.after(() => fs.promises.rm(tempDirectory, { recursive: true, force: true }));
  const fetchImpl = async (url) => {
    if (url.includes('api.github.com')) return response(JSON.stringify(payload), url, 'application/json');
    if (url.endsWith('SHA256SUMS.txt')) return response(`${'0'.repeat(64)}  ${installer}\n`, url, 'text/plain');
    return response(installerBody, url);
  };
  const service = new UpdateService({
    currentVersion: '1.1.0',
    platform: 'win32',
    arch: 'x64',
    tempDirectory,
    fetchImpl,
  });

  await service.check();
  await assert.rejects(() => service.download(), /校验失败/);
  const updateDirectory = path.join(tempDirectory, 'SnapCut Updates');
  assert.deepEqual(await fs.promises.readdir(updateDirectory), []);
});
