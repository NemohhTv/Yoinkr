import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

import type { AppPathsService } from '@main/services/paths/app-paths-service';
import { ServiceError } from '@main/services/shared/service-error';
import type { BinaryResolver } from '@main/services/tools/binary-resolver';
import type {
  EditorExportMode,
  EditorExportProgressPayload,
  EditorExportRequest,
  EditorExportResult,
  EditorExportStrategy,
  EditorPreviewSegment,
} from '@shared/types/editor';
import type { AppSettings } from '@shared/types/settings';

import type { FfprobeAnalysisService } from './ffprobe-analysis-service';
import type { ExportPlanningService } from './export-planning-service';

const supportedExactVideoExtensions = new Set(['.mp4', '.m4v', '.mov', '.mkv']);

export interface EditorExportCallbacks {
  onProgress?: (payload: EditorExportProgressPayload) => void;
}

interface ExportProgressHooks {
  beforeFfmpeg: (phase: 'segment' | 'merge', label: string, segmentDurationSeconds?: number) => void;
  onFfmpegPulse: (pulse: { outTimeUs?: number; totalSizeBytes?: number; speed?: string }) => void;
}

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

function computeExportStepCount(mode: EditorExportMode, segmentCount: number): number {
  if (mode === 'single-cut') {
    return 1;
  }
  if (mode === 'separate-files') {
    return segmentCount;
  }
  if (mode === 'merge-cuts') {
    return segmentCount <= 1 ? 1 : segmentCount + 1;
  }
  if (segmentCount <= 1) {
    return 2;
  }
  return segmentCount + segmentCount + 1;
}

function runFfmpegWithProgress(
  ffmpegPath: string,
  coreArgs: string[],
  options: {
    onPulse?: (pulse: { outTimeUs?: number; totalSizeBytes?: number; speed?: string }) => void;
  },
): Promise<{ exitCode: number | null; stderrTail: string }> {
  const args = ['-hide_banner', '-nostats', '-loglevel', 'error', '-progress', '-', ...coreArgs];

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderrTail = '';
    let stdoutBuf = '';
    const last: { outTimeUs?: number; totalSizeBytes?: number; speed?: string } = {};

    const flushPulse = (): void => {
      if (options.onPulse && (last.outTimeUs !== undefined || last.totalSizeBytes !== undefined || last.speed !== undefined)) {
        options.onPulse({ ...last });
      }
    };

    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderrTail += chunk.toString();
      if (stderrTail.length > 96_000) {
        stderrTail = stderrTail.slice(-48_000);
      }
    });

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) {
        const eq = line.indexOf('=');
        if (eq <= 0) {
          continue;
        }
        const key = line.slice(0, eq);
        const val = line.slice(eq + 1).trim();
        if (key === 'out_time_us') {
          const n = Number.parseInt(val, 10);
          if (Number.isFinite(n)) {
            last.outTimeUs = n;
          }
        } else if (key === 'total_size') {
          const n = Number.parseInt(val, 10);
          if (Number.isFinite(n)) {
            last.totalSizeBytes = n;
          }
        } else if (key === 'speed') {
          last.speed = val;
        } else if (key === 'progress' && (val === 'continue' || val === 'end')) {
          flushPulse();
        }
      }
    });

    child.on('error', (error) => {
      reject(new ServiceError('PROCESS_START_FAILED', 'Unable to start ffmpeg.', error.message));
    });

    child.on('close', (exitCode) => {
      resolve({ exitCode: exitCode ?? -1, stderrTail });
    });
  });
}

export class FfmpegExportService {
  constructor(
    private readonly pathsService: AppPathsService,
    private readonly binaryResolver: BinaryResolver,
    private readonly ffprobeAnalysisService: FfprobeAnalysisService,
    private readonly exportPlanningService: ExportPlanningService,
  ) {}

