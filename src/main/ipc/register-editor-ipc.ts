import { ipcMain } from 'electron';
import { existsSync } from 'node:fs';

import type { AppContext } from '@main/services/app-context';
import { ServiceError } from '@main/services/shared/service-error';
import { findLatestOutputByDownloadId } from '@main/services/tools/download-output-resolver';
import { ipcChannels } from '@shared/contracts/channels';
import type { EditorExportRequest, EditorOpenRequest } from '@shared/types/editor';

import { fail, ok } from './result';

export const registerEditorIpc = (context: AppContext): void => {
  ipcMain.handle(ipcChannels.editorOpenSource, async (_event, request: EditorOpenRequest) => {
    try {
      let normalizedRequest = context.editorFileService.normalizeOpenRequest(request);
      const settings = context.settingsService.getSettings();
      const downloadDir = settings.downloadDirectory || context.pathsService.getPaths().managedDirectories.downloads;

      if (normalizedRequest.sourceKind === 'download' && normalizedRequest.downloadId) {
        let pathToUse = normalizedRequest.sourcePath;
        if (!existsSync(pathToUse)) {
          const historyRecord = context.downloadHistoryRepository.getById(normalizedRequest.downloadId);
          if (historyRecord?.outputPath) {
            normalizedRequest = context.editorFileService.normalizeOpenRequest({
              ...normalizedRequest,
              sourcePath: historyRecord.outputPath,
            });
            pathToUse = normalizedRequest.sourcePath;
          }
          if (!existsSync(pathToUse)) {
            const scanned = findLatestOutputByDownloadId(downloadDir, normalizedRequest.downloadId);
            if (scanned) {
              normalizedRequest = context.editorFileService.normalizeOpenRequest({
                ...normalizedRequest,
                sourcePath: scanned,
              });
              const rec = historyRecord ?? context.downloadHistoryRepository.getById(normalizedRequest.downloadId);
              if (rec) {
                context.downloadHistoryRepository.save({ ...rec, outputPath: scanned });
              }
            }
          }
        }
      }

      context.editorFileService.assertSourceExists(normalizedRequest.sourcePath);
      const mediaInfo = await context.ffprobeAnalysisService.inspectSource(normalizedRequest.sourcePath, settings);
      const source = context.editorFileService.buildSourceSummary(normalizedRequest, mediaInfo);
      return ok({ request: normalizedRequest, source, mediaInfo });
    } catch (error) {
      if (error instanceof ServiceError) {
        return fail(error.code, error.message, error.details);
      }
      const message = error instanceof Error ? error.message : 'Unable to open the selected source file.';
      return fail('EDITOR_OPEN_FAILED', message);
    }
  });

  ipcMain.handle(ipcChannels.editorGetTimelineAssets, async (_event, sourcePath: string) => {
    try {
      const settings = context.settingsService.getSettings();
      const mediaInfo = await context.ffprobeAnalysisService.inspectSource(sourcePath, settings);
      return ok(await context.timelineAssetsService.buildAssets(sourcePath, mediaInfo, settings));
    } catch (error) {
      if (error instanceof ServiceError) {
        return fail(error.code, error.message, error.details);
      }
      const message = error instanceof Error ? error.message : 'Unable to build timeline assets.';
      return fail('TIMELINE_ASSETS_FAILED', message);
    }
  });

  ipcMain.handle(ipcChannels.editorPreviewExport, async (_event, request: EditorExportRequest) => {
    try {
      const settings = context.settingsService.getSettings();
      return ok(await context.exportPlanningService.previewExport(request, settings));
    } catch (error) {
      if (error instanceof ServiceError) {
        return fail(error.code, error.message, error.details);
      }
      const message = error instanceof Error ? error.message : 'Unable to preview the export.';
      return fail('EDITOR_PREVIEW_FAILED', message);
    }
  });

  ipcMain.handle(ipcChannels.editorPickSourceFile, async () => {
    try {
      return ok(await context.editorFileService.pickSourceFile());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open the file picker.';
      return fail('SOURCE_PICK_FAILED', message);
    }
  });

  ipcMain.handle(ipcChannels.editorPickExportDirectory, async () => {
    try {
      return ok(await context.editorFileService.pickExportDirectory());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open the export folder picker.';
      return fail('EXPORT_DIRECTORY_PICK_FAILED', message);
    }
  });

  ipcMain.handle(ipcChannels.editorPickExportFile, async (_event, suggestedName: string) => {
    try {
      return ok(await context.editorFileService.pickExportFile(suggestedName));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open the save dialog.';
      return fail('EXPORT_FILE_PICK_FAILED', message);
    }
  });

  ipcMain.handle(ipcChannels.editorExportMedia, async (_event, request: EditorExportRequest) => {
    try {
      const settings = context.settingsService.getSettings();
      return ok(await context.ffmpegExportService.exportMedia(request, settings));
    } catch (error) {
      if (error instanceof ServiceError) {
        return fail(error.code, error.message, error.details);
      }
      const message = error instanceof Error ? error.message : 'Export failed.';
      return fail('EDITOR_EXPORT_FAILED', message);
    }
  });
};
