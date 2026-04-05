import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import type { WriteStream } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import treeKill from 'tree-kill';

import type { AppPathsService } from '@main/services/paths/app-paths-service';
import { ServiceError } from '@main/services/shared/service-error';
import type { BinaryResolver } from './binary-resolver';
import { findLatestOutputByDownloadId } from './download-output-resolver';
import { buildYtDlpCookieArgs, prepareYtDlpCookieSource } from './yt-dlp-cookie-args';
import { getDenoPathEnvForYtDlpSpawn, getYtDlpJsRuntimeCliArgs } from './yt-dlp-js-runtime';
import {
  appendYtDlpConcurrentFragmentsArg,
  appendYtDlpSleepArgs,
  effectiveSectionConcurrentFragments,
} from './yt-dlp-throttle-args';
import { isAudioDestinationDownload } from '@shared/lib/download-destination';
import type { ItemDownloadRequest, ItemDownloadProgress, ItemDownloadResult } from '@shared/types/downloader';
import type { AppSettings } from '@shared/types/settings';

type ProgressCallback = (progress: ItemDownloadProgress) => void;

/** Safe base name for final on-disk title (yt-dlp still writes `id__…` first for reliable lookup). */
const sanitizeDownloadDisplayName = (name: string): string => {
  const trimmed = name.trim();
  const withoutInvalidChars = Array.from(trimmed)
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || '<>:"/\\|?*'.includes(character) ? '_' : character;
    })
    .join('');
  const collapsed = withoutInvalidChars.replace(/\s+/g, ' ').trim();
  return collapsed.slice(0, 180) || 'Video';
};

const stripAnsi = (line: string): string =>
  line
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

/** Last resort: any `[download]` line containing `12.3%` (ANSI already stripped). */
const LOOSE_DOWNLOAD_PERCENT_RE = /\[download\][^\n]*?(\d+(?:\.\d+)?)\s*%/;

