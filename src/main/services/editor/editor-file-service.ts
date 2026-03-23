import { dialog } from 'electron';
import { existsSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AppPathsService } from '@main/services/paths/app-paths-service';
import { ServiceError } from '@main/services/shared/service-error';
import type { SettingsService } from '@main/services/settings/settings-service';
import type { EditorMediaInfo, EditorOpenRequest, EditorSourceSummary } from '@shared/types/editor';

const playablePreviewExtensions = new Set([
  '.mp4',
  '.m4v',
  '.webm',
  '.mp3',
  '.m4a',
  '.wav',
  '.ogg',
  '.oga',
]);

const mediaFileFilters = [
  {
    name: 'Media files',
    extensions: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'mp3', 'm4a', 'wav', 'flac', 'ogg', 'aac', 'opus'],
  },
  { name: 'All files', extensions: ['*'] },
];

export class EditorFileService {
  constructor(
    private readonly pathsService: AppPathsService,
    private readonly settingsService: SettingsService,
  ) {}

  async pickSourceFile(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      title: 'Open media file',
      properties: ['openFile'],
      filters: mediaFileFilters,
    });

    return result.canceled ? null : result.filePaths[0] ?? null;
  }

  async pickExportDirectory(): Promise<string | null> {
    const settings = this.settingsService.getSettings();
    const fallback = settings.exportDirectory || this.pathsService.getPaths().managedDirectories.exports;
    const result = await dialog.showOpenDialog({
      title: 'Choose export folder',
      defaultPath: fallback,
      properties: ['openDirectory', 'createDirectory'],
    });

    return result.canceled ? null : result.filePaths[0] ?? null;
  }

  async pickExportFile(suggestedName: string): Promise<string | null> {
    const settings = this.settingsService.getSettings();
    const fallbackDirectory = settings.exportDirectory || this.pathsService.getPaths().managedDirectories.exports;
    const result = await dialog.showSaveDialog({
      title: 'Save merged export as',
      defaultPath: join(fallbackDirectory, suggestedName),
      filters: mediaFileFilters,
    });

    return result.canceled ? null : result.filePath ?? null;
  }

  normalizeOpenRequest(request: EditorOpenRequest): EditorOpenRequest {
    return {
      ...request,
      sourcePath: this.normalizeSourcePath(request.sourcePath),
      titleHint: request.titleHint?.trim() || null,
      sourceUrl: request.sourceUrl?.trim() || null,
    };
  }

  assertSourceExists(sourcePath: string): void {
    const normalizedPath = this.normalizeSourcePath(sourcePath);
    if (!normalizedPath) {
      throw new ServiceError('INVALID_SOURCE_PATH', 'A source file path is required.');
    }

    if (!existsSync(normalizedPath)) {
      throw new ServiceError('SOURCE_FILE_MISSING', 'The selected source file no longer exists.');
    }

    const stats = statSync(normalizedPath);
    if (!stats.isFile()) {
      throw new ServiceError('INVALID_SOURCE_PATH', 'The selected source path is not a file.');
    }
  }

  buildSourceSummary(request: EditorOpenRequest, mediaInfo: EditorMediaInfo): EditorSourceSummary {
    const normalizedRequest = this.normalizeOpenRequest(request);
    this.assertSourceExists(normalizedRequest.sourcePath);

    const stats = statSync(normalizedRequest.sourcePath);
    const extension = extname(normalizedRequest.sourcePath).toLowerCase();
    const fileName = basename(normalizedRequest.sourcePath);

    return {
      sourcePath: normalizedRequest.sourcePath,
      sourceKind: normalizedRequest.sourceKind,
      fileName,
      displayName: normalizedRequest.titleHint || fileName,
      sourceUrl: normalizedRequest.sourceUrl,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      container: extension.replace(/^\./, '') || mediaInfo.container,
      durationSeconds: mediaInfo.durationSeconds,
      hasVideo: mediaInfo.hasVideo,
      hasAudio: mediaInfo.hasAudio,
      previewSupported: playablePreviewExtensions.has(extension),
      canEditLosslessly: mediaInfo.streamCopySupported,
      isMissing: false,
      warnings: [...mediaInfo.warnings],
    };
  }

  private normalizeSourcePath(sourcePath: string): string {
    const trimmed = sourcePath?.trim() ?? '';
    if (!trimmed) {
      return '';
    }

    const unquoted = trimmed.replace(/^"(.*)"$/, '$1').trim();
    if (/^file:\/\//i.test(unquoted)) {
      try {
        return fileURLToPath(unquoted);
      } catch {
        return unquoted;
      }
    }

    return unquoted;
  }
}
