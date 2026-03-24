'use strict';

/**
 * Manually re-embed `build/icon.ico` into `release/win-unpacked/Yoinkr.exe` without a full dist.
 * Usage: node scripts/embed-exe-icon.cjs [path/to/Yoinkr.exe]
 */
const fs = require('node:fs');
const path = require('node:path');
const { NtExecutable, NtExecutableResource, Data, Resource } = require('resedit');

const root = path.join(__dirname, '..');
const iconPath = path.join(root, 'build', 'icon.ico');
const defaultExe = path.join(root, 'release', 'win-unpacked', 'Yoinkr.exe');
const exePath = path.resolve(process.argv[2] ?? defaultExe);

if (!fs.existsSync(iconPath)) {
  console.error('Missing', iconPath, '— run: npm run build:icon');
  process.exit(1);
}
if (!fs.existsSync(exePath)) {
  console.error('Missing exe:', exePath);
  process.exit(1);
}

const iconFile = Data.IconFile.from(fs.readFileSync(iconPath));
const iconImages = iconFile.icons.map((item) => item.data);
const exeBuffer = fs.readFileSync(exePath);
const executable = NtExecutable.from(exeBuffer);
const res = NtExecutableResource.from(executable);
const groups = Resource.IconGroupEntry.fromEntries(res.entries);

if (groups.length === 0) {
  Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, iconImages);
} else {
  for (const g of groups) {
    Resource.IconGroupEntry.replaceIconsForResource(res.entries, g.id, g.lang, iconImages);
  }
}

res.outputResource(executable);
fs.writeFileSync(exePath, Buffer.from(executable.generate()));

/** Prove PE icon bytes match ICO (Explorer often shows a cached Electron thumbnail anyway). */
const verify = NtExecutableResource.from(NtExecutable.from(fs.readFileSync(exePath)));
let allMatch = true;
for (let i = 0; i < iconFile.icons.length; i++) {
  const gen = Buffer.from(iconFile.icons[i].data.generate());
  const rt = verify.entries.find((e) => e.type === 3 && e.id === i + 1);
  if (!rt || !gen.equals(Buffer.from(rt.bin))) {
    allMatch = false;
    break;
  }
}

console.log('Embedded icon into', exePath);
console.log(allMatch ? 'Verify: all RT_ICON layers byte-match build/icon.ico (if Explorer still shows Electron, it is icon cache — run: npm run refresh-icon-cache)' : 'Verify: WARNING — mismatch after write (unexpected)');
