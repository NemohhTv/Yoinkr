import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

import type { AppPathsService } from '@main/services/paths/app-paths-service';
import type { ProcessRunner } from '@main/services/shared/process-runner';
import { ServiceError } from '@main/services/shared/service-error';
import type { BinaryResolver } from '@main/services/tools/binary-resolver';
import type { EditorExportPreview, EditorExportRequest, EditorExportResult, EditorExportStrategy, EditorPreviewSegment } from '@shared/types/editor';
import type { AppSettings } from '@shared/types/settings';

import type { FfprobeAnalysisService } from './ffprobe-analysis-service';
import type { ExportPlanningService } from './export-planning-service';

const supportedStreamCopyMergeExtensions = new Set(['.mp4', '.m4v', '.mov', '.mkv', '.webm', '.m4a', '.mp3', '.wav']);
const supportedExactVideoExtensions = new Set(['.mp4', '.m4v', '.mov', '.mkv']);

const sanitizeName = (value: string): string => {
  const withoutInvalidChars = Array.from(value)
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || '<>:"/\\|?*'.includes(character) ? '_' : character;
    })
    .join('');

  return withoutInvalidChars.replace(/\s+/g, ' ').trim().slice(0, 120) || 'clip';
};

const formatSeconds = (seconds: number): string => {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${wholeSeconds
    .toString()
    .padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
};

export class FfmpegExportService {
  constructor(
    private readonly pathsService: AppPathsService,
    private readonly processRunner: ProcessRunner,
    private readonly binaryResolver: BinaryResolver,
    private readonly ffprobeAnalysisService: FfprobeAnalysisService,
    private readonly exportPlanningService: ExportPlanningService,
  ) {}

  async exportMedia(request: EditorExportRequest, settings: AppSettings): Promise<EditorExportResult> {
    const resolved = this.binaryResolver.resolveTool('ffmpeg', settings);
    if (!resolved.resolvedPath || !resolved.exists) {
      throw new ServiceError('FFMPEG_NOT_FOUND', 'ffmpeg was not found. Configure it in Settings before exporting from the editor.');
    }

    const preview = await this.exportPlanningService.previewExport(request, settings);
    if (!preview.canExport) {
      throw new ServiceError('EXPORT_PLAN_INVALID', 'The current export request is not compatible with the selected mode.');
    }

    const mediaInfo = await this.ffprobeAnalysisService.inspectSource(request.sourcePath, settings);
    if (!mediaInfo.streamCopySupported) {
      throw new ServiceError(
        'LOSSLESS_EXPORT_UNSUPPORTED',
        'This source cannot be exported with the selected settings.',
      );
    }

    const sourceExtension = extname(request.sourcePath).toLowerCase();
    const sourceBaseName = sanitizeName(request.baseName?.trim() || basename(request.sourcePath, sourceExtension));
    const selectedSegments = this.validateSegments(preview.segments, mediaInfo.durationSeconds);
    const outputPaths: string[] = [];

    if (request.exportMode === 'single-cut') {
      const outputFilePath = request.outputFilePath?.trim();
      if (!outputFilePath) {
        throw new ServiceError('OUTPUT_FILE_REQUIRED', 'Choose a destination file before exporting a cut.');
      }

      await this.exportSingleSegment(
        resolved.resolvedPath,
        request.sourcePath,
        selectedSegments[0],
        outputFilePath,
        preview.strategy,
        mediaInfo.hasVideo,
        sourceExtension,
      );
      outputPaths.push(outputFilePath);
    }

    if (request.exportMode === 'separate-files' || request.exportMode === 'merge-and-separate') {
      const separatePaths = await this.exportSeparateFiles({
        ffmpegPath: resolved.resolvedPath,
        sourcePath: request.sourcePath,
        outputDirectory: request.outputDirectory?.trim(),
        segments: selectedSegments,
        strategy: preview.strategy,
        sourceHasVideo: mediaInfo.hasVideo,
        sourceExtension,
        sourceBaseName,
      });
      outputPaths.push(...separatePaths);
    }

    if (request.exportMode === 'merge-cuts' || request.exportMode === 'merge-and-separate') {
      const mergedPath = await this.exportMergedCuts({
        ffmpegPath: resolved.resolvedPath,
        request,
        sourceHasVideo: mediaInfo.hasVideo,
        segments: selectedSegments,
        sourceExtension,
        strategy: preview.strategy,
      });
      outputPaths.push(mergedPath);
    }

    return {
      success: true,
      outputPaths,
      strategy: preview.strategy,
      preview,
      warnings: preview.warnings,
      message: this.buildSuccessMessage(request, outputPaths.length, preview.strategy),
    };
  }

  private async exportSeparateFiles({
    ffmpegPath,
    sourcePath,
    outputDirectory,
    segments,
    strategy,
    sourceHasVideo,
    sourceExtension,
    sourceBaseName,
  }: {
    ffmpegPath: string;
    sourcePath: string;
    outputDirectory: string | null | undefined;
    segments: EditorPreviewSegment[];
    strategy: EditorExportStrategy;
    sourceHasVideo: boolean;
    sourceExtension: string;
    sourceBaseName: string;
  }): Promise<string[]> {
    if (!outputDirectory) {
      throw new ServiceError('OUTPUT_DIRECTORY_REQUIRED', 'Choose an export folder before exporting separate files.');
    }
    this.ensureDirectory(outputDirectory);

    const outputPaths: string[] = [];
    for (const [index, segment] of segments.entries()) {
      const labelPart = sanitizeName(segment.label || `clip ${index + 1}`);
      const targetExtension = this.resolveExportExtension(sourceExtension, strategy, sourceHasVideo);
      const outputPath = this.uniqueOutputPath(
        outputDirectory,
        `${sourceBaseName}_${String(index + 1).padStart(2, '0')}_${labelPart}${targetExtension}`,
      );
      await this.exportSingleSegment(ffmpegPath, sourcePath, segment, outputPath, strategy, sourceHasVideo, sourceExtension);
      outputPaths.push(outputPath);
    }

    return outputPaths;
  }

  private async exportMergedCuts({
    ffmpegPath,
    request,
    sourceHasVideo,
    segments,
    sourceExtension,
    strategy,
  }: {
    ffmpegPath: string;
    request: EditorExportRequest;
    sourceHasVideo: boolean;
    segments: EditorPreviewSegment[];
    sourceExtension: string;
    strategy: EditorExportStrategy;
  }): Promise<string> {
    const outputFilePath = request.outputFilePath?.trim();
    if (!outputFilePath) {
      throw new ServiceError('OUTPUT_FILE_REQUIRED', 'Choose a destination file before exporting a merged cut.');
    }

    const outputExtension = extname(outputFilePath).toLowerCase() || this.resolveExportExtension(sourceExtension, strategy, sourceHasVideo);
    if (strategy === 'stream-copy' && extname(outputFilePath).toLowerCase() !== sourceExtension) {
      throw new ServiceError(
        'CONTAINER_CHANGE_DEFERRED',
        'Changing the output container is deferred in this phase. Save the merged export using the same file extension as the source.',
      );
    }
    if (strategy !== 'stream-copy' && sourceHasVideo && !supportedExactVideoExtensions.has(outputExtension)) {
      throw new ServiceError('EXACT_CONTAINER_UNSUPPORTED', 'Exact video exports are currently supported for MP4, MOV, and MKV outputs.');
    }

    this.ensureOutputPathSafe(request.sourcePath, outputFilePath);

    if (segments.length === 1) {
      await this.exportSingleSegment(ffmpegPath, request.sourcePath, segments[0], outputFilePath, strategy, sourceHasVideo, sourceExtension);
      return outputFilePath;
    }

    const tempRoot = this.pathsService.getPaths().managedDirectories.temp;
    const workingDirectory = mkdtempSync(join(tempRoot, 'editor-export-'));
    const tempSegmentPaths: string[] = [];

    try {
      for (const [index, segment] of segments.entries()) {
        const tempPath = join(workingDirectory, `segment_${String(index + 1).padStart(2, '0')}${outputExtension}`);
        await this.exportSingleSegment(ffmpegPath, request.sourcePath, segment, tempPath, strategy, sourceHasVideo, sourceExtension);
        tempSegmentPaths.push(tempPath);
      }

      const concatFilePath = join(workingDirectory, 'segments.txt');
      const concatContent = tempSegmentPaths
        .map((path) => `file '${path.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
        .join('\n');
      writeFileSync(concatFilePath, concatContent, 'utf8');

      const result = await this.processRunner.run({
        command: ffmpegPath,
        args: [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          concatFilePath,
          '-c',
          strategy === 'stream-copy' ? 'copy' : 'copy',
          '-map',
          '0',
          '-n',
          outputFilePath,
        ],
        timeoutMs: 0,
        maxBufferBytes: 4 * 1024 * 1024,
      });

      if (result.exitCode !== 0) {
        throw new ServiceError(
          'MERGE_EXPORT_FAILED',
          strategy === 'stream-copy'
            ? 'ffmpeg could not merge the selected cuts losslessly.'
            : 'ffmpeg could not merge the selected exact cuts.',
          result.stderr || result.stdout || undefined,
        );
      }

      return outputFilePath;
    } finally {
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  }

  private validateSegments(segments: EditorPreviewSegment[], durationSeconds: number | null): EditorPreviewSegment[] {
    if (segments.length === 0) {
      throw new ServiceError('NO_SEGMENTS', 'Create at least one valid segment before exporting.');
    }

    return segments.map((segment) => {
      const startSeconds = segment.boundary.actualStartSeconds;
      const endSeconds = segment.boundary.actualEndSeconds;
      if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
        throw new ServiceError('INVALID_SEGMENT_RANGE', `Segment "${segment.label}" has an invalid time range.`);
      }
      if (startSeconds < 0 || endSeconds <= startSeconds) {
        throw new ServiceError('INVALID_SEGMENT_RANGE', `Segment "${segment.label}" must end after it starts.`);
      }
      if (durationSeconds !== null && endSeconds > durationSeconds + 0.05) {
        throw new ServiceError('INVALID_SEGMENT_RANGE', `Segment "${segment.label}" extends beyond the source duration.`);
      }
      return segment;
    });
  }

  private async exportSingleSegment(
    ffmpegPath: string,
    sourcePath: string,
    segment: EditorPreviewSegment,
    outputPath: string,
    strategy: EditorExportStrategy,
    sourceHasVideo: boolean,
    sourceExtension: string,
  ): Promise<void> {
    this.ensureOutputPathSafe(sourcePath, outputPath);

    if (strategy === 'stream-copy') {
      await this.runStreamCopyCut(ffmpegPath, sourcePath, segment, outputPath);
      return;
    }

    await this.runExactReencodeCut(ffmpegPath, sourcePath, segment, outputPath, sourceHasVideo, sourceExtension);
  }

  private async runStreamCopyCut(
    ffmpegPath: string,
    sourcePath: string,
    segment: EditorPreviewSegment,
    outputPath: string,
  ): Promise<void> {
    const result = await this.processRunner.run({
      command: ffmpegPath,
      args: [
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        formatSeconds(segment.boundary.actualStartSeconds),
        '-to',
        formatSeconds(segment.boundary.actualEndSeconds),
        '-i',
        sourcePath,
        '-map',
        '0',
        '-c',
        'copy',
        '-avoid_negative_ts',
        'make_zero',
        '-n',
        outputPath,
      ],
      timeoutMs: 0,
      maxBufferBytes: 4 * 1024 * 1024,
    });

    if (result.exitCode !== 0) {
      throw new ServiceError(
        'CUT_EXPORT_FAILED',
        `ffmpeg could not export segment "${segment.label}" losslessly.`,
        result.stderr || result.stdout || undefined,
      );
    }
  }

  private async runExactReencodeCut(
    ffmpegPath: string,
    sourcePath: string,
    segment: EditorPreviewSegment,
    outputPath: string,
    sourceHasVideo: boolean,
    sourceExtension: string,
  ): Promise<void> {
    const outputExtension = this.resolveExportExtension(sourceExtension, 're-encode', sourceHasVideo);
    if (sourceHasVideo && !supportedExactVideoExtensions.has(extname(outputPath).toLowerCase() || outputExtension)) {
      throw new ServiceError('EXACT_CONTAINER_UNSUPPORTED', 'Exact video exports currently support MP4, MOV, and MKV outputs.');
    }

    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      formatSeconds(segment.boundary.requestedStartSeconds),
      '-to',
      formatSeconds(segment.boundary.requestedEndSeconds),
      '-i',
      sourcePath,
      '-map',
      '0',
      ...(sourceHasVideo ? ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18'] : []),
      '-c:a',
      sourceHasVideo ? 'aac' : 'copy',
      ...(this.supportsFastStart(extname(outputPath).toLowerCase()) ? ['-movflags', '+faststart'] : []),
      '-y',
      outputPath,
    ];

    const result = await this.processRunner.run({
      command: ffmpegPath,
      args,
      timeoutMs: 0,
      maxBufferBytes: 4 * 1024 * 1024,
    });

    if (result.exitCode !== 0) {
      throw new ServiceError(
        'EXACT_EXPORT_FAILED',
        `ffmpeg could not export segment "${segment.label}" with exact timestamps.`,
        result.stderr || result.stdout || undefined,
      );
    }
  }

  private ensureDirectory(targetPath: string): void {
    if (!existsSync(targetPath)) {
      mkdirSync(targetPath, { recursive: true });
    }
  }

  private ensureOutputPathSafe(sourcePath: string, outputPath: string): void {
    if (resolve(outputPath).toLowerCase() === resolve(sourcePath).toLowerCase()) {
      throw new ServiceError('OUTPUT_EQUALS_SOURCE', 'Choose a new destination so the original file stays untouched.');
    }
    if (existsSync(outputPath)) {
      throw new ServiceError('OUTPUT_EXISTS', 'The selected output path already exists. Choose a new destination.');
    }
  }

  private uniqueOutputPath(directory: string, fileName: string): string {
    const extension = extname(fileName);
    const stem = basename(fileName, extension);

    let candidate = join(directory, fileName);
    let counter = 1;
    while (existsSync(candidate)) {
      candidate = join(directory, `${stem} (${counter})${extension}`);
      counter += 1;
    }
    return candidate;
  }

  private resolveExportExtension(
    sourceExtension: string,
    strategy: EditorExportStrategy,
    sourceHasVideo: boolean,
  ): string {
    if (strategy === 'stream-copy' || !sourceHasVideo) {
      return sourceExtension;
    }

    return supportedExactVideoExtensions.has(sourceExtension) ? sourceExtension : '.mp4';
  }

  private buildSuccessMessage(
    request: EditorExportRequest,
    outputCount: number,
    strategy: EditorExportStrategy,
  ): string {
    const modeLabel =
      request.exportMode === 'single-cut'
        ? 'cut'
        : request.exportMode === 'merge-cuts'
          ? 'merged export'
          : request.exportMode === 'merge-and-separate'
            ? 'merged + separate exports'
            : 'separate exports';
    const strategyLabel =
      strategy === 'stream-copy'
        ? 'lossless stream-copy'
        : strategy === 'smart-cut'
          ? 'smart-cut'
          : 'exact re-encode';
    return `${modeLabel} complete using ${strategyLabel}${outputCount > 1 ? ` (${outputCount} files)` : ''}.`;
  }

  private supportsFastStart(extension: string): boolean {
    return extension === '.mp4' || extension === '.m4v' || extension === '.mov';
  }
}
