import { ipcMain } from 'electron';

import { ipcChannels } from '@shared/contracts/channels';
import {
  checkForUpdatesNow,
  downloadUpdate,
  getUpdateSnapshot,
  quitAndInstall,
} from '@main/services/update/auto-update-service';

import { ok } from './result';

export const registerUpdatesIpc = (): void => {
  ipcMain.handle(ipcChannels.updatesGetStatus, async () => ok(getUpdateSnapshot()));

  ipcMain.handle(ipcChannels.updatesCheckNow, async () => {
    await checkForUpdatesNow();
    return ok(true);
  });

  ipcMain.handle(ipcChannels.updatesDownload, async () => {
    await downloadUpdate();
    return ok(true);
  });

  ipcMain.handle(ipcChannels.updatesInstall, async () => {
    quitAndInstall();
    return ok(true);
  });
};
