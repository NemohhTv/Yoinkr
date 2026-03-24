import { ipcMain } from 'electron';

import { ipcChannels } from '@shared/contracts/channels';
import {
  checkForUpdatesNow,
  downloadUpdate,
  getUpdateSnapshot,
  quitAndInstall,
} from '@main/services/update/auto-update-service';

import { fail, ok } from './result';

const updateErr = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const registerUpdatesIpc = (): void => {
  ipcMain.handle(ipcChannels.updatesGetStatus, async () => ok(getUpdateSnapshot()));

  ipcMain.handle(ipcChannels.updatesCheckNow, async () => {
    try {
      await checkForUpdatesNow();
      return ok(true);
    } catch (e) {
      return fail('UPDATE_CHECK_FAILED', updateErr(e));
    }
  });

  ipcMain.handle(ipcChannels.updatesDownload, async () => {
    try {
      await downloadUpdate();
      return ok(true);
    } catch (e) {
      return fail('UPDATE_DOWNLOAD_FAILED', updateErr(e));
    }
  });

  ipcMain.handle(ipcChannels.updatesInstall, async () => {
    try {
      quitAndInstall();
      return ok(true);
    } catch (e) {
      return fail('UPDATE_INSTALL_FAILED', updateErr(e));
    }
  });
};
