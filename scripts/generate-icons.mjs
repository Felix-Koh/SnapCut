import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import pngToIco from 'png-to-ico';
import sharp from 'sharp';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '..');
const build = path.join(root, 'build');
const assets = path.join(root, 'src', 'assets');
const source = path.join(build, 'icon.svg');

await fs.mkdir(build, { recursive: true });
await fs.mkdir(assets, { recursive: true });

await sharp(source).resize(1024, 1024).png().toFile(path.join(build, 'icon.png'));

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoBuffers = await Promise.all(
  icoSizes.map((size) => sharp(source).resize(size, size).png().toBuffer()),
);
await fs.writeFile(path.join(build, 'icon.ico'), await pngToIco(icoBuffers));

const iconset = path.join(build, 'icon.iconset');
await fs.rm(iconset, { recursive: true, force: true });
await fs.mkdir(iconset, { recursive: true });
const iconsetSizes = [16, 32, 128, 256, 512];
for (const size of iconsetSizes) {
  await sharp(source)
    .resize(size, size)
    .png()
    .toFile(path.join(iconset, `icon_${size}x${size}.png`));
  await sharp(source)
    .resize(size * 2, size * 2)
    .png()
    .toFile(path.join(iconset, `icon_${size}x${size}@2x.png`));
}

if (process.platform === 'darwin') {
  const result = spawnSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(build, 'icon.icns')], {
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
await fs.rm(iconset, { recursive: true, force: true });

const templateSvg = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <g fill="#000">
      <path d="M11 8h18v7H18v13h-7V8Z"/><path d="M53 8H35v7h11v13h7V8Z"/>
      <path d="M11 56h18v-7H18V36h-7v20Z"/><path d="M53 36h-7v13H35v7h18V36Z"/>
      <path d="m35 20-15 19h12l-2 9 15-19H33l2-9Z"/>
    </g>
  </svg>
`);
await sharp(templateSvg).resize(16, 16).png().toFile(path.join(assets, 'trayTemplate.png'));
await sharp(templateSvg).resize(32, 32).png().toFile(path.join(assets, 'trayTemplate@2x.png'));

const traySvg = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <rect x="2" y="2" width="60" height="60" rx="16" fill="#0D9488"/>
    <g fill="#fff"><path d="M12 10h18v7H19v12h-7V10Z"/><path d="M52 10H34v7h11v12h7V10Z"/><path d="M12 54h18v-7H19V35h-7v19Z"/><path d="M52 35h-7v12H34v7h18V35Z"/></g>
    <path d="m35 21-14 18h11l-2 8 14-18H33l2-8Z" fill="#FDE68A"/>
  </svg>
`);
await sharp(traySvg).resize(32, 32).png().toFile(path.join(assets, 'tray.png'));

console.log('Generated SnapCut application and tray icons.');
