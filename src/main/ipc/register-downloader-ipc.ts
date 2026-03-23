import { ipcMain } from 'electron';

import type { AppContext } from '@main/services/app-context';
import { ServiceError } from '@main/services/shared/service-error';
import type { DownloadDraft } from '@shared/types/downloader';
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
};
