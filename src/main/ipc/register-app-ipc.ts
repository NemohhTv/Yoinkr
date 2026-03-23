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

    shell.showItemInFolder(targetPath);
    return ok(true);
  });
};
