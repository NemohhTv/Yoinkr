import { ipcMain } from 'electron';

import type { AppContext } from '@main/services/app-context';
import { ServiceError } from '@main/services/shared/service-error';
import type { DownloadDraft, DownloadHistoryRecord, ItemDownloadRequest } from '@shared/types/downloader';
import { ipcChannels } from '@shared/contracts/channels';

import { fail, ok } from './result';

export const registerDownloaderIpc = (context: AppContext): void => {
  ipcMain.handle(ipcChannels.downloaderValidateUrls, async (_event, input: string) => {
    return ok(context.mediaToolFacade.validateUrls(input));
  });

  ipcMain.handle(ipcChannels.downloaderGetMetadata, async (_event, url: string) => {
    try {
      return ok(await context.mediaToolFacade.getMetadata(url));
    } catch (error) {
      if (error instanceof ServiceError) {
        return fail(error.code, error.message, error.details);
      }

      const message = error instanceof Error ? error.message : 'Unable to inspect media.';
      return fail('METADATA_FETCH_FAILED', message);
    }
  });

  ipcMain.handle(
    ipcChannels.downloaderEnqueueDraft,
    async (_event, draft: Omit<DownloadDraft, 'id' | 'createdAt' | 'status'>) => {
      try {
        const created = context.downloadDraftRepository.create(draft);
        return ok(created);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to save draft.';
        return fail('DOWNLOAD_DRAFT_FAILED', message);
      }
    },
  );

  ipcMain.handle(ipcChannels.downloaderStartItem, async (event, request: ItemDownloadRequest) => {
    try {
      const settings = context.settingsService.getSettings();
      const result = await context.ytDlpDownloadService.downloadItem(request, settings, (progress) => {
        event.sender.send(ipcChannels.downloaderItemProgress, progress);
      });
      return ok(result);
    } catch (error) {
      if (error instanceof ServiceError) {
        return fail(error.code, error.message, error.details);
      }
      const message = error instanceof Error ? error.message : 'Download failed.';
      return fail('DOWNLOAD_FAILED', message);
    }
  });

  ipcMain.handle(ipcChannels.downloaderCancelItem, async (_event, id: string) => {
    try {
      const cancelled = context.ytDlpDownloadService.cancelItem(id);
      return ok(cancelled);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to cancel download.';
      return fail('CANCEL_FAILED', message);
    }
  });

  ipcMain.handle(ipcChannels.downloaderSaveHistory, async (_event, record: DownloadHistoryRecord) => {
    try {
      const saved = context.downloadHistoryRepository.save(record);
      return ok(saved);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save history.';
      return fail('HISTORY_SAVE_FAILED', message);
    }
  });

  ipcMain.handle(ipcChannels.downloaderDeleteHistory, async (_event, id: string) => {
    try {
      const deleted = context.downloadHistoryRepository.delete(id);
      return ok(deleted);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete history record.';
      return fail('HISTORY_DELETE_FAILED', message);
    }
  });

  ipcMain.handle(ipcChannels.downloaderGetHistory, async () => {
    try {
      const records = context.downloadHistoryRepository.getAll();
      return ok(records);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load history.';
      return fail('HISTORY_LOAD_FAILED', message);
    }
  });
};
