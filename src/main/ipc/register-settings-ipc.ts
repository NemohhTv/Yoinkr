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

  ipcMain.handle(ipcChannels.settingsReset, async () => ok(context.settingsService.reset()));
};
