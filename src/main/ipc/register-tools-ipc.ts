import { dialog, ipcMain } from 'electron';

import type { AppContext } from '@main/services/app-context';
import type { BinaryStatus, DownloadableToolName } from '@shared/types/common';
import { ipcChannels } from '@shared/contracts/channels';

import { ok, fail } from './result';

export const registerToolsIpc = (context: AppContext): void => {
  ipcMain.handle(ipcChannels.toolsGetBinaryStatus, async () => {
    const settings = context.settingsService.getSettings();
    return ok(await context.mediaToolFacade.getBinaryStatuses(settings));
  });

  ipcMain.handle(ipcChannels.toolsSelectBinaryPath, async (_event, toolName: BinaryStatus['toolName']) => {
    const result = await dialog.showOpenDialog({
      title: `Select ${toolName} executable`,
      properties: ['openFile'],
    });

    return ok(result.canceled ? null : result.filePaths[0] ?? null);
  });

  ipcMain.handle(ipcChannels.toolsDownloadTool, async (event, tool: DownloadableToolName) => {
    try {
      const result = await context.toolDownloadService.downloadTool(tool, (progress) => {
        event.sender.send(ipcChannels.toolsDownloadProgress, progress);
      });

      if (result.success) {
        const settings = context.settingsService.getSettings();
        if (tool === 'yt-dlp' && settings.ytDlpMode !== 'bundled') {
          context.settingsService.updateSettings({ ytDlpMode: 'bundled' });
        } else if (tool === 'deno' && settings.denoMode !== 'bundled') {
          context.settingsService.updateSettings({ denoMode: 'bundled' });
        } else if (tool === 'ffmpeg-bundle' && settings.ffmpegMode !== 'bundled') {
          context.settingsService.updateSettings({ ffmpegMode: 'bundled' });
        }
      }

      return ok(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Download failed';
      return fail('TOOL_DOWNLOAD_FAILED', message);
    }
  });
};
