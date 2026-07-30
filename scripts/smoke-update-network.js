const { app, net } = require('electron');

const { UpdateService, createElectronFetch } = require('../src/main/update-service');

async function main() {
  const systemFetch = createElectronFetch(net);
  const service = new UpdateService({
    currentVersion: '0.0.1',
    platform: process.platform,
    arch: process.arch,
    tempDirectory: app.getPath('temp'),
    fetchImpl: systemFetch,
  });
  const release = await service.check();
  if (!release.supported || !release.available) {
    throw new Error('Latest Release did not contain an update for this system');
  }

  const checksumUrl = `https://github.com/Felix-Koh/SnapCut/releases/download/v${release.latestVersion}/SHA256SUMS.txt`;
  const response = await systemFetch(checksumUrl, {
    redirect: 'follow',
    headers: {
      Accept: 'text/plain',
      'User-Agent': 'SnapCut-Desktop-Updater-Smoke-Test',
    },
  });
  if (!response.ok) throw new Error(`Checksum request returned ${response.status}`);
  const chunks = [];
  for await (const chunk of response.body) chunks.push(Buffer.from(chunk));
  const checksum = Buffer.concat(chunks).toString('utf8');
  if (!checksum.includes(`SnapCut-${release.latestVersion}-macos-arm64.dmg`)) {
    throw new Error('Checksum file did not contain the Apple Silicon package');
  }
  if (!checksum.includes(`SnapCut-${release.latestVersion}-windows-x64.exe`)) {
    throw new Error('Checksum file did not contain the Windows package');
  }
  process.stdout.write(
    `Electron network smoke test passed for SnapCut ${release.latestVersion}\n${response.url}\n`,
  );
}

app.whenReady()
  .then(main)
  .then(() => app.quit())
  .catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    app.exit(1);
  });
