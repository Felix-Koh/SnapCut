import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '..');
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const { validateConfiguration } = require('app-builder-lib/out/util/config/config');

function walk(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(folder, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    return [absolute];
  });
}

const JavaScriptFiles = [
  ...walk(path.join(root, 'src')).filter((file) => file.endsWith('.js')),
  ...walk(path.join(root, 'scripts')).filter((file) => file.endsWith('.mjs')),
  ...walk(path.join(root, 'test')).filter((file) => file.endsWith('.js')),
];

for (const file of JavaScriptFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

const requiredFiles = [
  'build/icon.png',
  'build/icon.ico',
  'build/icon.icns',
  'src/assets/tray.png',
  'src/assets/trayTemplate.png',
  'src/assets/trayTemplate@2x.png',
  'src/renderer/overlay.html',
  'src/renderer/settings.html',
];
for (const relative of requiredFiles) {
  if (!fs.existsSync(path.join(root, relative))) {
    console.error(`Missing required release file: ${relative}. Run npm run icons first.`);
    process.exit(1);
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (packageJson.private !== true) {
  console.error('This desktop application must remain private to prevent accidental npm publishing.');
  process.exit(1);
}
if (
  packageJson.devDependencies?.electron !== '43.2.0' ||
  packageJson.devDependencies?.['electron-builder'] !== '26.15.3'
) {
  console.error('Electron and electron-builder must stay pinned to the verified release versions.');
  process.exit(1);
}

try {
  await validateConfiguration(packageJson.build, {
    isEnabled: false,
    add() {},
  });
} catch (error) {
  console.error(error?.message || String(error));
  process.exit(1);
}

if (
  packageJson.build?.mac?.artifactName !== '${productName}-${version}-macos-${arch}.${ext}' ||
  packageJson.build?.win?.artifactName !== '${productName}-${version}-windows-${arch}.${ext}'
) {
  console.error('Release artifact names must include the platform and architecture.');
  process.exit(1);
}
if (!packageJson.build?.files?.includes('build/icon.ico')) {
  console.error('The Windows tray ICO must be included in the packaged application.');
  process.exit(1);
}
if (packageJson.build?.appId !== 'com.felixkoh.snapcut') {
  console.error('The stable application identifier changed unexpectedly.');
  process.exit(1);
}
if (
  packageJson.build?.mac?.identity !== null ||
  packageJson.build?.mac?.notarize !== false ||
  packageJson.build?.win?.signExecutable !== false
) {
  console.error('The v1 release must remain explicitly unsigned on macOS and Windows.');
  process.exit(1);
}
if (
  JSON.stringify(packageJson.build?.mac?.target) !== JSON.stringify(['dmg', 'zip']) ||
  packageJson.build?.win?.target?.[0]?.target !== 'nsis' ||
  JSON.stringify(packageJson.build?.win?.target?.[0]?.arch) !== JSON.stringify(['x64'])
) {
  console.error('Release targets must remain one Windows x64 installer and macOS DMG/ZIP packages.');
  process.exit(1);
}

const workflowPath = path.join(root, '.github', 'workflows', 'release.yml');
let workflow;
try {
  workflow = yaml.load(fs.readFileSync(workflowPath, 'utf8'));
} catch (error) {
  console.error(`Invalid release workflow YAML: ${error?.message || error}`);
  process.exit(1);
}
const macMatrix = workflow?.jobs?.['build-macos']?.strategy?.matrix?.include;
const expectedMacMatrix = [
  { arch: 'x64', binary_arch: 'x86_64', runner: 'macos-15-intel' },
  { arch: 'arm64', binary_arch: 'arm64', runner: 'macos-15' },
];
if (
  !workflow?.jobs?.['build-windows'] ||
  !workflow?.jobs?.['publish-release'] ||
  JSON.stringify(macMatrix) !== JSON.stringify(expectedMacMatrix)
) {
  console.error('Release workflow platform matrix is incomplete or has an unexpected architecture mapping.');
  process.exit(1);
}

const tests = spawnSync(process.execPath, ['--test'], { cwd: root, stdio: 'inherit' });
if (tests.status !== 0) process.exit(tests.status || 1);

console.log(`Checked ${JavaScriptFiles.length} JavaScript files and all release assets.`);
