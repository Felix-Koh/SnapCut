const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const RELEASE_API = 'https://api.github.com/repos/Felix-Koh/SnapCut/releases/latest';
const RELEASE_PAGE = 'https://github.com/Felix-Koh/SnapCut/releases/latest';
const CHECKSUM_ASSET = 'SHA256SUMS.txt';
const MAX_CHECKSUM_BYTES = 64 * 1024;
const MAX_INSTALLER_BYTES = 350 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

const CERTIFICATE_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_CERT_AUTHORITY_INVALID',
  'ERR_CERT_DATE_INVALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

function normalizeVersion(value) {
  const normalized = String(value || '').trim().replace(/^v/i, '');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalized)) {
    throw new Error('版本号格式无效');
  }
  return normalized;
}

function versionParts(value) {
  const [core, prerelease = ''] = normalizeVersion(value).split('-', 2);
  return {
    core: core.split('.').map(Number),
    prerelease: prerelease ? prerelease.split('.') : [],
  };
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (a.prerelease[index] === undefined) return -1;
    if (b.prerelease[index] === undefined) return 1;
    if (a.prerelease[index] === b.prerelease[index]) continue;
    const aNumber = /^\d+$/.test(a.prerelease[index]);
    const bNumber = /^\d+$/.test(b.prerelease[index]);
    if (aNumber && bNumber) return Number(a.prerelease[index]) > Number(b.prerelease[index]) ? 1 : -1;
    if (aNumber !== bNumber) return aNumber ? -1 : 1;
    return a.prerelease[index].localeCompare(b.prerelease[index]);
  }
  return 0;
}

function installerName(version, platform, arch) {
  const safeVersion = normalizeVersion(version);
  if (platform === 'win32' && arch === 'x64') {
    return `SnapCut-${safeVersion}-windows-x64.exe`;
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return `SnapCut-${safeVersion}-macos-arm64.dmg`;
  }
  return null;
}

function assertHttpsUrl(value, allowedHosts = ALLOWED_DOWNLOAD_HOSTS) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('更新下载地址无效');
  }
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) {
    throw new Error('更新下载地址不受信任');
  }
  return url.href;
}

function validateRelease(payload, currentVersion, platform, arch) {
  if (!payload || typeof payload !== 'object' || payload.draft || payload.prerelease) {
    throw new Error('GitHub 没有返回有效的正式版本');
  }
  const version = normalizeVersion(payload.tag_name);
  const expectedInstaller = installerName(version, platform, arch);
  if (!expectedInstaller) {
    return {
      supported: false,
      currentVersion: normalizeVersion(currentVersion),
      latestVersion: version,
      releasePage: RELEASE_PAGE,
    };
  }
  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  const installer = assets.find((asset) => asset?.name === expectedInstaller);
  const checksum = assets.find((asset) => asset?.name === CHECKSUM_ASSET);
  if (!installer || !checksum) throw new Error('新版本安装包或校验文件尚未准备完整');
  if (!Number.isSafeInteger(installer.size) || installer.size <= 0 || installer.size > MAX_INSTALLER_BYTES) {
    throw new Error('新版本安装包大小异常');
  }
  return {
    supported: true,
    available: compareVersions(version, currentVersion) > 0,
    currentVersion: normalizeVersion(currentVersion),
    latestVersion: version,
    releasePage: RELEASE_PAGE,
    installer: {
      name: expectedInstaller,
      size: installer.size,
      url: assertHttpsUrl(installer.browser_download_url),
    },
    checksumUrl: assertHttpsUrl(checksum.browser_download_url),
  };
}

function checksumForFile(contents, filename) {
  for (const line of String(contents).split(/\r?\n/)) {
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (match && match[2] === filename) return match[1].toLowerCase();
  }
  throw new Error('校验文件中没有当前系统的安装包记录');
}

function readableNetworkError(error) {
  const code = String(error?.cause?.code || error?.code || '').toUpperCase();
  const detail = `${error?.message || ''} ${error?.cause?.message || ''}`;
  const certificateFailure =
    CERTIFICATE_ERROR_CODES.has(code) ||
    /(?:CERT_|CERTIFICATE|SELF.SIGNED|UNABLE_TO_VERIFY)/i.test(detail);

  if (certificateFailure) {
    return new Error(
      '系统无法验证 GitHub 下载服务器的安全证书，请检查代理、VPN 或系统证书后重试。',
      { cause: error },
    );
  }
  if (
    error?.name === 'TypeError' ||
    /(?:fetch failed|ERR_(?:CONNECTION|NETWORK|PROXY|TIMED_OUT)|ENOTFOUND|ECONN)/i.test(detail)
  ) {
    return new Error(
      '无法连接 GitHub 下载服务器，请检查网络、代理或 VPN 后重试。',
      { cause: error },
    );
  }
  return error;
}

function createElectronFetch(electronNet) {
  if (!electronNet?.request) throw new Error('系统网络服务不可用');
  return (url, options = {}) => new Promise((resolve, reject) => {
    const request = electronNet.request({
      url,
      method: options.method || 'GET',
      redirect: 'manual',
    });
    let settled = false;
    let finalUrl = url;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', abort);
      callback(value);
    };
    const abort = () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      request.abort();
      finish(reject, error);
    };

    for (const [name, value] of Object.entries(options.headers || {})) {
      request.setHeader(name, value);
    }
    request.on('redirect', (_statusCode, _method, redirectUrl) => {
      try {
        finalUrl = assertHttpsUrl(redirectUrl);
        request.followRedirect();
      } catch (error) {
        request.abort();
        finish(reject, error);
      }
    });
    request.on('response', (response) => {
      const headers = new Headers();
      for (const [name, values] of Object.entries(response.headers || {})) {
        for (const value of Array.isArray(values) ? values : [values]) {
          if (value !== undefined) headers.append(name, String(value));
        }
      }
      finish(resolve, {
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode,
        url: finalUrl,
        headers,
        body: response,
      });
    });
    request.on('error', (error) => finish(reject, error));
    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    request.end();
  });
}

