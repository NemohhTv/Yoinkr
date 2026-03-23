import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { AppPathsService } from '@main/services/paths/app-paths-service';
import type { ProcessRunner } from '@main/services/shared/process-runner';
import type { BinaryResolver } from '@main/services/tools/binary-resolver';
import type { EditorMediaInfo, EditorTimelineAssets, EditorTimelineThumbnail } from '@shared/types/editor';
import type { AppSettings } from '@shared/types/settings';

const thumbnailCount = 8;

const ensureDirectory = (targetPath: string): void => {
  if (!existsSync(targetPath)) {
    mkdirSync(targetPath, { recursive: true });
  }
};

export class TimelineAssetsService {
  constructor(
    private readonly pathsService: AppPathsService,
    private readonly processRunner: ProcessRunner,
    private readonly binaryResolver: BinaryResolver,
  ) {}

  async buildAssets(
    sourcePath: string,
    mediaInfo: EditorMediaInfo,
    settings: AppSettings,
  ): Promise<EditorTimelineAssets> {
    const resolved = this.binaryResolver.resolveTool('ffmpeg', settings);
    if (!resolved.resolvedPath || !resolved.exists) {
      return {
        thumbnails: [],
        waveformImagePath: null,
        warnings: ['ffmpeg is unavailable, so timeline thumbnails and waveform previews were skipped.'],
      };
    }

    const cacheKey = createHash('sha1').update(`${sourcePath}|${mediaInfo.durationSeconds ?? 'na'}`).digest('hex');
    const thumbnailsRoot = join(this.pathsService.getPaths().managedDirectories.thumbnails, cacheKey);
    const waveformsRoot = join(this.pathsService.getPaths().managedDirectories.waveforms, cacheKey);
    ensureDirectory(thumbnailsRoot);
    ensureDirectory(waveformsRoot);

    const warnings: string[] = [];
    const thumbnails = mediaInfo.hasVideo
      ? await this.buildThumbnails(resolved.resolvedPath, sourcePath, mediaInfo.durationSeconds, thumbnailsRoot, warnings)
      : [];
    const waveformImagePath = mediaInfo.hasAudio
      ? await this.buildWaveform(resolved.resolvedPath, sourcePath, waveformsRoot, warnings)
      : null;

    return { thumbnails, waveformImagePath, warnings };
  }

  private async buildThumbnails(
    ffmpegPath: string,
    sourcePath: string,
    durationSeconds: number | null,
    outputDirectory: string,
    warnings: string[],
  ): Promise<EditorTimelineThumbnail[]> {
    if (!durationSeconds || durationSeconds <= 0) {
      warnings.push('Timeline thumbnails were skipped because the source duration is unavailable.');
      return [];
    }

    const thumbnails: EditorTimelineThumbnail[] = [];
    for (let index = 0; index < thumbnailCount; index += 1) {
      const ratio = thumbnailCount === 1 ? 0 : index / (thumbnailCount - 1);
      const timeSeconds = Math.max(0, Math.min(durationSeconds, durationSeconds * ratio));
      const imagePath = join(outputDirectory, `thumb-${String(index + 1).padStart(2, '0')}.jpg`);

      if (!existsSync(imagePath)) {
        const result = await this.processRunner.run({
          command: ffmpegPath,
          args: [
            '-hide_banner',
            '-loglevel',
            'error',
            '-ss',
            timeSeconds.toFixed(3),
            '-i',
            sourcePath,
            '-frames:v',
            '1',
            '-vf',
            'scale=240:-1',
            '-q:v',
            '4',
            '-y',
            imagePath,
          ],
          timeoutMs: 30000,
          maxBufferBytes: 2 * 1024 * 1024,
        });

        if (result.exitCode !== 0) {
          warnings.push('Some timeline thumbnails could not be generated for this file.');
          break;
        }
      }

      thumbnails.push({
        id: `thumb-${index + 1}`,
        timeSeconds,
        imagePath,
      });
    }

    return thumbnails;
  }

  private async buildWaveform(
    ffmpegPath: string,
    sourcePath: string,
    outputDirectory: string,
    warnings: string[],
  ): Promise<string | null> {
    const waveformPath = join(outputDirectory, 'waveform.png');
    if (existsSync(waveformPath)) {
      return waveformPath;
    }

    const result = await this.processRunner.run({
      command: ffmpegPath,
      args: [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        sourcePath,
        '-filter_complex',
        'showwavespic=s=1400x180:colors=0x4f7cff',
        '-frames:v',
        '1',
        '-y',
        waveformPath,
      ],
      timeoutMs: 45000,
      maxBufferBytes: 2 * 1024 * 1024,
    });

    if (result.exitCode !== 0) {
      warnings.push('Waveform generation failed for this source.');
      return null;
    }

    return waveformPath;
  }
}