  async exportMedia(
    request: EditorExportRequest,
    settings: AppSettings,
    callbacks?: EditorExportCallbacks,
  ): Promise<EditorExportResult> {
    const rawOnProgress = callbacks?.onProgress;

    const resolved = this.binaryResolver.resolveTool('ffmpeg', settings);
    if (!resolved.resolvedPath || !resolved.exists) {
      throw new ServiceError('FFMPEG_NOT_FOUND', 'ffmpeg was not found. Configure it in Settings before exporting from the editor.');
    }

    // Stream-copy cut mode: skip full-file keyframe scan (fast-trim style) — ffprobe JSON
    // only, then FFmpeg stream-copy snaps to keyframes. Auto/Exact still need a scan for correct strategy.
    const needKeyframeScan = request.cutMode !== 'stream-copy';

    if (rawOnProgress) {
      if (needKeyframeScan) {
        rawOnProgress({
          strategy: 'stream-copy',
          strategyLabel: 'Preparing export',
          strategyExplanation:
            'Running one keyframe scan so Auto/Exact cut planning is accurate. Long files or network paths can take a while before FFmpeg starts.',
          phase: 'starting',
          stepIndex: 0,
          stepCount: 1,
          stepLabel: 'Keyframe analysis (single pass)…',
        });
      } else {
        rawOnProgress({
          strategy: 'stream-copy',
          strategyLabel: 'Preparing export',
          strategyExplanation:
            'Fast path: container metadata only (no full-file packet scan). FFmpeg stream-copy will align output to the nearest keyframes — same tradeoff as a typical "fast trim" tool.',
          phase: 'starting',
          stepIndex: 0,
          stepCount: 1,
          stepLabel: 'Reading metadata…',
        });
      }
    }

    const mediaInfo = await this.ffprobeAnalysisService.inspectSource(request.sourcePath, settings, {
      includeKeyframes: needKeyframeScan,
    });
    const preview = await this.exportPlanningService.previewExport(request, settings, mediaInfo);
    if (!preview.canExport) {
      throw new ServiceError('EXPORT_PLAN_INVALID', 'The current export request is not compatible with the selected mode.');
    }

    if (!mediaInfo.streamCopySupported) {
      throw new ServiceError(
        'LOSSLESS_EXPORT_UNSUPPORTED',
        'This source cannot be exported with the selected settings.',
      );
    }

    const sourceExtension = extname(request.sourcePath).toLowerCase();
    const sourceBaseName = sanitizeName(request.baseName?.trim() || basename(request.sourcePath, sourceExtension));
    const selectedSegments = this.validateSegments(preview.segments, mediaInfo.durationSeconds);
    const stepCount = computeExportStepCount(request.exportMode, selectedSegments.length);

    const base = {
      strategy: preview.strategy,
      strategyLabel: preview.strategyLabel,
      strategyExplanation: preview.strategyExplanation,
    };

    let stepCounter = 0;
    let currentPhase: 'segment' | 'merge' = 'segment';
    let currentStepLabel = '';
    let currentSegmentDuration: number | undefined;
    let lastPulseAt = 0;

    const emit = (payload: EditorExportProgressPayload): void => {
      rawOnProgress?.(payload);
    };

    const beforeFfmpeg = (phase: 'segment' | 'merge', label: string, segmentDurationSeconds?: number): void => {
      stepCounter += 1;
      currentPhase = phase;
      currentStepLabel = label;
      currentSegmentDuration = segmentDurationSeconds;
      lastPulseAt = 0;
      emit({
        ...base,
        phase,
        stepIndex: stepCounter,
        stepCount,
        stepLabel: label,
        segmentDurationSeconds,
      });
    };

    const onFfmpegPulse = (pulse: { outTimeUs?: number; totalSizeBytes?: number; speed?: string }): void => {
      if (!rawOnProgress) {
        return;
      }
      const now = Date.now();
      if (now - lastPulseAt < 200) {
        return;
      }
      lastPulseAt = now;
      emit({
        ...base,
        phase: currentPhase,
        stepIndex: stepCounter,
        stepCount,
        stepLabel: currentStepLabel,
        segmentDurationSeconds: currentSegmentDuration,
        ...pulse,
      });
    };

    const hooks: ExportProgressHooks = { beforeFfmpeg, onFfmpegPulse };

    emit({
      ...base,
      phase: 'starting',
      stepIndex: 0,
      stepCount,
      stepLabel: 'Preparing export…',
    });

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
        hooks,
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
        hooks,
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
        hooks,
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
    hooks,
  }: {
    ffmpegPath: string;
    sourcePath: string;
    outputDirectory: string | null | undefined;
    segments: EditorPreviewSegment[];
    strategy: EditorExportStrategy;
    sourceHasVideo: boolean;
    sourceExtension: string;
    sourceBaseName: string;
    hooks: ExportProgressHooks;
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
      await this.exportSingleSegment(ffmpegPath, sourcePath, segment, outputPath, strategy, sourceHasVideo, sourceExtension, hooks);
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
    hooks,
  }: {
    ffmpegPath: string;
    request: EditorExportRequest;
    sourceHasVideo: boolean;
    segments: EditorPreviewSegment[];
    sourceExtension: string;
    strategy: EditorExportStrategy;
    hooks: ExportProgressHooks;
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
      await this.exportSingleSegment(ffmpegPath, request.sourcePath, segments[0], outputFilePath, strategy, sourceHasVideo, sourceExtension, hooks);
      return outputFilePath;
    }