async function request(fetchImpl, url, { timeoutMs, maxBytes, accept }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: accept,
        'User-Agent': 'SnapCut-Desktop-Updater',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) throw new Error(`更新服务器返回了 ${response.status}`);
    if (url !== RELEASE_API) assertHttpsUrl(response.url);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxBytes) throw new Error('更新文件超过允许大小');
    return { response, clearTimer: () => clearTimeout(timer) };
  } catch (error) {
    clearTimeout(timer);
    if (error?.name === 'AbortError') throw new Error('连接更新服务器超时');
    throw readableNetworkError(error);
  }
}

async function readLimitedResponse(response, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > maxBytes) throw new Error('更新服务器返回的数据过大');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

class UpdateService {
  constructor({ currentVersion, platform, arch, tempDirectory, fetchImpl = globalThis.fetch }) {
    this.currentVersion = normalizeVersion(currentVersion);
    this.platform = platform;
    this.arch = arch;
    this.tempDirectory = tempDirectory;
    this.fetchImpl = fetchImpl;
    this.release = null;
    this.busy = false;
  }

  async check() {
    if (this.busy) throw new Error('正在执行更新操作，请稍候');
    this.busy = true;
    try {
      const { response, clearTimer } = await request(this.fetchImpl, RELEASE_API, {
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxBytes: 1024 * 1024,
        accept: 'application/vnd.github+json',
      });
      let buffer;
      try {
        buffer = await readLimitedResponse(response, 1024 * 1024);
      } finally {
        clearTimer();
      }
      let payload;
      try {
        payload = JSON.parse(buffer.toString('utf8'));
      } catch {
        throw new Error('更新服务器返回的数据无法识别');
      }
      this.release = validateRelease(payload, this.currentVersion, this.platform, this.arch);
      return { ...this.release, installer: undefined, checksumUrl: undefined };
    } finally {
      this.busy = false;
    }
  }

  async download(onProgress = () => {}) {
    if (this.busy) throw new Error('正在执行更新操作，请稍候');
    if (!this.release?.supported || !this.release.available) throw new Error('当前没有可下载的新版本');
    this.busy = true;
    const updateDirectory = path.join(this.tempDirectory, 'SnapCut Updates');
    const finalPath = path.join(updateDirectory, this.release.installer.name);
    const partialPath = `${finalPath}.part`;
    let file;
    try {
      await fs.promises.mkdir(updateDirectory, { recursive: true, mode: 0o700 });
      await fs.promises.rm(partialPath, { force: true });

      const checksumRequest = await request(this.fetchImpl, this.release.checksumUrl, {
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxBytes: MAX_CHECKSUM_BYTES,
        accept: 'text/plain',
      });
      let checksumBuffer;
      try {
        checksumBuffer = await readLimitedResponse(checksumRequest.response, MAX_CHECKSUM_BYTES);
      } finally {
        checksumRequest.clearTimer();
      }
      const expectedHash = checksumForFile(checksumBuffer.toString('utf8'), this.release.installer.name);

      const downloadRequest = await request(this.fetchImpl, this.release.installer.url, {
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        maxBytes: MAX_INSTALLER_BYTES,
        accept: 'application/octet-stream',
      });
      const hash = crypto.createHash('sha256');
      let received = 0;
      file = await fs.promises.open(partialPath, 'w', 0o600);
      try {
        for await (const chunk of downloadRequest.response.body) {
          received += chunk.byteLength;
          if (received > MAX_INSTALLER_BYTES || received > this.release.installer.size) {
            throw new Error('下载的安装包大小异常');
          }
          const buffer = Buffer.from(chunk);
          hash.update(buffer);
          let offset = 0;
          while (offset < buffer.byteLength) {
            const { bytesWritten } = await file.write(
              buffer,
              offset,
              buffer.byteLength - offset,
              null,
            );
            if (bytesWritten <= 0) throw new Error('安装包写入失败');
            offset += bytesWritten;
          }
          onProgress({ received, total: this.release.installer.size });
        }
      } finally {
        downloadRequest.clearTimer();
        await file.close();
        file = null;
      }
      if (received !== this.release.installer.size) throw new Error('安装包下载不完整');
      if (hash.digest('hex') !== expectedHash) throw new Error('安装包校验失败，请重新下载');
      await fs.promises.rm(finalPath, { force: true });
      await fs.promises.rename(partialPath, finalPath);
      return { filePath: finalPath, version: this.release.latestVersion };
    } catch (error) {
      if (file) await file.close().catch(() => {});
      await fs.promises.rm(partialPath, { force: true }).catch(() => {});
      throw error;
    } finally {
      this.busy = false;
    }
  }
}

module.exports = {
  ALLOWED_DOWNLOAD_HOSTS,
  RELEASE_API,
  UpdateService,
  checksumForFile,
  compareVersions,
  createElectronFetch,
  installerName,
  readableNetworkError,
  validateRelease,
};
