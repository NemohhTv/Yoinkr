'use strict';

/**
 * Replace Windows PE icon resources on the packaged exe using **resedit** (same library Electron
 * uses for ASAR integrity). `rcedit` / `app-builder rcedit` often leave Explorer showing the stock
 * Electron atom because they don’t reliably rewrite `RT_ICON_GROUP` / `RT_ICON` the way Explorer reads.
 *
 * @see https://github.com/jet2jet/resedit-js#replace-icons
 */
const fs = require('node:fs');
const path = require('node:path');
const { NtExecutable, NtExecutableResource, Data, Resource } = require('resedit');

/** @param {import('app-builder-lib').AfterPackContext} context */
module.exports = async (context) => {
  if (context.electronPlatformName !== 'windows') {
    return;
  }

  const projectDir = path.resolve(context.packager.projectDir);
  const iconPath = path.resolve(projectDir, 'build', 'icon.ico');

  const productExe = `${context.packager.appInfo.productFilename}.exe`;
  let exePath = path.resolve(context.appOutDir, productExe);

  if (!fs.existsSync(iconPath)) {
    throw new Error(`[afterPack] Missing ${iconPath}. Run "npm run build:icon" before packaging.`);
  }

  if (!fs.existsSync(exePath)) {
    const candidates = fs
      .readdirSync(context.appOutDir)
      .filter((f) => f.endsWith('.exe') && !f.includes('uninstall') && !f.includes('elevate'));
    const fallback = candidates.find((f) => f.toLowerCase() === productExe.toLowerCase()) ?? candidates[0];
    if (fallback) {
      exePath = path.resolve(context.appOutDir, fallback);
    }
  }

  if (!fs.existsSync(exePath)) {
    throw new Error(`[afterPack] Could not find main executable in ${context.appOutDir}`);
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
  // eslint-disable-next-line no-console
  console.log('[afterPack] PE icon resources replaced via resedit:', path.basename(exePath));
};