    const tempRoot = this.pathsService.getPaths().managedDirectories.temp;
    const workingDirectory = mkdtempSync(join(tempRoot, 'editor-export-'));
    const tempSegmentPaths: string[] = [];

    try {
      for (const [index, segment] of segments.entries()) {
        const tempPath = join(workingDirectory, `segment_${String(index + 1).padStart(2, '0')}${outputExtension}`);
        await this.exportSingleSegment(ffmpegPath, request.sourcePath, segment, tempPath, strategy, sourceHasVideo, sourceExtension, hooks);
        tempSegmentPaths.push(tempPath);
      }

      const concatFilePath = join(workingDirectory, 'segments.txt');
      const concatContent = tempSegmentPaths
        .map((path) => `file '${path.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
        .join('\n');
      writeFileSync(concatFilePath, concatContent, 'utf8');

      hooks.beforeFfmpeg('merge', 'Merging clips into one file…');

      const coreArgs = [
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
      ];

      const { exitCode, stderrTail } = await runFfmpegWithProgress(ffmpegPath, coreArgs, {
        onPulse: hooks.onFfmpegPulse,
      });

      if (exitCode !== 0) {
        throw new ServiceError(
          'MERGE_EXPORT_FAILED',
          strategy === 'stream-copy'
            ? 'ffmpeg could not merge the selected cuts losslessly.'
            : 'ffmpeg could not merge the selected exact cuts.',
          stderrTail || undefined,
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
    hooks: ExportProgressHooks,
  ): Promise<void> {
    this.ensureOutputPathSafe(sourcePath, outputPath);

    const durationSec = Math.max(0, segment.boundary.actualEndSeconds - segment.boundary.actualStartSeconds);
    hooks.beforeFfmpeg('segment', `Cut: ${segment.label}`, durationSec);

    if (strategy === 'stream-copy') {
      await this.runStreamCopyCut(ffmpegPath, sourcePath, segment, outputPath, hooks.onFfmpegPulse);
      return;
    }

    await this.runExactReencodeCut(ffmpegPath, sourcePath, segment, outputPath, sourceHasVideo, sourceExtension, hooks.onFfmpegPulse);
  }

  private async runStreamCopyCut(
    ffmpegPath: string,
    sourcePath: string,
    segment: EditorPreviewSegment,
    outputPath: string,
    onPulse?: (pulse: { outTimeUs?: number; totalSizeBytes?: number; speed?: string }) => void,
  ): Promise<void> {
    const coreArgs = [
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
    ];

    const { exitCode, stderrTail } = await runFfmpegWithProgress(ffmpegPath, coreArgs, { onPulse });

    if (exitCode !== 0) {
      throw new ServiceError(
        'CUT_EXPORT_FAILED',
        `ffmpeg could not export segment "${segment.label}" losslessly.`,
        stderrTail || undefined,
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
    onPulse?: (pulse: { outTimeUs?: number; totalSizeBytes?: number; speed?: string }) => void,
  ): Promise<void> {
    const outputExtension = this.resolveExportExtension(sourceExtension, 're-encode', sourceHasVideo);
    if (sourceHasVideo && !supportedExactVideoExtensions.has(extname(outputPath).toLowerCase() || outputExtension)) {
      throw new ServiceError('EXACT_CONTAINER_UNSUPPORTED', 'Exact video exports currently support MP4, MOV, and MKV outputs.');
    }

    const coreArgs = [
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

    const { exitCode, stderrTail } = await runFfmpegWithProgress(ffmpegPath, coreArgs, { onPulse });

    if (exitCode !== 0) {
      throw new ServiceError(
        'EXACT_EXPORT_FAILED',
        `ffmpeg could not export segment "${segment.label}" with exact timestamps.`,
        stderrTail || undefined,
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