/** yt-dlp writes `.part` / temp files here — grows even when piped stderr is block-buffered. */
function sumBytesInTempDir(dir: string): number {
  let total = 0;
  try {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      try {
        const st = statSync(p);
        if (st.isFile()) {
          total += st.size;
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* directory may not exist yet */
  }
  return total;
}

/** Temp fragments + `id__…` partials in the download folder (Windows pipe buffering may hide stderr progress). */
function sumStreamingBytesForDownload(tempDir: string, downloadDir: string, downloadId: string): number {
  let total = sumBytesInTempDir(tempDir);
  try {
    for (const name of readdirSync(downloadDir)) {
      if (!name.startsWith(downloadId)) {
        continue;
      }
      const p = join(downloadDir, name);
      try {
        const st = statSync(p);
        if (st.isFile()) {
          total += st.size;
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return total;
}

/** Standard: `[download]  45.2% of 100.00MiB at  2.50MiB/s ETA 00:45` */
const PROGRESS_RE = /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*\S+\s+at\s+(.+?)\s+ETA\s+(\S+)/;
/** Finished: `[download] 100% of 1.23GiB in 00:05 at 2.5MiB/s` (no `ETA`). */
const PROGRESS_RE_FINISHED = /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*\S+\s+in\s+(\S+)\s+at\s+(.+)/;
/** When total size unknown: `[download] 123.45KiB at 2.50MiB/s (00:01:23)` — often no `%` (see yt-dlp `FileDownloader.report_progress`). */
const PROGRESS_RE_BYTES_ELAPSED = /\[download\]\s+(\S+)\s+at\s+(.+?)\s+\(([^)]+)\)(?:\s+\(frag\s+(\d+)\/(\d+)\))?/;
/** Default template: `[download]  45.1% at 2.50MiB/s ETA 00:45` */
const PROGRESS_RE_PERCENT_ONLY = /\[download\]\s+(\d+(?:\.\d+)?)%\s+at\s+(.+?)\s+ETA\s+(\S+)/;
/** Fragment-only hint on a line that also has percent: `... (frag 12/1500)` */
const FRAG_RE = /\(frag\s+(\d+)\/(\d+)\)/;
/** yt-dlp post-processors (merge, remux, re-encode, embed, fixups). */
const POSTPROCESS_TAG_RE =
  /\[(?:Merger|Mux|VideoRemuxer|VideoConvertor|ExtractAudio|EmbedSubtitle|EmbedThumbnail|FFmpeg|FixupM[^\]]*)\]/i;
/** ffmpeg progress while muxing/encoding (emitted on stderr during long remux). */
const FFMPEG_TIME_RE = /\btime=(\d{2}:\d{2}:\d{2}\.\d{2})\b/;
/** Large downloads + merge + AAC remux can exceed 30 minutes. */
const DOWNLOAD_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const FFMPEG_PROGRESS_THROTTLE_MS = 450;
/**
 * Older yt-dlp builds (e.g. 2023.01.17) have much worse `--download-sections` behavior/perf on YouTube.
 * Gate section downloads to a modern baseline so users update instead of waiting on near-full fetches.
 */
const MIN_YT_DLP_SECTION_VERSION = { year: 2024, month: 7, day: 1 } as const;
/** Treat start/end within this many seconds of 0 / duration as “full video” (no `--download-sections`). */
const DOWNLOAD_SECTION_FULL_SPAN_EPS_SEC = 0.75;
/** Larger HTTP reads can reduce per-request overhead / mild throttling on fragment URLs. */
const SECTION_HTTP_CHUNK_SIZE = '16M';

/** First line of `tool -version` for download logs. */
function toolVersionLine(command: string | null | undefined, versionArgs: string[]): string {
  if (!command || !existsSync(command)) {
    return 'unavailable';
  }
  try {
    const r = spawnSync(command, versionArgs, { encoding: 'utf8', timeout: 8000, windowsHide: true });
    const line = `${r.stdout ?? ''}`.split(/\r?\n/).find((l) => l.trim()) ?? '';
    return line.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Strip heartbeat-appended ` (NNs)` tails so messages do not chain `(3s) (6s) (9s)…`. */
function stripElapsedSuffixFromProgressMessage(msg: string): string {
  return msg.replace(/(?:\s*\(\d+s\))+$/u, '').trim();
}

export class YtDlpDownloadService {
  private readonly activeProcesses = new Map<string, ChildProcess>();
  /** User pressed Stop — used because Windows often reports `signal: null` on killed children. */
  private readonly userCancelledDownloadIds = new Set<string>();

  constructor(
    private readonly pathsService: AppPathsService,
    private readonly binaryResolver: BinaryResolver,
  ) {}

  private buildYtDlpChildEnv(settings: AppSettings): NodeJS.ProcessEnv {
    const denoPathPatch = getDenoPathEnvForYtDlpSpawn(settings, this.binaryResolver);
    return {
      ...process.env,
      ...denoPathPatch,
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    } as NodeJS.ProcessEnv;
  }

  /** Aligns folder choice, `-f`, and `-x` with queue card output (handles desynced `audioOnly`). */
  private requestIsAudioDownload(request: ItemDownloadRequest): boolean {
    return isAudioDestinationDownload({
      mediaType: request.mediaType,
      audioOnly: request.audioOnly,
      outputFormat: request.outputFormat,
    });
  }

  /** Video / muxed output uses `downloadDirectory`; audio jobs use `audioDownloadDirectory` when set. */
  private resolveDownloadDirectory(settings: AppSettings, request: ItemDownloadRequest): string {
    const fallback = this.pathsService.getPaths().managedDirectories.downloads;
    const videoDir = (settings.downloadDirectory || fallback).trim() || fallback;
    if (!this.requestIsAudioDownload(request)) {
      return videoDir;
    }
    const audioExplicit = settings.audioDownloadDirectory?.trim();
    return audioExplicit ? audioExplicit : videoDir;
  }

  cancelItem(id: string): boolean {
    this.userCancelledDownloadIds.add(id);
    let killed = false;

    for (const key of [id, `${id}__video`, `${id}__audio`]) {
      const child = this.activeProcesses.get(key);
      if (child && !child.killed) {
        killed = true;
        const pid = child.pid;
        if (pid != null) {
          treeKill(pid, 'SIGKILL', () => {});
        } else {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
        }
        this.activeProcesses.delete(key);
      }
    }

    return killed;
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
    if (
      this.requiresPartialSectionDownload(request) &&
      (!ffmpeg.resolvedPath || !existsSync(ffmpeg.resolvedPath))
    ) {
      throw new ServiceError(
        'TOOL_MISSING',
        'Downloading part of a video requires ffmpeg. Configure it in Settings > Tool configuration.',
      );
    }
    if (this.requiresPartialSectionDownload(request) && this.isYtDlpTooOldForSections(ytDlp.resolvedPath)) {
      throw new ServiceError(
        'TOOL_MISSING',
        'Section downloads require a newer yt-dlp. In Settings, click "Update yt-dlp" and retry.',
      );
    }

    const cookiePrepared = prepareYtDlpCookieSource(settings, this.pathsService);
    if (cookiePrepared.authBlocked) {
      throw new ServiceError(
        'COOKIE_CONFIG',
        cookiePrepared.authBlockedReason ?? 'Fix cookie settings in Settings before downloading.',
      );
    }

    const downloadDir = this.resolveDownloadDirectory(settings, request);
    const outputTemplate = join(downloadDir, `${request.id}__%(title).200B.%(ext)s`);

    if (this.requiresPartialSectionDownload(request)) {
      if (this.requestIsAudioDownload(request)) {
        return this.downloadSectionAudioOnly(request, settings, onProgress, downloadDir);
      }
      if (request.mediaType === 'video-only') {
        return this.downloadSectionVideoOnly(request, settings, onProgress, downloadDir);
      }
      return this.downloadSectionParallel(request, settings, onProgress, downloadDir);
    }

    onProgress({
      id: request.id,
      phase: 'downloading',
      percent: 0,
      speed: '',
      eta: '',
      message: 'Starting download...',
    });

    const tempDir = join(downloadDir, `.tmp-${request.id}`);
    mkdirSync(tempDir, { recursive: true });

    const runAttempt = (
      args: string[],
      attemptOpts?: { allowMergeStallRecovery?: boolean },
    ): Promise<ItemDownloadResult> => new Promise<ItemDownloadResult>((resolve) => {
      const allowMergeStallRecovery = attemptOpts?.allowMergeStallRecovery !== false;
      const logsDownloadsDir = join(this.pathsService.getPaths().managedDirectories.logs, 'downloads');
      let downloadLogStream: WriteStream | null = null;
      if (settings.saveDownloadLogs) {
        try {
          mkdirSync(logsDownloadsDir, { recursive: true });
          const safeTime = new Date().toISOString().replace(/[:.]/g, '-');
          const logPath = join(logsDownloadsDir, `${request.id.slice(0, 8)}-${safeTime}.log`);
          downloadLogStream = createWriteStream(logPath, { flags: 'a' });
          downloadLogStream.write(
            [
              '# Yoinkr yt-dlp session log',
              `# id=${request.id}`,
              `# url=${request.url}`,
              `# platform=${process.platform} arch=${process.arch}`,
              `# yt-dlp=${ytDlp.resolvedPath ?? ''}`,
              `# ffmpeg=${ffmpeg.resolvedPath ?? ''}`,
              `# output=${request.outputFormat} audioPref=${request.audioPreference}`,
              `# started=${new Date().toISOString()}`,
              '',
              '',
            ].join('\n'),
          );
          downloadLogStream.write(`# yt-dlp_version=${toolVersionLine(ytDlp.resolvedPath, ['--version'])}\n`);
          downloadLogStream.write(`# ffmpeg_version=${toolVersionLine(ffmpeg.resolvedPath, ['-version'])}\n`);
          downloadLogStream.write(`# args_json=${JSON.stringify(args)}\n\n`);
        } catch {
          downloadLogStream = null;
        }
      }

      const endDownloadLog = (footer: string): void => {
        if (!downloadLogStream) {
          return;
        }
        try {
          downloadLogStream.write(`\n${footer}\n`);
          downloadLogStream.end();
        } catch {
          /* ignore */
        }
        downloadLogStream = null;
      };

      const child = spawn(ytDlp.resolvedPath!, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: this.buildYtDlpChildEnv(settings),
      });

      this.activeProcesses.set(request.id, child);

      let lastOutputPath: string | null = null;
      let stderr = '';
      let inHeavyPostprocess = false;
      let lastFfmpegProgressEmit = 0;
      /** When yt-dlp omits total size, percent is unknown — advance gently until fragment ratio appears. */
      let pseudoPercent = 0;

      let lastProgressEmitAt = Date.now();
      let lastShownPercent = 0;
      let mergeWatchdog: ReturnType<typeof setInterval> | null = null;
      let lastSubstantiveStderrAt = Date.now();
      /** Clip heartbeat used to force `downloading` at 99% and overwrote merge/ffmpeg UI — keep post-process phases stable. */
      let heavyPostprocessSince: number | null = null;
      let lastPostUi: { phase: 'merging' | 'converting'; message: string } | null = null;
      let mergeStallWatchStart: number | null = null;
      let lastMergeDiskBytes = 0;
      let lastMergeDiskBytesChangedAt = Date.now();
      let settled = false;
      let mergeStallKillPending = false;
      let lastDiagPhase: ItemDownloadProgress['phase'] | null = null;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      const emit = (p: ItemDownloadProgress): void => {
        lastProgressEmitAt = Date.now();
        if (downloadLogStream && p.phase !== lastDiagPhase) {
          lastDiagPhase = p.phase;
          downloadLogStream.write(`\n# [${new Date().toISOString()}] phase: ${p.phase}\n`);
        }
        if (p.phase === 'merging' || p.phase === 'converting') {
          heavyPostprocessSince ??= Date.now();
          lastPostUi = {
            phase: p.phase,
            message: stripElapsedSuffixFromProgressMessage(p.message),
          };
        }
        let out = p;
        if (p.phase === 'downloading') {
          const pct = Math.max(p.percent, lastShownPercent);
          out = { ...p, percent: pct };
        }
        if (out.percent > lastShownPercent) {
          lastShownPercent = out.percent;
        }
        onProgress(out);
      };

      const clearMergeWatchdog = (): void => {
        if (mergeWatchdog != null) {
          clearInterval(mergeWatchdog);
          mergeWatchdog = null;
        }
      };

      const finish = (out: ItemDownloadResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        clearMergeWatchdog();
        this.activeProcesses.delete(request.id);
        resolve(out);
      };

      const mergingMessage = 'Combining streams and writing the final file…';

      const parseLine = (line: string): void => {
        const clean = stripAnsi(line).trim();
        if (!clean) {
          return;
        }

        const progressMatch = clean.match(PROGRESS_RE);
        if (progressMatch) {
          const pctRaw = parseFloat(progressMatch[1]);
          if (pctRaw >= 99.5) {
            inHeavyPostprocess = true;
            emit({
              id: request.id,
              phase: 'merging',
              percent: 99,
              speed: '',
              eta: '',
              message: mergingMessage,
            });
            return;
          }
          let pct = Math.min(99, Math.round(pctRaw));
          const fragMatch = clean.match(FRAG_RE);
          if (fragMatch) {
            const fi = parseInt(fragMatch[1], 10);
            const fn = parseInt(fragMatch[2], 10);
            if (fn > 0) {
              pct = Math.min(99, Math.max(pct, Math.round((fi / fn) * 100)));
            }
          }
          emit({
            id: request.id,
            phase: 'downloading',
            percent: pct,
            speed: progressMatch[2].trim(),
            eta: progressMatch[3],
            message: `Download: ${progressMatch[1]}%`,
          });
          return;
        }

        const finishedMatch = clean.match(PROGRESS_RE_FINISHED);
        if (finishedMatch) {
          const pctRaw = parseFloat(finishedMatch[1]);
          if (pctRaw >= 99.5) {
            inHeavyPostprocess = true;
            emit({
              id: request.id,
              phase: 'merging',
              percent: 99,
              speed: '',
              eta: '',
              message: mergingMessage,
            });
            return;
          }
          emit({
            id: request.id,
            phase: 'downloading',
            percent: Math.min(99, Math.round(pctRaw)),
            speed: finishedMatch[3].trim(),
            eta: '',
            message: `Download: ${finishedMatch[1]}% (in ${finishedMatch[2]})`,
          });
          return;
        }

        const percentOnlyMatch = clean.match(PROGRESS_RE_PERCENT_ONLY);
        if (percentOnlyMatch) {
          const pctRaw = parseFloat(percentOnlyMatch[1]);
          if (pctRaw >= 99.5) {
            inHeavyPostprocess = true;
            emit({
              id: request.id,
              phase: 'merging',
              percent: 99,
              speed: '',
              eta: '',
              message: mergingMessage,
            });
            return;
          }
          emit({
            id: request.id,
            phase: 'downloading',
            percent: Math.min(99, Math.round(pctRaw)),
            speed: percentOnlyMatch[2].trim(),
            eta: percentOnlyMatch[3],
            message: `Download: ${percentOnlyMatch[1]}%`,
          });
          return;
        }

        const bytesMatch = clean.match(PROGRESS_RE_BYTES_ELAPSED);
        if (bytesMatch) {
          let pct: number;
          if (bytesMatch[4] != null && bytesMatch[5] != null) {
            const fi = parseInt(bytesMatch[4], 10);
            const fn = parseInt(bytesMatch[5], 10);
            pct = fn > 0 ? Math.min(99, Math.round((fi / fn) * 100)) : Math.min(90, pseudoPercent + 3);
            pseudoPercent = pct;
          } else {
            pseudoPercent = Math.min(90, pseudoPercent + 3);
            pct = pseudoPercent;
          }
          emit({
            id: request.id,
            phase: 'downloading',
            percent: pct,
            speed: bytesMatch[2].trim(),
            eta: '',
            message: `Download: ${bytesMatch[1]} at ${bytesMatch[2].trim()} (${bytesMatch[3]})`,
          });
          return;
        }

        const loosePct = clean.match(LOOSE_DOWNLOAD_PERCENT_RE);
        if (loosePct) {
          const pctRaw = parseFloat(loosePct[1]);
          if (pctRaw >= 99.5) {
            inHeavyPostprocess = true;
            emit({
              id: request.id,
              phase: 'merging',
              percent: 99,
              speed: '',
              eta: '',
              message: mergingMessage,
            });
            return;
          }
          let pct = Math.min(99, Math.round(pctRaw));
          const fragMatch = clean.match(FRAG_RE);
          if (fragMatch) {
            const fi = parseInt(fragMatch[1], 10);
            const fn = parseInt(fragMatch[2], 10);
            if (fn > 0) {
              pct = Math.min(99, Math.max(pct, Math.round((fi / fn) * 100)));
            }
          }
          emit({
            id: request.id,
            phase: 'downloading',
            percent: pct,
            speed: '',
            eta: '',
            message: `Download: ${loosePct[1]}%`,
          });
          return;
        }

        const ffmpegTimeEarly = clean.match(FFMPEG_TIME_RE);
        const ffmpegStderrLooksActive =
          ffmpegTimeEarly != null ||
          /\bframe=\s*\d+/i.test(clean) ||
          /\[ffmpeg\]/i.test(clean) ||
          /\bPress \[q\] to stop/i.test(clean);

        if (ffmpegStderrLooksActive) {
          if (!inHeavyPostprocess) {
            inHeavyPostprocess = true;
            emit({
              id: request.id,
              phase: 'converting',
              percent: 99,
              speed: '',
              eta: '',
              message: 'Processing output (ffmpeg)…',
            });
          }
          if (ffmpegTimeEarly) {
            const now = Date.now();
            if (now - lastFfmpegProgressEmit >= FFMPEG_PROGRESS_THROTTLE_MS) {
              lastFfmpegProgressEmit = now;
              emit({
                id: request.id,
                phase: 'converting',
                percent: 99,
                speed: '',
                eta: '',
                message: `Output position: ${ffmpegTimeEarly[1]}`,
              });
            }
          }
          return;
        }

        const postTagMatch = clean.match(POSTPROCESS_TAG_RE);
        if (postTagMatch) {
          inHeavyPostprocess = true;
          mergeStallWatchStart ??= Date.now();
          if (downloadLogStream) {
            downloadLogStream.write(`\n# [${new Date().toISOString()}] postprocessor: ${postTagMatch[0]}\n`);
          }
          const tag = postTagMatch[0].toLowerCase();
          const encodingLike =
            tag.includes('extractaudio') ||
            tag.includes('videoconvertor') ||
            tag.includes('videoremuxer') ||
            tag.includes('ffmpeg') ||
            tag.includes('embedsubtitle') ||
            tag.includes('embedthumbnail');
          emit({
            id: request.id,
            phase: encodingLike ? 'converting' : 'merging',
            percent: 99,
            speed: '',
            eta: '',
            message: encodingLike ? 'Encoding / remuxing…' : 'Merging streams…',
          });
          return;
        }

        if (/\[download\][^\n]*\b100(?:\.\d+)?%/.test(clean)) {
          inHeavyPostprocess = true;
          emit({
            id: request.id,
            phase: 'merging',
            percent: 99,
            speed: '',
            eta: '',
            message: mergingMessage,
          });
          return;
        }

        const destMatch = clean.match(/(?:Merging formats into|Destination:)\s+"?(.+?)"?\s*$/);
        if (destMatch) {
          lastOutputPath = destMatch[1].replace(/^"/, '').replace(/"$/, '');
        }

        const alreadyMatch = clean.match(/\[download\]\s+(.+?)\s+has already been downloaded/);
        if (alreadyMatch) {
          lastOutputPath = alreadyMatch[1];
        }

        const movingMatch = clean.match(/Moving file\s+"?(.+?)"?\s+to\s+"?(.+?)"?\s*$/);
        if (movingMatch) {
          lastOutputPath = movingMatch[2].replace(/^"/, '').replace(/"$/, '');
        }

        const pathGuess = clean.trim().replace(/^"/, '').replace(/"$/, '');
        if (!clean.startsWith('[') && !clean.startsWith('Deleting') && /^[A-Z]:\\/i.test(pathGuess)) {
          lastOutputPath = pathGuess;
        }
      };

      /**
       * Buffer stdout/stderr and split on `\n` after normalizing `\r` → `\n` so `\r`-only progress
       * lines flush (readline + pipes on Windows can still coalesce oddly with the bundled exe).
       */
      const outBuf = { s: '' };
      const errBuf = { s: '' };
      const feedStream = (acc: { s: string }, chunk: Buffer, accumulateStderr: boolean): void => {
        acc.s += chunk.toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        let idx: number;
        while ((idx = acc.s.indexOf('\n')) >= 0) {
          const line = acc.s.slice(0, idx);
          acc.s = acc.s.slice(idx + 1);
          if (accumulateStderr) {
            stderr += `${line}\n`;
            if (downloadLogStream && line.length > 0) {
              downloadLogStream.write(`${line}\n`);
            }
            const tl = line.toLowerCase();
            if (
              tl.includes('[download]') ||
              tl.includes('[merger') ||
              tl.includes('ffmpeg') ||
              tl.includes('[mux') ||
              tl.includes('remux') ||
              tl.includes('[fixup') ||
              tl.includes('[videoremuxer') ||
              tl.includes('stream #') ||
              tl.includes('output #') ||
              /\bframe=\s*\d+/i.test(line) ||
              /\bsize=\s*\d+/i.test(line)
            ) {
              lastSubstantiveStderrAt = Date.now();
            }
          }
          if (line.trim()) {
            parseLine(line);
          }
        }
      };

      child.stdout.on('data', (c: Buffer) => feedStream(outBuf, c, false));
      child.stderr.on('data', (c: Buffer) => feedStream(errBuf, c, true));

      if (allowMergeStallRecovery) {
        mergeWatchdog = setInterval(() => {
          if (settled || child.killed) {
            return;
          }
          const bytes = sumStreamingBytesForDownload(tempDir, downloadDir, request.id);
          if (bytes !== lastMergeDiskBytes) {
            lastMergeDiskBytes = bytes;
            lastMergeDiskBytesChangedAt = Date.now();
          }
          const stableMs = Date.now() - lastMergeDiskBytesChangedAt;
          const heavySince = heavyPostprocessSince != null ? Date.now() - heavyPostprocessSince : 0;
          const mergeLongIdle =
            mergeStallWatchStart != null &&
            Date.now() - mergeStallWatchStart >= 5 * 60 * 1000 &&
            stableMs >= 90 * 1000 &&
            inHeavyPostprocess;
          const fallbackStall =
            mergeStallWatchStart == null &&
            inHeavyPostprocess &&
            heavySince >= 12 * 60 * 1000 &&
            stableMs >= 3 * 60 * 1000;
          if (mergeLongIdle || fallbackStall) {
            downloadLogStream?.write(
              `\n# [${new Date().toISOString()}] MERGE_STALL_WATCHDOG mergeLongIdle=${mergeLongIdle} fallbackStall=${fallbackStall} stableMs=${stableMs} heavySince=${heavySince}\n`,
            );
            mergeStallKillPending = true;
            const pid = child.pid;
            if (pid != null) {
              treeKill(pid, 'SIGKILL', () => {});
            } else {
              try {
                child.kill('SIGKILL');
              } catch {
                /* ignore */
              }
            }
          }
        }, 30_000);
      }

      timeoutHandle = setTimeout(() => {
        if (!child.killed) {
          clearMergeWatchdog();
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
          const pid = child.pid;
          if (pid != null) {
            treeKill(pid, 'SIGKILL', () => {});
          } else {
            try {
              child.kill('SIGKILL');
            } catch {
              /* ignore */
            }
          }
          rmSync(tempDir, { recursive: true, force: true });
          const hours = DOWNLOAD_TIMEOUT_MS / (60 * 60 * 1000);
          const msg = `Download timed out after ${hours} hours.`;
          endDownloadLog(`# timeout after ${hours}h`);
          onProgress({ id: request.id, phase: 'error', percent: 0, speed: '', eta: '', message: msg });
          finish({ id: request.id, success: false, outputPath: null, error: msg });
        }
      }, DOWNLOAD_TIMEOUT_MS);

      child.on('error', (err) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        clearMergeWatchdog();
        endDownloadLog(`# spawn/process error: ${err.message}`);
        onProgress({ id: request.id, phase: 'error', percent: 0, speed: '', eta: '', message: err.message });
        finish({ id: request.id, success: false, outputPath: null, error: err.message });
      });

      child.on('close', (exitCode, signal) => {
        if (settled) {
          return;
        }
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        clearMergeWatchdog();

        if (outBuf.s.trim()) {
          parseLine(outBuf.s);
        }
        if (errBuf.s.trim()) {
          parseLine(errBuf.s);
        }
        if (errBuf.s.trim() && downloadLogStream) {
          downloadLogStream.write(`\n# --- stderr tail (unflushed) ---\n${errBuf.s}\n`);
        }

        if (mergeStallKillPending) {
          mergeStallKillPending = false;
          rmSync(tempDir, { recursive: true, force: true });
          endDownloadLog(`# exitCode=${exitCode ?? 'null'} signal=${signal ?? 'null'} (merge-stall watchdog)`);
          onProgress({
            id: request.id,
            phase: 'downloading',
            percent: Math.min(lastShownPercent, 99),
            speed: '',
            eta: '',
            message: 'Merge stalled — retrying once…',
          });
          finish({
            id: request.id,
            success: false,
            outputPath: null,
            error: 'Merge step produced no disk progress. Retrying once with safer settings.',
            mergeStallRetry: allowMergeStallRecovery,
          });
          return;
        }

        endDownloadLog(`# exitCode=${exitCode ?? 'null'} signal=${signal ?? 'null'}`);

        const userCancelled = this.userCancelledDownloadIds.delete(request.id);
        if (userCancelled || signal === 'SIGTERM' || signal === 'SIGKILL') {
          rmSync(tempDir, { recursive: true, force: true });
          const msg = 'Download cancelled.';
          onProgress({ id: request.id, phase: 'error', percent: 0, speed: '', eta: '', message: msg });
          finish({ id: request.id, success: false, outputPath: null, error: msg });
          return;
        }

        if (exitCode === 0) {
          rmSync(tempDir, { recursive: true, force: true });
          let finalPath = lastOutputPath;
          if (!finalPath || !existsSync(finalPath)) {
            finalPath = findLatestOutputByDownloadId(downloadDir, request.id);
          }
          if (finalPath && existsSync(finalPath)) {
            finalPath = this.renameToFriendlyTitle(finalPath, request);
          }
          if (!finalPath || !existsSync(finalPath)) {
            const msg =
              'Download reported success but no output file was found. Check Settings → download logs, or try a lower quality / Opus audio.';
            onProgress({ id: request.id, phase: 'error', percent: 0, speed: '', eta: '', message: msg });
            finish({ id: request.id, success: false, outputPath: null, error: msg });
            return;
          }
          onProgress({
            id: request.id,
            phase: 'complete',
            percent: 100,
            speed: '',
            eta: '',
            message: 'Download complete!',
          });
          finish({ id: request.id, success: true, outputPath: finalPath });
        } else {
          rmSync(tempDir, { recursive: true, force: true });
          const errorMsg = this.extractErrorMessage(stderr);
          onProgress({ id: request.id, phase: 'error', percent: 0, speed: '', eta: '', message: errorMsg });
          finish({ id: request.id, success: false, outputPath: null, error: errorMsg });
        }
      });

    });

    /**
     * Copy-first when DASH serves m4a audio avoids slow Opus→AAC transcode in VideoRemuxer.
     * If audio is still Opus, postprocess fails and we retry once with encode
     * (`shouldRetryMp4WithAacEncodeAfterCopyRemuxFailure`).
     */
    const tryM4aCopyRemux = this.prefersM4aDashAudio(request);

    const runWithRemuxMode = (selection: string[] | undefined, mode: 'copy' | 'encode'): string[] =>
      this.buildArgs(request, outputTemplate, tempDir, ffmpeg.resolvedPath, settings, selection, mode);

    const initialMode: 'copy' | 'encode' = tryM4aCopyRemux ? 'copy' : 'encode';
    let result = await runAttempt(runWithRemuxMode(undefined, initialMode), { allowMergeStallRecovery: true });
    if (result.mergeStallRetry) {
      mkdirSync(tempDir, { recursive: true });
      result = await runAttempt(runWithRemuxMode(undefined, initialMode), {
        allowMergeStallRecovery: false,
      });
    }
    if (
      !result.success &&
      tryM4aCopyRemux &&
      this.shouldRetryMp4WithAacEncodeAfterCopyRemuxFailure(result.error)
    ) {
      result = await runAttempt(runWithRemuxMode(undefined, 'encode'), { allowMergeStallRecovery: true });
      if (result.mergeStallRetry) {
        mkdirSync(tempDir, { recursive: true });
        result = await runAttempt(runWithRemuxMode(undefined, 'encode'), { allowMergeStallRecovery: false });
      }
    }

    if (!result.success && this.isFormatNotAvailableError(result.error)) {
      result = await runAttempt(
        runWithRemuxMode(this.buildFallbackSelectionArgs(request), tryM4aCopyRemux ? 'copy' : 'encode'),
        { allowMergeStallRecovery: true },
      );
      if (result.mergeStallRetry) {
        mkdirSync(tempDir, { recursive: true });
        result = await runAttempt(
          runWithRemuxMode(this.buildFallbackSelectionArgs(request), tryM4aCopyRemux ? 'copy' : 'encode'),
          { allowMergeStallRecovery: false },
        );
      }
      if (
        !result.success &&
        tryM4aCopyRemux &&
        this.shouldRetryMp4WithAacEncodeAfterCopyRemuxFailure(result.error)
      ) {
        result = await runAttempt(runWithRemuxMode(this.buildFallbackSelectionArgs(request), 'encode'), {
          allowMergeStallRecovery: true,
        });
        if (result.mergeStallRetry) {
          mkdirSync(tempDir, { recursive: true });
          result = await runAttempt(runWithRemuxMode(this.buildFallbackSelectionArgs(request), 'encode'), {
            allowMergeStallRecovery: false,
          });
        }
      }
    }
    if (!result.success && this.isFormatNotAvailableError(result.error)) {
      result = await runAttempt(
        runWithRemuxMode(this.buildLastResortSelectionArgs(request), tryM4aCopyRemux ? 'copy' : 'encode'),
        { allowMergeStallRecovery: true },
      );
      if (result.mergeStallRetry) {
        mkdirSync(tempDir, { recursive: true });
        result = await runAttempt(
          runWithRemuxMode(this.buildLastResortSelectionArgs(request), tryM4aCopyRemux ? 'copy' : 'encode'),
          { allowMergeStallRecovery: false },
        );
      }
      if (
        !result.success &&
        tryM4aCopyRemux &&
        this.shouldRetryMp4WithAacEncodeAfterCopyRemuxFailure(result.error)
      ) {
        result = await runAttempt(runWithRemuxMode(this.buildLastResortSelectionArgs(request), 'encode'), {
          allowMergeStallRecovery: true,
        });
        if (result.mergeStallRetry) {
          mkdirSync(tempDir, { recursive: true });
          result = await runAttempt(runWithRemuxMode(this.buildLastResortSelectionArgs(request), 'encode'), {
            allowMergeStallRecovery: false,
          });
        }
      }
    }
    return result;
  }

  private isFormatNotAvailableError(message: string | null | undefined): boolean {
    if (!message) {
      return false;
    }
    return message.toLowerCase().includes('requested format is not available');
  }

  private isYtDlpTooOldForSections(binaryPath: string): boolean {
    try {
      const probe = spawnSync(binaryPath, ['--version'], {
        windowsHide: true,
        encoding: 'utf8',
        timeout: 8000,
      });
      const raw = `${probe.stdout ?? ''}\n${probe.stderr ?? ''}`.trim();
      const m = raw.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/);
      if (!m) {
        return false;
      }
      const year = parseInt(m[1], 10);
      const month = parseInt(m[2], 10);
      const day = parseInt(m[3], 10);
      if (year !== MIN_YT_DLP_SECTION_VERSION.year) {
        return year < MIN_YT_DLP_SECTION_VERSION.year;
      }
      if (month !== MIN_YT_DLP_SECTION_VERSION.month) {
        return month < MIN_YT_DLP_SECTION_VERSION.month;
      }
      return day < MIN_YT_DLP_SECTION_VERSION.day;
    } catch {
      return false;
    }
  }

  /** Copy-remux to MP4 failed (e.g. Opus audio) — retry with AAC encode. */
  private shouldRetryMp4WithAacEncodeAfterCopyRemuxFailure(message: string | null | undefined): boolean {
    if (!message) {
      return false;
    }
    const m = message.toLowerCase();
    if (m.includes('requested format is not available')) {
      return false;
    }
    if (m.includes('cancelled')) {
      return false;
    }
    return (
      m.includes('postprocessing') ||
      m.includes('post-processing') ||
      m.includes('conversion failed') ||
      m.includes('ffmpeg') ||
      m.includes('mux') ||
      m.includes('remux') ||
      m.includes('merger') ||
      m.includes('videoremuxer') ||
      m.includes('error opening output') ||
      m.includes('could not write header')
    );
  }

  private sectionClipConcurrentFragments(settings: AppSettings): number {
    const n = settings.sectionConcurrentFragments;
    return Math.min(32, Math.max(1, Math.floor(Number.isFinite(n) ? n : 16)));
  }

  private findFileByPrefix(dir: string, prefix: string): string | null {
    const search = (d: string): string | null => {
      try {
        for (const name of readdirSync(d)) {
          const full = join(d, name);
          try {
            const st = statSync(full);
            if (st.isFile() && name.startsWith(prefix) && !name.endsWith('.part') && !name.endsWith('.ytdl')) {
              return full;
            }
            if (st.isDirectory()) {
              const found = search(full);
              if (found) {
                return found;
              }
            }
          } catch {
            /* skip */
          }
        }
      } catch {
        /* skip */
      }
      return null;
    };
    return search(dir);
  }

  /**
   * After `-f "bestvideo…,bestaudio"` (comma = separate files), locate video vs audio outputs under `rootDir`.
   */
  private findSplitOutputs(rootDir: string): { videoFile: string | null; audioFile: string | null } {
    const files: { path: string; size: number; ext: string }[] = [];

    const scan = (dir: string): void => {
      try {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          try {
            const st = statSync(full);
            if (st.isFile() && !name.endsWith('.part') && !name.endsWith('.ytdl')) {
              files.push({ path: full, size: st.size, ext: extname(name).toLowerCase() });
            } else if (st.isDirectory()) {
              scan(full);
            }
          } catch {
            /* skip */
          }
        }
      } catch {
        /* skip */
      }
    };
    scan(rootDir);

    if (files.length === 0) {
      return { videoFile: null, audioFile: null };
    }
    if (files.length === 1) {
      return { videoFile: files[0]!.path, audioFile: null };
    }

    files.sort((a, b) => b.size - a.size);
    const videoFile = files[0]!.path;

    const audioExts = new Set(['.m4a', '.opus', '.ogg', '.mp3', '.aac', '.wav', '.flac']);
    const largestSize = files[0]!.size;
    let audioFile: string | null = null;

    for (let i = files.length - 1; i >= 1; i--) {
      const f = files[i]!;
      if (f.size === 0) {
        continue;
      }
      if (audioExts.has(f.ext) || f.size <= largestSize * 0.2) {
        audioFile = f.path;
        break;
      }
    }

    if (audioFile == null) {
      for (let i = files.length - 1; i >= 1; i--) {
        if (files[i]!.size > 0) {
          audioFile = files[i]!.path;
          break;
        }
      }
    }

    if (audioFile === videoFile) {
      audioFile = files.length > 1 && files[1]!.size > 0 ? files[1]!.path : null;
    }

    return { videoFile, audioFile };
  }

  private runSplitStream(
    ytDlpPath: string,
    args: string[],
    requestId: string,
    streamType: 'video' | 'audio',
    onProgress: ProgressCallback,
    settings: AppSettings,
    clipLogLine?: (line: string) => void,
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      console.log(`[Yoinkr] ${streamType} stream:`, ytDlpPath, args.join(' '));
      try {
        clipLogLine?.(`# stream=${streamType} argv=${JSON.stringify([ytDlpPath, ...args])}`);
      } catch {
        /* ignore */
      }

      const child = spawn(ytDlpPath, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: this.buildYtDlpChildEnv(settings),
      });

      const processKey = `${requestId}__${streamType}`;
      this.activeProcesses.set(processKey, child);

      let stderrAcc = '';
      let stdoutAcc = '';
      const outBuf = { s: '' };
      const errBuf = { s: '' };
      /** Fragment / unknown-total progress often has no `%` — advance from bytes + frag ratio. */
      let pseudoPercent = 0;

      const emitClip = (pct: number, speed: string, eta: string, message: string): void => {
        onProgress({
          id: requestId,
          phase: 'downloading',
          percent: Math.min(95, pct),
          speed,
          eta,
          message,
        });
      };

      const parseClipProgressLine = (rawLine: string): void => {
        if (streamType !== 'video') {
          return;
        }
        const clean = stripAnsi(rawLine).trim();
        if (!clean) {
          return;
        }

        const progressMatch = clean.match(PROGRESS_RE);
        if (progressMatch) {
          const pctRaw = parseFloat(progressMatch[1]!);
          if (pctRaw >= 99.5) {
            emitClip(95, '', '', 'Clip: finishing download…');
            return;
          }
          let pct = Math.min(95, Math.round(pctRaw));
          const fragMatch = clean.match(FRAG_RE);
          if (fragMatch) {
            const fi = parseInt(fragMatch[1]!, 10);
            const fn = parseInt(fragMatch[2]!, 10);
            if (fn > 0) {
              pct = Math.min(95, Math.max(pct, Math.round((fi / fn) * 100)));
            }
          }
          emitClip(pct, progressMatch[2]!.trim(), progressMatch[3]!, `Clip: ${progressMatch[1]}%`);
          return;
        }

        const finishedMatch = clean.match(PROGRESS_RE_FINISHED);
        if (finishedMatch) {
          const pctRaw = parseFloat(finishedMatch[1]!);
          if (pctRaw >= 99.5) {
            emitClip(95, '', '', 'Clip: finishing download…');
            return;
          }
          emitClip(
            Math.min(95, Math.round(pctRaw)),
            finishedMatch[3]!.trim(),
            '',
            `Clip: ${finishedMatch[1]}% (in ${finishedMatch[2]})`,
          );
          return;
        }

        const percentOnlyMatch = clean.match(PROGRESS_RE_PERCENT_ONLY);
        if (percentOnlyMatch) {
          const pctRaw = parseFloat(percentOnlyMatch[1]!);
          if (pctRaw >= 99.5) {
            emitClip(95, '', '', 'Clip: finishing download…');
            return;
          }
          emitClip(
            Math.min(95, Math.round(pctRaw)),
            percentOnlyMatch[2]!.trim(),
            percentOnlyMatch[3]!,
            `Clip: ${percentOnlyMatch[1]}%`,
          );
          return;
        }

        const bytesMatch = clean.match(PROGRESS_RE_BYTES_ELAPSED);
        if (bytesMatch) {
          let pct: number;
          if (bytesMatch[4] != null && bytesMatch[5] != null) {
            const fi = parseInt(bytesMatch[4], 10);
            const fn = parseInt(bytesMatch[5], 10);
            pct = fn > 0 ? Math.min(95, Math.round((fi / fn) * 100)) : Math.min(90, pseudoPercent + 3);
            pseudoPercent = pct;
          } else {
            pseudoPercent = Math.min(90, pseudoPercent + 3);
            pct = pseudoPercent;
          }
          emitClip(
            pct,
            bytesMatch[2]!.trim(),
            '',
            `Clip: ${bytesMatch[1]} at ${bytesMatch[2]!.trim()} (${bytesMatch[3]})`,
          );
          return;
        }

        const loosePct = clean.match(LOOSE_DOWNLOAD_PERCENT_RE);
        if (loosePct) {
          const pctRaw = parseFloat(loosePct[1]!);
          if (pctRaw >= 99.5) {
            emitClip(95, '', '', 'Clip: finishing download…');
            return;
          }
          let pct = Math.min(95, Math.round(pctRaw));
          const fragMatch = clean.match(FRAG_RE);
          if (fragMatch) {
            const fi = parseInt(fragMatch[1]!, 10);
            const fn = parseInt(fragMatch[2]!, 10);
            if (fn > 0) {
              pct = Math.min(95, Math.max(pct, Math.round((fi / fn) * 100)));
            }
          }
          emitClip(pct, '', '', `Clip: ${loosePct[1]}%`);
          return;
        }

        const fragOnly = clean.match(FRAG_RE);
        if (fragOnly && clean.includes('[download]')) {
          const fi = parseInt(fragOnly[1]!, 10);
          const fn = parseInt(fragOnly[2]!, 10);
          if (fn > 0) {
            emitClip(Math.min(95, Math.round((fi / fn) * 100)), '', '', `Clip: fragment ${fi}/${fn}`);
          }
        }
      };

      const feedStream = (acc: { s: string }, text: string): void => {
        acc.s += text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        let idx: number;
        while ((idx = acc.s.indexOf('\n')) >= 0) {
          const line = acc.s.slice(0, idx);
          acc.s = acc.s.slice(idx + 1);
          parseClipProgressLine(line);
        }
      };

      child.stdout.on('data', (c: Buffer) => {
        const text = c.toString('utf8');
        stdoutAcc += text;
        feedStream(outBuf, text);
      });
      child.stderr.on('data', (c: Buffer) => {
        const text = c.toString('utf8');
        stderrAcc += text;
        feedStream(errBuf, text);
      });

      const timeout = setTimeout(() => {
        if (!child.killed) {
          const pid = child.pid;
          if (pid != null) {
            treeKill(pid, 'SIGKILL', () => {});
          } else {
            try {
              child.kill('SIGKILL');
            } catch {
              /* ignore */
            }
          }
          resolve({ success: false, error: `${streamType} download timed out after 30 minutes` });
        }
      }, 30 * 60 * 1000);

      child.on('error', (err) => {
        clearTimeout(timeout);
        this.activeProcesses.delete(processKey);
        console.error(`[Yoinkr] ${streamType} stream spawn error:`, err.message);
        clipLogLine?.(`# spawn_error stream=${streamType} ${err.message}`);
        onProgress({
          id: requestId,
          phase: 'downloading',
          percent: 0,
          speed: '',
          eta: '',
          message: `${streamType} failed: ${err.message}`,
        });
        resolve({ success: false, error: err.message });
      });

      child.on('close', (exitCode) => {
        clearTimeout(timeout);
        this.activeProcesses.delete(processKey);

        const flushRemainder = (acc: { s: string }): void => {
          if (acc.s.trim()) {
            parseClipProgressLine(acc.s);
            acc.s = '';
          }
        };
        flushRemainder(outBuf);
        flushRemainder(errBuf);

        const combinedLog = `${stderrAcc}\n${stdoutAcc}`;
        const cancelled = this.userCancelledDownloadIds.has(requestId);

        if (exitCode !== 0) {
          console.error(
            `[Yoinkr] ${streamType} stream FAILED (exit ${exitCode ?? 'null'}). stderr+stdout tail:\n${combinedLog.slice(-12_000)}`,
          );
          try {
            clipLogLine?.(`# close stream=${streamType} exit=${exitCode ?? 'null'}`);
            clipLogLine?.(combinedLog.slice(-8000));
          } catch {
            /* ignore */
          }
        } else {
          console.log(`[Yoinkr] ${streamType} stream completed successfully`);
        }

        if (cancelled) {
          resolve({ success: false, error: 'Cancelled' });
          return;
        }

        if (exitCode !== 0) {
          const errorMsg = this.extractErrorMessage(combinedLog);
          onProgress({
            id: requestId,
            phase: 'downloading',
            percent: 0,
            speed: '',
            eta: '',
            message: `${streamType} failed: ${errorMsg}`,
          });
          resolve({ success: false, error: errorMsg });
          return;
        }

        resolve({ success: true });
      });
    });
  }

  private localRemux(
    ffmpegPath: string,
    videoFile: string,
    audioFile: string,
    outputPath: string,
    request: ItemDownloadRequest,
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const args = ['-nostdin', '-y', '-i', videoFile, '-i', audioFile, '-map', '0:v:0', '-map', '1:a:0'];

      args.push('-c:v', 'copy');

      const audioExt = extname(audioFile).toLowerCase();
      const audioIsOpus = ['.webm', '.opus', '.ogg'].includes(audioExt);
      const audioIsAac = ['.m4a', '.aac', '.mp4'].includes(audioExt);
      const targetFormat = request.outputFormat === 'original' ? 'mkv' : request.outputFormat;

      if (targetFormat === 'mp4' && request.audioPreference === 'aac' && audioIsOpus) {
        args.push('-c:a', 'aac', '-b:a', '192k', '-threads', '0');
      } else if (targetFormat === 'mp4' && audioIsOpus) {
        args.push('-c:a', 'aac', '-b:a', '192k', '-threads', '0');
      } else if (targetFormat === 'webm' && audioIsAac) {
        args.push('-c:a', 'libopus', '-b:a', '128k', '-threads', '0');
      } else {
        args.push('-c:a', 'copy');
      }

      args.push('-avoid_negative_ts', 'make_zero');
      if (targetFormat === 'mp4') {
        args.push('-movflags', '+faststart');
      }
      args.push(outputPath);

      const child = spawn(ffmpegPath, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.activeProcesses.set(request.id, child);

      let stderr = '';
      child.stderr.on('data', (c: Buffer) => {
        stderr += c.toString();
      });

      const to = setTimeout(() => {
        if (!child.killed) {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
          this.activeProcesses.delete(request.id);
          resolve({ success: false, error: 'Remux timed out (60s) — try MKV format instead of MP4' });
        }
      }, 60_000);

      child.on('close', (code) => {
        clearTimeout(to);
        this.activeProcesses.delete(request.id);
        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: `Remux failed (exit ${code}): ${stderr.slice(-300)}` });
        }
      });
    });
  }

  private remuxVideoOnlyStreamCopy(
    ffmpegPath: string,
    videoFile: string,
    outputPath: string,
    targetFormat: string,
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const args = ['-nostdin', '-y', '-i', videoFile, '-map', '0:v:0', '-c:v', 'copy', '-an'];
      if (targetFormat === 'mp4') {
        args.push('-movflags', '+faststart');
      }
      args.push('-avoid_negative_ts', 'make_zero', outputPath);

      const child = spawn(ffmpegPath, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      child.stderr.on('data', (c: Buffer) => {
        stderr += c.toString();
      });

      const to = setTimeout(() => {
        if (!child.killed) {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
          resolve({ success: false, error: 'Video remux timed out (60s)' });
        }
      }, 60_000);

      child.on('close', (code) => {
        clearTimeout(to);
        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: `Remux failed (exit ${code}): ${stderr.slice(-300)}` });
        }
      });
    });
  }

  private buildSectionClipCommonArgs(
    settings: AppSettings,
    ffmpegPath: string | null,
    sectionSpec: string,
  ): string[] {
    const commonArgs: string[] = [
      '--ignore-config',
      ...getYtDlpJsRuntimeCliArgs(settings, this.binaryResolver),
      '--no-playlist',
      '--newline',
      '--no-warnings',
      '--progress',
      '--color',
      'stderr:never',
      '--color',
      'stdout:never',
      '--progress-delta',
      '0.25',
      '--print',
      'after_move:filepath',
      '--download-sections',
      sectionSpec,
      '--concurrent-fragments',
      String(
        effectiveSectionConcurrentFragments(settings, this.sectionClipConcurrentFragments(settings)),
      ),
      '--http-chunk-size',
      SECTION_HTTP_CHUNK_SIZE,
      '--socket-timeout',
      '120',
      '--fragment-retries',
      '10',
      '--retries',
      '5',
      '--no-part',
    ];
    if (process.platform === 'win32') {
      commonArgs.push('--windows-filenames');
    }
    commonArgs.push(...buildYtDlpCookieArgs(settings, this.pathsService));
    if (ffmpegPath && existsSync(ffmpegPath)) {
      commonArgs.push('--ffmpeg-location', ffmpegPath);
    }
    appendYtDlpSleepArgs(commonArgs, settings);
    return commonArgs;
  }

  private async downloadSectionParallel(
    request: ItemDownloadRequest,
    settings: AppSettings,
    onProgress: ProgressCallback,
    downloadDir: string,
  ): Promise<ItemDownloadResult> {
    const ytDlp = this.binaryResolver.resolveTool('yt-dlp', settings);
    const ffmpeg = this.binaryResolver.resolveTool('ffmpeg', settings);
    if (!ytDlp.resolvedPath) {
      const msg = 'yt-dlp is not available';
      onProgress({ id: request.id, phase: 'error', percent: 0, speed: '', eta: '', message: msg });
      return { id: request.id, success: false, outputPath: null, error: msg };
    }
    if (!ffmpeg.resolvedPath || !existsSync(ffmpeg.resolvedPath)) {
      const msg = 'ffmpeg is not available';
      onProgress({ id: request.id, phase: 'error', percent: 0, speed: '', eta: '', message: msg });
      return { id: request.id, success: false, outputPath: null, error: msg };
    }

    const tempDir = join(downloadDir, `.tmp-${request.id}`);
    const fragmentTempDir = join(tempDir, 'fragments');
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(fragmentTempDir, { recursive: true });

    const dur = request.durationSeconds!;
    const sectionSpec = this.buildDownloadSectionSpec(
      request.sectionStartSec ?? 0,
      request.sectionEndSec ?? dur,
      dur,
    );

    /** Comma = separate files, no in-process merge (we remux locally). */
    const heightFilter = this.getHeightFilter(request.qualityTarget);
    const videoSelector = heightFilter
      ? `bestvideo[height<=${heightFilter}]/bestvideo`
      : 'bestvideo';
    const formatArg = `${videoSelector},bestaudio`;

    const outputTemplate = join(tempDir, '%(format_id)s.%(ext)s');

    const args: string[] = [
      ...this.buildSectionClipCommonArgs(settings, ffmpeg.resolvedPath, sectionSpec),
      '-P',
      `temp:${fragmentTempDir}`,
      '-o',
      outputTemplate,
      '-f',
      formatArg,
      request.url,
    ];

    console.log('[Yoinkr] SECTION CLIP (single yt-dlp):', JSON.stringify(args, null, 2));

    const logsDownloadsDir = join(this.pathsService.getPaths().managedDirectories.logs, 'downloads');
    let clipLogStream: WriteStream | null = null;
    const clipLogLine = (s: string): void => {
      try {
        clipLogStream?.write(`${s}\n`);
      } catch {
        /* ignore */
      }
    };
    if (settings.saveDownloadLogs) {
      try {
        mkdirSync(logsDownloadsDir, { recursive: true });
        const safeTime = new Date().toISOString().replace(/[:.]/g, '-');
        clipLogStream = createWriteStream(
          join(logsDownloadsDir, `${request.id.slice(0, 8)}-clip-${safeTime}.log`),
          { flags: 'a' },
        );
        clipLogLine('# Yoinkr section clip (single process, comma formats)');
        clipLogLine(`# id=${request.id}`);
        clipLogLine(`# url=${request.url}`);
      } catch {
        clipLogStream = null;
      }
    }

    onProgress({
      id: request.id,
      phase: 'downloading',
      percent: 0,
      speed: '',
      eta: '',
      message: 'Starting clip download…',
    });

    let dlResult: { success: boolean; error?: string };
    try {
      dlResult = await this.runSplitStream(
        ytDlp.resolvedPath,
        args,
        request.id,
        'video',
        onProgress,
        settings,
        clipLogLine,
      );
    } finally {
      try {
        clipLogStream?.end();
      } catch {
        /* ignore */
      }
    }

    if (!dlResult.success) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      const errMsg = dlResult.error || 'Clip download failed';
      onProgress({ id: request.id, phase: 'error', percent: 0, speed: '', eta: '', message: errMsg });
      return { id: request.id, success: false, outputPath: null, error: errMsg };
    }

    const { videoFile, audioFile } = this.findSplitOutputs(tempDir);

    if (!videoFile || !audioFile) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      const msg = 'Could not find separate video and audio files after download.';
      onProgress({ id: request.id, phase: 'error', percent: 0, speed: '', eta: '', message: msg });
      return { id: request.id, success: false, outputPath: null, error: msg };
    }

    onProgress({
      id: request.id,
      phase: 'merging',
      percent: 99,
      speed: '',
      eta: '',
      message: 'Remuxing to your format…',
    });

    const ext = request.outputFormat === 'original' ? 'mkv' : request.outputFormat;
    const outputPath = join(
      downloadDir,
      `${request.id}__${sanitizeDownloadDisplayName(request.title)}.${ext}`,
    );
    const muxResult = await this.localRemux(ffmpeg.resolvedPath, videoFile, audioFile, outputPath, request);

    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }

    if (!muxResult.success) {
      onProgress({
        id: request.id,
        phase: 'error',
        percent: 0,
        speed: '',
        eta: '',
        message: muxResult.error!,
      });
      return { id: request.id, success: false, outputPath: null, error: muxResult.error! };
    }

    const friendlyPath = this.renameToFriendlyTitle(outputPath, request);
    onProgress({
      id: request.id,
      phase: 'complete',
      percent: 100,
      speed: '',
      eta: '',
      message: 'Download complete!',
    });
    return { id: request.id, success: true, outputPath: friendlyPath };
  }

  private async downloadSectionAudioOnly(
    request: ItemDownloadRequest,
    settings: AppSettings,
    onProgress: ProgressCallback,
    downloadDir: string,
  ): Promise<ItemDownloadResult> {
    const ytDlp = this.binaryResolver.resolveTool('yt-dlp', settings);
    const ffmpeg = this.binaryResolver.resolveTool('ffmpeg', settings);
    if (!ytDlp.resolvedPath) {
      const msg = 'yt-dlp is not available';
      onProgress({ id: request.id, phase: 'error', percent: 0, speed: '', eta: '', message: msg });
      return { id: request.id, success: false, outputPath: null, error: msg };
    }

    const tempDir = join(downloadDir, `.tmp-${request.id}`);
    const fragmentDir = join(tempDir, 'fragments');
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(fragmentDir, { recursive: true });

    const dur = request.durationSeconds!;
    const sectionSpec = this.buildDownloadSectionSpec(
      request.sectionStartSec ?? 0,
      request.sectionEndSec ?? dur,
      dur,
    );

    const outputTemplate = join(downloadDir, `${request.id}__%(title).200B.%(ext)s`);

    const args: string[] = [
      ...this.buildSectionClipCommonArgs(settings, ffmpeg.resolvedPath, sectionSpec),
      '-P',
      `temp:${fragmentDir}`,
      '-o',
      outputTemplate,
      '-f',
      'bestaudio',
      '-x',
      '--audio-format',
      this.mapAudioFormat(request.outputFormat),
      request.url,
    ];

    onProgress({
      id: request.id,
      phase: 'downloading',
      percent: 0,
      speed: '',
      eta: '',
      message: 'Downloading audio clip…',
    });
    const result = await this.runSplitStream(ytDlp.resolvedPath, args, request.id, 'video', onProgress, settings);

    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }

    if (!result.success) {
      const msg = result.error || 'Audio clip download failed';
      onProgress({ id: request.id, phase: 'error', percent: 0, speed: '', eta: '', message: msg });
      return { id: request.id, success: false, outputPath: null, error: msg };
    }

    const finalPath = findLatestOutputByDownloadId(downloadDir, request.id);
    if (!finalPath || !existsSync(finalPath)) {
      const msg = 'Audio clip downloaded but file not found';
      onProgress({ id: request.id, phase: 'error', percent: 0, speed: '', eta: '', message: msg });
      return { id: request.id, success: false, outputPath: null, error: msg };
    }

    const friendlyPath = this.renameToFriendlyTitle(finalPath, request);
    onProgress({
      id: request.id,
      phase: 'complete',
      percent: 100,
      speed: '',
      eta: '',
      message: 'Download complete!',
    });
    return { id: request.id, success: true, outputPath: friendlyPath };
  }

  private async downloadSectionVideoOnly(
    request: ItemDownloadRequest,
    settings: AppSettings,
    onProgress: ProgressCallback,
    downloadDir: string,
  ): Promise<ItemDownloadResult> {
    const ytDlp = this.binaryResolver.resolveTool('yt-dlp', settings);
    const ffmpeg = this.binaryResolver.resolveTool('ffmpeg', settings);
    if (!ytDlp.resolvedPath) {
      const msg = 'yt-dlp is not available';
      onProgress({ id: request.id, phase: 'error', percent: 0, speed: '', eta: '', message: msg });
      return { id: request.id, success: false, outputPath: null, error: msg };
    }
    if (!ffmpeg.resolvedPath || !existsSync(ffmpeg.resolvedPath)) {
      const msg = 'ffmpeg is not available';
      onProgress({ id: request.id, phase: 'error', percent: 0, speed: '', eta: '', message: msg });
      return { id: request.id, success: false, outputPath: null, error: msg };
    }

    const tempDir = join(downloadDir, `.tmp-${request.id}`);
    const videoTempDir = join(tempDir, 'video-fragments');
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(videoTempDir, { recursive: true });

    const dur = request.durationSeconds!;
    const sectionSpec = this.buildDownloadSectionSpec(
      request.sectionStartSec ?? 0,
      request.sectionEndSec ?? dur,
      dur,
    );

    const heightFilter = this.getHeightFilter(request.qualityTarget);
    const videoFormatSelector = heightFilter
      ? `bestvideo[height<=${heightFilter}]/bestvideo`
      : 'bestvideo';

    const videoOutput = join(videoTempDir, 'video.%(ext)s');
    const videoArgs = [
      ...this.buildSectionClipCommonArgs(settings, ffmpeg.resolvedPath, sectionSpec),
      '-f',
      videoFormatSelector,
      '-P',
      `temp:${videoTempDir}`,
      '-o',
      videoOutput,
      request.url,
    ];

    onProgress({
      id: request.id,
      phase: 'downloading',
      percent: 0,
      speed: '',
      eta: '',
      message: 'Downloading video clip…',
    });
    const result = await this.runSplitStream(ytDlp.resolvedPath, videoArgs, request.id, 'video', onProgress, settings);

    if (!result.success) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      const msg = result.error || 'Video clip download failed';
      onProgress({ id: request.id, phase: 'error', percent: 0, speed: '', eta: '', message: msg });
      return { id: request.id, success: false, outputPath: null, error: msg };
    }

    const videoFile = this.findFileByPrefix(videoTempDir, 'video');
    if (!videoFile) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      const msg = 'Downloaded video file not found in temp directory.';
      onProgress({ id: request.id, phase: 'error', percent: 0, speed: '', eta: '', message: msg });
      return { id: request.id, success: false, outputPath: null, error: msg };
    }

    const srcExt = extname(videoFile).replace(/^\./, '').toLowerCase();
    const targetExt = request.outputFormat === 'original' ? srcExt || 'mkv' : request.outputFormat;

    const outputPath = join(
      downloadDir,
      `${request.id}__${sanitizeDownloadDisplayName(request.title)}.${targetExt}`,
    );

    let muxOk: { success: boolean; error?: string };
    if (srcExt === targetExt) {
      try {
        copyFileSync(videoFile, outputPath);
        muxOk = { success: true };
      } catch (e) {
        muxOk = { success: false, error: e instanceof Error ? e.message : 'Could not copy video output' };
      }
    } else {
      muxOk = await this.remuxVideoOnlyStreamCopy(ffmpeg.resolvedPath, videoFile, outputPath, targetExt);
    }

    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }

    if (!muxOk.success) {
      onProgress({
        id: request.id,
        phase: 'error',
        percent: 0,
        speed: '',
        eta: '',
        message: muxOk.error!,
      });
      return { id: request.id, success: false, outputPath: null, error: muxOk.error! };
    }

    const friendlyPath = this.renameToFriendlyTitle(outputPath, request);
    onProgress({
      id: request.id,
      phase: 'complete',
      percent: 100,
      speed: '',
      eta: '',
      message: 'Download complete!',
    });
    return { id: request.id, success: true, outputPath: friendlyPath };
  }

  private prefersM4aDashAudio(request: ItemDownloadRequest): boolean {
    return (
      request.mediaType === 'video-audio' &&
      !this.requestIsAudioDownload(request) &&
      request.outputFormat === 'mp4' &&
      request.audioPreference === 'aac'
    );
  }

  private buildArgs(
    request: ItemDownloadRequest,
    outputTemplate: string,
    tempDir: string,
    ffmpegPath: string | null,
    settings: AppSettings,
    selectionOverride?: string[],
    /** MP4 + AAC: try stream-copy first (m4a DASH); `encode` = Opus→AAC fallback. */
    mp4AacRemuxMode: 'copy' | 'encode' = 'copy',
  ): string[] {
    const args: string[] = [
      '--ignore-config',
      ...getYtDlpJsRuntimeCliArgs(settings, this.binaryResolver),
      '--no-playlist', '--newline', '--no-warnings', '--progress',
      /** Plain output helps regex; stderr is where `[download]` progress usually goes when piped. */
      '--color', 'stderr:never',
      '--color', 'stdout:never',
      /** Emit progress periodically so piped output isn’t block-buffered for too long. */
      '--progress-delta', '0.25',
      '--print', 'after_move:filepath',
      '-P', `temp:${tempDir}`,
      '-o', outputTemplate,
    ];

    if (process.platform === 'win32') {
      args.push('--windows-filenames');
    }

    args.push(...buildYtDlpCookieArgs(settings, this.pathsService));

    if (ffmpegPath && existsSync(ffmpegPath)) {
      args.push('--ffmpeg-location', ffmpegPath);
    }

    appendYtDlpSleepArgs(args, settings);
    appendYtDlpConcurrentFragmentsArg(args, settings);

    args.push(...(selectionOverride ?? this.buildSelectionArgs(request)));

    if (this.requestIsAudioDownload(request)) {
      args.push('-x', '--audio-format', this.mapAudioFormat(request.outputFormat));
    } else if (request.outputFormat !== 'original') {
      args.push('--remux-video', request.outputFormat);
      if (
        request.mediaType === 'video-audio' &&
        request.outputFormat === 'mp4' &&
        request.audioPreference === 'aac'
      ) {
        /**
         * YouTube DASH merges usually land in **WebM/MKV** first. Prefer **m4a** audio (`prefersM4aDashAudio`)
         * so **VideoRemuxer** can `-c:a copy` (fast). If audio is still Opus, download retries with encode.
         *
         * Do **not** force AAC in `Merger+ffmpeg`: intermediate is often **WebM**. Only **VideoRemuxer**.
         */
        if (mp4AacRemuxMode === 'copy') {
          args.push('--ppa', 'VideoRemuxer+ffmpeg:-nostdin -c:v copy -c:a copy');
        } else {
          /** `-threads 0` = ffmpeg picks core count — much faster AAC encode than forcing 1 thread. */
          args.push(
            '--ppa',
            'VideoRemuxer+ffmpeg:-nostdin -c:v copy -c:a aac -b:a 192k -aac_coder fast -threads 0',
          );
        }
      }
    }

    args.push(...this.buildDownloadSectionsArgs(request, ffmpegPath));

    args.push(request.url);
    return args;
  }

  private isFullSpanDownloadSection(start: number, end: number, duration: number): boolean {
    return start <= DOWNLOAD_SECTION_FULL_SPAN_EPS_SEC && end >= duration - DOWNLOAD_SECTION_FULL_SPAN_EPS_SEC;
  }

  private requiresPartialSectionDownload(request: ItemDownloadRequest): boolean {
    const dur = request.durationSeconds;
    if (dur == null || dur <= 0) {
      return false;
    }
    const start = request.sectionStartSec ?? 0;
    const end = request.sectionEndSec ?? dur;
    return !this.isFullSpanDownloadSection(start, end, dur);
  }

  private buildDownloadSectionsArgs(request: ItemDownloadRequest, ffmpegPath: string | null): string[] {
    if (!this.requiresPartialSectionDownload(request)) {
      return [];
    }
    if (!ffmpegPath || !existsSync(ffmpegPath)) {
      return [];
    }
    const dur = request.durationSeconds!;
    const start = request.sectionStartSec ?? 0;
    const end = request.sectionEndSec ?? dur;
    const spec = this.buildDownloadSectionSpec(start, end, dur);
    return ['--download-sections', spec];
  }

  private buildDownloadSectionSpec(start: number, end: number, duration: number): string {
    const startStr = this.formatYtDlpSectionTimestamp(start);
    const endStr = this.isFullSpanDownloadSection(0, end, duration)
      ? 'inf'
      : this.formatYtDlpSectionTimestamp(end);
    return `*${startStr}-${endStr}`;
  }

  /** yt-dlp `--download-sections` time form (see README): `*start-end` with `inf` allowed. */
  private formatYtDlpSectionTimestamp(seconds: number): string {
    const s = Math.max(0, seconds);
    const whole = Math.floor(s);
    const frac = Math.round((s - whole) * 1000) / 1000;
    const total = whole + frac;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total - h * 3600 - m * 60;
    const secStr =
      Math.abs(sec - Math.floor(sec)) > 0.001 ? sec.toFixed(3).replace(/\.?0+$/, '') : String(Math.floor(sec)).padStart(2, '0');
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${secStr}`;
    }
    return `${m}:${secStr}`;
  }

  private buildSelectionArgs(request: ItemDownloadRequest): string[] {
    const heightFilter = this.getHeightFilter(request.qualityTarget);
    const selectors: string[] = [];
    const sortFields: string[] = [];

    if (this.requestIsAudioDownload(request)) {
      selectors.push('bestaudio/best');

      if (request.audioPreference === 'aac') {
        sortFields.push('aext:m4a');
      } else if (request.audioPreference === 'opus') {
        sortFields.push('acodec:opus', 'aext:webm');
      }
    } else if (request.mediaType === 'video-only') {
      selectors.push(
        heightFilter
          ? `bestvideo[height<=${heightFilter}]/bestvideo*[height<=${heightFilter}]/bestvideo/best[height<=${heightFilter}]/best`
          : 'bestvideo/bestvideo*/best',
      );

      if (heightFilter) {
        sortFields.push(`res:${heightFilter}`);
      }
      sortFields.push(...this.getContainerSortBias(request.outputFormat, false, request.audioPreference));
    } else {
      /**
       * Merge video+audio: keep the `-f` chain short and YouTube-stable. Long slash chains with
       * `bestvideo*` / `bv*+ba` variants still fail on some videos ("Requested format is not available").
       * `--remux-video mp4` (below) handles MP4; avoid `-S vext:mp4` here (breaks some merges).
       *
       * MP4 + AAC: prefer `bestaudio[ext=m4a]` + `-S aext:m4a` so DASH audio is often already AAC
       * (mux/remux is much faster than Opus→AAC transcode).
       */
      const m4a = this.prefersM4aDashAudio(request);
      if (heightFilter) {
        selectors.push(
          m4a
            ? `bestvideo[height<=${heightFilter}]+bestaudio[ext=m4a]/bestvideo[height<=${heightFilter}]+bestaudio/bestvideo+bestaudio/best`
            : `bestvideo[height<=${heightFilter}]+bestaudio/bestvideo+bestaudio/best`,
        );
        sortFields.push(`res:${heightFilter}`);
        if (m4a) {
          sortFields.push('aext:m4a');
        }
      } else {
        selectors.push(m4a ? 'bestvideo+bestaudio[ext=m4a]/bestvideo+bestaudio/best' : 'bestvideo+bestaudio/best');
        if (m4a) {
          sortFields.push('aext:m4a');
        }
      }
    }

    const args = ['-f', selectors.join('/')];
    const uniqueSortFields = [...new Set(sortFields.filter(Boolean))];
    if (uniqueSortFields.length > 0) {
      args.push('-S', uniqueSortFields.join(','));
    }

    return args;
  }

  /**
   * Second attempt: `bv*+ba` is the usual DASH merge pair; `/best` single progressive if needed.
   */
  private buildFallbackSelectionArgs(request: ItemDownloadRequest): string[] {
    const heightFilter = this.getHeightFilter(request.qualityTarget);
    if (this.requestIsAudioDownload(request)) {
      return ['-f', 'bestaudio/best'];
    }
    if (request.mediaType === 'video-only') {
      const sel = heightFilter
        ? `bestvideo[height<=${heightFilter}]/bestvideo/best`
        : 'bestvideo/best';
      return ['-f', sel];
    }
    const m4a = this.prefersM4aDashAudio(request);
    const sel = heightFilter
      ? m4a
        ? `bestvideo[height<=${heightFilter}]+bestaudio[ext=m4a]/bestvideo[height<=${heightFilter}]+bestaudio/bv*+ba/best`
        : `bestvideo[height<=${heightFilter}]+bestaudio/bv*+ba/best`
      : m4a
        ? 'bestvideo+bestaudio[ext=m4a]/bv*+ba/bestvideo+bestaudio/best'
        : 'bv*+ba/bestvideo+bestaudio/best';
    return ['-f', sel];
  }

  /**
   * Last resort: combined `best` stream (often lower quality but almost always available).
   */
  private buildLastResortSelectionArgs(request: ItemDownloadRequest): string[] {
    if (this.requestIsAudioDownload(request)) {
      return ['-f', 'bestaudio/best'];
    }
    if (request.mediaType === 'video-only') {
      return ['-f', 'best/bestvideo/best'];
    }
    return ['-f', 'best'];
  }

  private getHeightFilter(quality: ItemDownloadRequest['qualityTarget']): number | null {
    const map: Record<string, number> = {
      '4320p': 4320,
      '2160p': 2160,
      '1440p': 1440,
      '1080p': 1080,
      '720p': 720,
      '480p': 480,
    };
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
        if (audioPreference === 'aac') {
          sortFields.push('aext:m4a');
        } else if (audioPreference === 'opus') {
          sortFields.push('acodec:opus', 'aext:webm');
        }
      }
    } else if (outputFormat === 'webm') {
      sortFields.push('vext:webm');
      if (includeAudio) {
        sortFields.push('aext:webm');
        if (audioPreference === 'opus') {
          sortFields.push('acodec:opus');
        }
      }
    } else if (outputFormat === 'mkv' && includeAudio) {
      /** MKV is flexible; still allow nudging audio when user chose an explicit remux target. */
      if (audioPreference === 'aac') {
        sortFields.push('aext:m4a');
      } else if (audioPreference === 'opus') {
        sortFields.push('acodec:opus', 'aext:webm');
      }
    }
    /**
     * `original`: do **not** add `aext:m4a` / opus sort — it conflicts with YouTube's usual VP9+Opus
     * merge and triggers "Requested format is not available" even though cookies are fine.
     */

    return sortFields;
  }

  private mapAudioFormat(format: string): string {
    const map: Record<string, string> = { mp3: 'mp3', m4a: 'm4a', wav: 'wav', flac: 'flac' };
    return map[format] ?? 'mp3';
  }

  /**
   * After yt-dlp writes `<uuid>__title.ext`, rename to `Title.ext` (or `Title (2).ext`) so Explorer
   * and the editor show human-readable names. Internal prefix template stays for path fallback.
   */
  private renameToFriendlyTitle(finalPath: string, request: ItemDownloadRequest): string {
    const ext = extname(finalPath);
    const dir = dirname(finalPath);
    const base = sanitizeDownloadDisplayName(request.title);
    let candidate = join(dir, `${base}${ext}`);
    let counter = 1;
    while (existsSync(candidate) && candidate !== finalPath) {
      candidate = join(dir, `${base} (${counter})${ext}`);
      counter += 1;
    }
    if (candidate === finalPath) {
      return finalPath;
    }
    try {
      renameSync(finalPath, candidate);
      return candidate;
    } catch {
      return finalPath;
    }
  }

  private extractErrorMessage(stderr: string): string {
    const lines = stderr.split(/\r?\n/).filter(Boolean);
    const lower = (l: string) => l.toLowerCase();
    const errorLine =
      lines.find((l) => lower(l).includes('error')) ??
      lines.find((l) => lower(l).includes('requested format'));
    return errorLine?.replace(/^ERROR:\s*/i, '').trim() || 'Download failed. Check yt-dlp output for details.';
  }
}

