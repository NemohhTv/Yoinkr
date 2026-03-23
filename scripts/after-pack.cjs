'use strict';

/**
 * Embed build/icon.ico into the Windows exe without enabling signAndEditExecutable
 * (that path downloads winCodeSign and can fail on Windows without symlink privileges).
 *
 * Runs after the app is copied to appOutDir but before NSIS/portable targets consume it.
 */
const fs = require('node:fs');
const path = require('node:path');
const rcedit = require('rcedit');

/** @param {import('app-builder-lib').AfterPackContext} context */
module.exports = async (context) => {
  if (context.electronPlatformName !== 'windows') {
    return;
  }

  const projectDir = context.packager.projectDir;
  const iconPath = path.join(projectDir, 'build', 'icon.ico');
  const exePath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`,
  );

  if (!fs.existsSync(iconPath)) {
    console.warn('[afterPack] build/icon.ico not found — exe icon unchanged');
    return;
  }
  if (!fs.existsSync(exePath)) {
    console.warn('[afterPack] exe not found:', exePath);
    return;
  }

  await rcedit(exePath, { icon: iconPath });
  console.log('[afterPack] Set Windows exe icon:', path.basename(exePath));
};
