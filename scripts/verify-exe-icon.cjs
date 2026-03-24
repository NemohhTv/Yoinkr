'use strict';

/**
 * Proves Yoinkr.exe RT_ICON payloads match build/icon.ico (rules out "embed failed").
 * Usage: node scripts/verify-exe-icon.cjs [path/to/Yoinkr.exe]
 */
const fs = require('node:fs');
const path = require('node:path');
const { Data, NtExecutable, NtExecutableResource } = require('resedit');

const root = path.join(__dirname, '..');
const iconPath = path.join(root, 'build', 'icon.ico');
const defaultExe = path.join(root, 'release', 'win-unpacked', 'Yoinkr.exe');
const exePath = path.resolve(process.argv[2] ?? defaultExe);

if (!fs.existsSync(iconPath) || !fs.existsSync(exePath)) {
  console.error('Need', iconPath, 'and', exePath);
  process.exit(1);
}

const iconFile = Data.IconFile.from(fs.readFileSync(iconPath));
const res = NtExecutableResource.from(NtExecutable.from(fs.readFileSync(exePath)));

let ok = true;
for (let i = 0; i < iconFile.icons.length; i++) {
  const gen = Buffer.from(iconFile.icons[i].data.generate());
  const rt = res.entries.find((e) => e.type === 3 && e.id === i + 1);
  if (!rt) {
    console.error('Missing RT_ICON id', i + 1);
    ok = false;
    break;
  }
  const b = Buffer.from(rt.bin);
  const match = gen.equals(b);
  console.log(`RT_ICON id ${i + 1}: ${gen.length} bytes — ${match ? 'MATCH' : 'MISMATCH'}`);
  if (!match) ok = false;
}

console.log(ok ? '\nOK: embedded icons match build/icon.ico (Explorer may still show a stale thumbnail — clear icon cache).' : '\nFAIL: exe does not match ICO.');
process.exit(ok ? 0 : 1);
