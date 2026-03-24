/**
 * Builds build/icon.ico from the in-app Yoinkr mark (renderer asset).
 * Windows .exe icon is applied by electron-builder from build/icon.ico.
 */
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pngToIco from 'png-to-ico';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcPng = join(root, 'src/renderer/assets/yoinkr-icon.png');
const buildDir = join(root, 'build');
const publicDir = join(root, 'src/renderer/public');
const tempSquare = join(buildDir, '.icon-square-256.png');
const outIco = join(buildDir, 'icon.ico');
const faviconIco = join(publicDir, 'favicon.ico');

mkdirSync(buildDir, { recursive: true });
mkdirSync(publicDir, { recursive: true });

/** `contain` + transparent pad — `cover` crops artwork and can hide transparency at the edges. */
await sharp(srcPng)
  .ensureAlpha()
  .resize(256, 256, {
    fit: 'contain',
    position: 'centre',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toFile(tempSquare);

const icoBuffer = await pngToIco(tempSquare);
writeFileSync(outIco, icoBuffer);
/** Same .ico as Windows exe / window icon — used by packaged index.html favicon. */
writeFileSync(faviconIco, icoBuffer);

try {
  unlinkSync(tempSquare);
} catch {
  // ignore
}

console.log(`Wrote ${outIco}`);
console.log(`Wrote ${faviconIco}`);
