import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { app, ipcMain, shell } from 'electron';

import type { AppContext } from '@main/services/app-context';
import { APP_NAME, MANAGED_DIRECTORY_KEYS } from '@shared/constants/app';
import { ipcChannels } from '@shared/contracts/channels';

import { fail, ok } from './result';

export const registerAppIpc = (context: AppContext): void => {
  ipcMain.handle(ipcChannels.appGetBootstrapState, async () => {
    const paths = context.pathsService.getPaths();
    const settings = context.settingsService.getSettings();
    return ok({
      appName: APP_NAME,
      appVersion: app.getVersion(),
      platform: process.platform,
      firstRun: !settings.legalNoticeAccepted,
      managedDirectories: MANAGED_DIRECTORY_KEYS.map((key) => ({
        key,
        path: paths.managedDirectories[key],
      })),
    });
  });

  ipcMain.handle(ipcChannels.appRevealPath, async (_event, targetPath: string) => {
    if (!targetPath) {
      return fail('INVALID_PATH', 'A valid path is required.');
    }

    if (existsSync(targetPath)) {
      shell.showItemInFolder(targetPath);
      return ok(true);
    }

    const parentDir = dirname(targetPath);
    if (existsSync(parentDir)) {
      shell.openPath(parentDir);
      return ok(true);
    }

    return fail('FILE_NOT_FOUND', `File not found: ${targetPath}`);
  });

  ipcMain.handle(ipcChannels.appOpenDownloadLogsDirectory, async () => {
    const logDir = join(context.pathsService.getPaths().managedDirectories.logs, 'downloads');
    try {
      mkdirSync(logDir, { recursive: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail('LOG_DIR_FAILED', message);
    }
    const errMsg = await shell.openPath(logDir);
    if (errMsg) {
      return fail('OPEN_FAILED', errMsg);
    }
    return ok(true);
  });
};
