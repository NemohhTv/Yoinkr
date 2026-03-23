import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import type { AppPathsService } from '@main/services/paths/app-paths-service';
import { ServiceError } from '@main/services/shared/service-error';
import type { BinaryResolver } from './binary-resolver';
import { buildYtDlpCookieArgs } from './yt-dlp-cookie-args';
import type { ItemDownloadRequest, ItemDownloadProgress, ItemDownloadResult } from '@shared/types/downloader';
import type { AppSettings } from '@shared/types/settings';

type ProgressCallback = (progress: ItemDownloadProgress) => void;

const PROGRESS_RE = /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*\S+\s+at\s+(.+?)\s+ETA\s+(\S+)/;
const MERGE_RE = /\[Merger\]|\[Mux\]|\[FixupM|\[VideoRemuxer\]/;
const CONVERT_RE = /\[ExtractAudio\]|\[FFmpeg\]/;

export class YtDlpDownloadService {
  private readonly activeProcesses = new Map<string, ChildProcess>();

  constructor(
    private readonly pathsService: AppPathsService,
    private readonly binaryResolver: BinaryResolver,
  ) {}

  cancelItem(id: string): boolean {
    const child = this.activeProcesses.get(id);
    if (!child || child.killed) return false;
    child.kill();
    this.activeProcesses.delete(id);
    return true;
  }

  async downloadItem(
    request: ItemDownloadRequest,
    settings: AppSettings,
    onProgress: ProgressCallback,
  ): Promise<ItemDownloadResult> {
    const ytDlp = this.binaryResolver.resolveTool('yt-dlp', settings);
    if (!ytDlp.resolvedPath || !ytDlp.exists) {
      throw new ServiceError('TOOL_MISSING', 'yt-dlp is not available. Check Settings > Tool configuration.');
    }

    const ffmpeg = this.binaryResolver.resolveTool('ffmpeg', settings);
    const downloadDir = settings.downloadDirectory || this.pathsService.getPaths().managedDirectories.downloads;
    const tempDir = join(downloadDir, `.tmp-${request.id}`);
    mkdirSync(tempDir, { recursive: true });
    const outputTemplate = join(downloadDir, '%(title).200B.%(ext)s');

    onProgress({
      id: request.id,
      phase: 'downloading',
      percent: 0,
      speed: '',
      eta: '',
      message: 'Starting download...',
    });

    const runAttempt = (
      args: string[],
    ): Promise<ItemDownloadResult> => new Promise<ItemDownloadResult>((resolve) => {
      const child = spawn(ytDlp.resolvedPath!, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });

      this.activeProcesses.set(request.id, child);

      let lastOutputPath: string | null = null;
      let stderr = '';

      const parseLine = (line: string): void => {
        const progressMatch = line.match(PROGRESS_RE);
        if (progressMatch) {
          onProgress({
            id: request.id,
            phase: 'downloading',
            percent: Math.min(99, Math.round(parseFloat(progressMatch[1]))),
            speed: progressMatch[2],
            eta: progressMatch[3],
            message: `Downloading... ${progressMatch[1]}%`,
          });
          return;
        }

        if (MERGE_RE.test(line)) {
          onProgress({
            id: request.id,
            phase: 'merging',
            percent: 99,
            speed: '',
            eta: '',
            message: 'Merging video and audio...',
          });
          return;
        }

        if (CONVERT_RE.test(line)) {
          onProgress({
            id: request.id,
            phase: 'converting',
            percent: 99,
            speed: '',
            eta: '',
            message: 'Converting audio...',
          });
          return;
        }

        if (line.includes('[download] 100%')) {
          onProgress({
            id: request.id,
            phase: 'downloading',
            percent: 100,
            speed: '',
            eta: '',
            message: 'Download complete, finalizing...',
          });
        }

        const destMatch = line.match(/(?:Merging formats into|Destination:)\s+"?(.+?)"?\s*$/);
        if (destMatch) {
          lastOutputPath = destMatch[1].replace(/^"/, '').replace(/"$/, '');
        }

        const alreadyMatch = line.match(/\[download\]\s+(.+?)\s+has already been downloaded/);
        if (alreadyMatch) {
          lastOutputPath = alreadyMatch[1];
        }

        const movingMatch = line.match(/Moving file\s+"?(.+?)"?\s+to\s+"?(.+?)"?\s*$/);
        if (movingMatch) {
          lastOutputPath = movingMatch[2].replace(/^"/, '').replace(/"$/, '');
        }

        const cleaned = line.trim().replace(/^"/, '').replace(/"$/, '');
        if (!line.startsWith('[') && !line.startsWith('Deleting') && /^[A-Z]:\\/i.test(cleaned)) {
          lastOutputPath = cleaned;
        }
      };

      let stdoutBuffer = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split(/\r\n|\r|\n/);
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim()) parseLine(line);
        }
      });

      let stderrBuffer = '';
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        stderrBuffer += text;
        const lines = stderrBuffer.split(/\r\n|\r|\n/);
        stderrBuffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim()) parseLine(line);
        }
      });

      const timeoutHandle = setTimeout(() => {
        if (!child.killed) {
          child.kill();
          rmSync(tempDir, { recursive: true, force: true });
          const msg = 'Download timed out after 30 minutes.';
          onProgress({ id: request.id, phase: 'error', percent: 0, speed: '', eta: '', message: msg });
          resolve({ id: request.id, success: false, outputPath: null, error: msg });
        }
      }, 30 * 60 * 1000);

      child.on('error', (err) => {
        clearTimeout(timeoutHandle);
        this.activeProcesses.delete(request.id);
        onProgress({ id: request.id, phase: 'error', percent: 0, speed: '', eta: '', message: err.message });
        resolve({ id: request.id, success: false, outputPath: null, error: err.message });
      });

      child.on('close', (exitCode, signal) => {
        clearTimeout(timeoutHandle);
        this.activeProcesses.delete(request.id);

        if (stdoutBuffer.trim()) parseLine(stdoutBuffer.trim());
        if (stderrBuffer.trim()) parseLine(stderrBuffer.trim());
        stdoutBuffer = '';
        stderrBuffer = '';

        if (signal === 'SIGTERM' || signal === 'SIGKILL') {
          rmSync(tempDir, { recursive: true, force: true });
          const msg = 'Download cancelled.';
          onProgress({ id: request.id, phase: 'error', percent: 0, speed: '', eta: '', message: msg });
          resolve({ id: request.id, success: false, outputPath: null, error: msg });
          return;
        }

        if (exitCode === 0) {
          rmSync(tempDir, { recursive: true, force: true });
          onProgress({
            id: request.id,
            phase: 'complete',
            percent: 100,
            speed: '',
            eta: '',
            message: 'Download complete!',
          });
          resolve({ id: request.id, success: true, outputPath: lastOutputPath });
        } else {
          rmSync(tempDir, { recursive: true, force: true });
          const errorMsg = this.extractErrorMessage(stderr);
          onProgress({ id: request.id, phase: 'error', percent: 0, speed: '', eta: '', message: errorMsg });
          resolve({ id: request.id, success: false, outputPath: null, error: errorMsg });
        }
      });

    });

    return runAttempt(
      this.buildArgs(request, outputTemplate, tempDir, ffmpeg.resolvedPath, settings),
    );
  }

  private buildArgs(
    request: ItemDownloadRequest,
    outputTemplate: string,
    tempDir: string,
    ffmpegPath: string | null,
    settings: AppSettings,
  ): string[] {
    const args: string[] = [
      '--ignore-config',
      '--js-runtimes', 'node',
      '--no-playlist', '--newline', '--no-warnings', '--progress',
      '--print', 'after_move:filepath',
      '-P', `temp:${tempDir}`,
      '-o', outputTemplate,
    ];

    args.push(...buildYtDlpCookieArgs(settings, this.pathsService));

    if (ffmpegPath && existsSync(ffmpegPath)) {
      args.push('--ffmpeg-location', ffmpegPath);
    }

    args.push(...this.buildSelectionArgs(request));

    if (request.mediaType === 'audio-only' || request.audioOnly) {
      args.push('-x', '--audio-format', this.mapAudioFormat(request.outputFormat));
    } else if (request.outputFormat !== 'original') {
      args.push('--remux-video', request.outputFormat);
    }

    args.push(request.url);
    return args;
  }

  private buildSelectionArgs(request: ItemDownloadRequest): string[] {
    const heightFilter = this.getHeightFilter(request.qualityTarget);
    const selectors: string[] = [];
    const sortFields: string[] = [];

    if (request.mediaType === 'audio-only' || request.audioOnly) {
      selectors.push('bestaudio/best');

      if (request.audioPreference === 'aac') {
        sortFields.push('aext:m4a');
      } else if (request.audioPreference === 'opus') {
        sortFields.push('acodec:opus', 'aext:webm');
      }
    } else if (request.mediaType === 'video-only') {
      selectors.push(
        heightFilter
          ? `bestvideo*[height<=${heightFilter}]/bestvideo[height<=${heightFilter}]/bestvideo*/bestvideo/best[height<=${heightFilter}]/best`
          : 'bestvideo*/bestvideo/best',
      );

      if (heightFilter) {
        sortFields.push(`res:${heightFilter}`);
      }
      sortFields.push(...this.getContainerSortBias(request.outputFormat, false, request.audioPreference));
    } else {
      selectors.push(
        heightFilter
          ? `bestvideo*[height<=${heightFilter}]+bestaudio/bestvideo[height<=${heightFilter}]+bestaudio/best[height<=${heightFilter}]/bestvideo*+bestaudio/best`
          : 'bestvideo*+bestaudio/bestvideo+bestaudio/best',
      );

      if (heightFilter) {
        sortFields.push(`res:${heightFilter}`);
      }
      sortFields.push(...this.getContainerSortBias(request.outputFormat, true, request.audioPreference));
    }

    const args = ['-f', selectors.join('/')];
    const uniqueSortFields = [...new Set(sortFields.filter(Boolean))];
    if (uniqueSortFields.length > 0) {
      args.push('-S', uniqueSortFields.join(','));
    }

    return args;
  }

  private getHeightFilter(quality: ItemDownloadRequest['qualityTarget']): number | null {
    const map: Record<string, number> = { '2160p': 2160, '1440p': 1440, '1080p': 1080, '720p': 720, '480p': 480 };
    return map[quality] ?? null;
  }

  private getContainerSortBias(
    outputFormat: ItemDownloadRequest['outputFormat'],
    includeAudio: boolean,
    audioPreference: ItemDownloadRequest['audioPreference'],
  ): string[] {
    const sortFields: string[] = [];

    if (outputFormat === 'mp4') {
      sortFields.push('vext:mp4');
      if (includeAudio) {
        sortFields.push('aext:m4a');
      }
    } else if (outputFormat === 'webm') {
      sortFields.push('vext:webm');
      if (includeAudio) {
        sortFields.push('aext:webm');
      }
    }

    if (includeAudio) {
      if (audioPreference === 'aac') {
        sortFields.push('aext:m4a');
      } else if (audioPreference === 'opus') {
        sortFields.push('acodec:opus', 'aext:webm');
      }
    }

    return sortFields;
  }

  private mapAudioFormat(format: string): string {
    const map: Record<string, string> = { mp3: 'mp3', m4a: 'm4a', wav: 'wav', flac: 'flac' };
    return map[format] ?? 'mp3';
  }

  private extractErrorMessage(stderr: string): string {
    const lines = stderr.split(/\r?\n/).filter(Boolean);
    const errorLine = lines.find((l) => l.toLowerCase().includes('error'));
    return errorLine?.replace(/^ERROR:\s*/i, '').trim() || 'Download failed. Check yt-dlp output for details.';
  }
}

