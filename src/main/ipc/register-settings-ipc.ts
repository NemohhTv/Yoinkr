import { dialog, ipcMain } from 'electron';

import type { AppContext } from '@main/services/app-context';
import type { SettingsPatch } from '@shared/types/settings';
import { ipcChannels } from '@shared/contracts/channels';

import { fail, ok } from './result';

export const registerSettingsIpc = (context: AppContext): void => {
  ipcMain.handle(ipcChannels.settingsGet, async () => ok(context.settingsService.getSettings()));

  ipcMain.handle(ipcChannels.settingsUpdate, async (_event, patch: SettingsPatch) => {
    try {
      return ok(context.settingsService.updateSettings(patch));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Settings update failed.';
      return fail('SETTINGS_VALIDATION_FAILED', message);
    }
  });

  ipcMain.handle(ipcChannels.settingsPickDirectory, async (_event, title: string) => {
    const result = await dialog.showOpenDialog({
      title,
      properties: ['openDirectory', 'createDirectory'],
    });

    return ok(result.canceled ? null : result.filePaths[0] ?? null);
  });

  ipcMain.handle(ipcChannels.settingsPickCookiesFile, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose Netscape cookies.txt file',
      properties: ['openFile'],
      filters: [{ name: 'Cookies / text', extensions: ['txt'] }, { name: 'All files', extensions: ['*'] }],
    });
    return ok(result.canceled ? null : result.filePaths[0] ?? null);
  });

  ipcMain.handle(ipcChannels.settingsTestYtDlpCookies, async (_event, patch?: SettingsPatch) => {
    try {
      const merged = context.settingsService.previewWith(patch ?? {});
      const outcome = await context.mediaToolFacade.testYtDlpCookiesWithSettings(merged);
      return ok(outcome);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cookie test failed.';
      return fail('COOKIE_TEST_FAILED', message);
    }
  });

  ipcMain.handle(ipcChannels.settingsReset, async () => ok(context.settingsService.reset()));
};
