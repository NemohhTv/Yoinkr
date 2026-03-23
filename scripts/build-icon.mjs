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
const tempSquare = join(buildDir, '.icon-square-256.png');
const outIco = join(buildDir, 'icon.ico');

mkdirSync(buildDir, { recursive: true });

await sharp(srcPng)
  .resize(256, 256, { fit: 'cover', position: 'centre' })
  .png()
  .toFile(tempSquare);

const icoBuffer = await pngToIco(tempSquare);
writeFileSync(outIco, icoBuffer);

try {
  unlinkSync(tempSquare);
} catch {
  // ignore
}

console.log(`Wrote ${outIco}`);
