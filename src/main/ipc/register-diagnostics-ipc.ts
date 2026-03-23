import { app, ipcMain } from 'electron';

import type { AppContext } from '@main/services/app-context';
import { ipcChannels } from '@shared/contracts/channels';

import { ok } from './result';

export const registerDiagnosticsIpc = (context: AppContext): void => {
  ipcMain.handle(ipcChannels.diagnosticsGetAppInfo, async () => {
    const paths = context.pathsService.getPaths();

    return ok({
      appVersion: app.getVersion(),
      userDataPath: paths.userDataRoot,
      databasePath: paths.databasePath,
      logsPath: paths.managedDirectories.logs,
      binariesPath: paths.binariesPath,
    });
  });
};
