import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
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

function formatBytesForProgress(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

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
/**
 * DASH section cuts can produce bursty A/V packets; a larger mux queue avoids ffmpeg sitting
 * “idle” while waiting to schedule streams (feels hung though CPU is low).
 */
const SECTION_FFMPEG_MUX_QUEUE = '8192';

function clampSectionConcurrentFragments(n: number): number {
  return Math.min(32, Math.max(1, Math.floor(Number.isFinite(n) ? n : 8)));
}

/** Parse ffmpeg stderr `time=HH:MM:SS.xx` (centiseconds) to seconds. */
function parseFfmpegTimeToSeconds(timeStr: string): number {
  const m = timeStr.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{2})$/);
  if (!m) {
    return 0;
  }
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const s = parseInt(m[3], 10);
  const frac = parseInt(m[4], 10) / 100;
  return h * 3600 + min * 60 + s + frac;
}

function normalizeYtDlpHeaders(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.length > 0) {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** ffmpeg `-headers` expects CRLF-terminated `Key: value` lines. */
function ffmpegHeadersArg(headers: Record<string, string> | undefined): string[] {
  if (!headers || Object.keys(headers).length === 0) {
    return [];
  }
  const block = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\r\n');
  return ['-headers', `${block}\r\n`];
}

interface SectionDirectResolvedStream {
  url: string;
  headers?: Record<string, string>;
  vcodec: string;
  acodec: string;
}

function parseSectionDirectStreamsFromJson(info: unknown): SectionDirectResolvedStream[] | null {
  if (!info || typeof info !== 'object') {
    return null;
  }
  const o = info as Record<string, unknown>;
  const rf = o.requested_formats;
  if (Array.isArray(rf) && rf.length > 0) {
    const streams: SectionDirectResolvedStream[] = [];
    for (const item of rf) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const f = item as Record<string, unknown>;
      const url = f.url;
      if (typeof url !== 'string' || !url.trim()) {
        continue;
      }
      streams.push({
        url: url.trim(),
        headers: normalizeYtDlpHeaders(f.http_headers),
        vcodec: String(f.vcodec ?? 'none'),
        acodec: String(f.acodec ?? 'none'),
      });
    }
    return streams.length > 0 ? streams : null;
  }
  const url = o.url;
  if (typeof url === 'string' && url.trim()) {
    return [
      {
        url: url.trim(),
        headers: normalizeYtDlpHeaders(o.http_headers),
        vcodec: String(o.vcodec ?? 'none'),
        acodec: String(o.acodec ?? 'none'),
      },
    ];
  }
  return null;
}

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

/** Shown when stderr goes quiet during section post-process — text matches actual container/codecs. */
function clipQuietPhaseHint(request: ItemDownloadRequest): string {
  const tail =
    'ffmpeg may print nothing for minutes — still working unless CPU & disk stay at 0 for a long time.';
  if (request.mediaType === 'audio-only' || request.audioOnly) {
    return `Finalizing clip… audio extract/encode — ${tail}`;
  }
  const f = request.outputFormat;
  if (f === 'webm') {
    return `Finalizing clip… merge/remux to WebM (often copy) — ${tail}`;
  }
  if (f === 'mp4' && request.audioPreference === 'aac') {
    return `Finalizing clip… MP4 merge or AAC transcode — ${tail}`;
  }
  if (f === 'mp4') {
    return `Finalizing clip… remux to MP4 — ${tail}`;
  }
  if (f === 'mkv') {
    return `Finalizing clip… merge/remux to MKV — ${tail}`;
  }
  return `Finalizing clip… merge/remux — ${tail}`;
}

export class YtDlpDownloadService {
  private readonly activeProcesses = new Map<string, ChildProcess>();
  /** User pressed Stop — used because Windows often reports `signal: null` on killed children. */
  private readonly userCancelledDownloadIds = new Set<string>();

  constructor(
    private readonly pathsService: AppPathsService,
    private readonly binaryResolver: BinaryResolver,
  ) {}

  cancelItem(id: string): boolean {
    const child = this.activeProcesses.get(id);
    if (!child || child.killed) return false;
    this.userCancelledDownloadIds.add(id);
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

    const downloadDir = settings.downloadDirectory || this.pathsService.getPaths().managedDirectories.downloads;
    const outputTemplate = join(downloadDir, `${request.id}__%(title).200B.%(ext)s`);

    const isClipDownload = this.requiresPartialSectionDownload(request);
    const progressLabel = isClipDownload ? 'Clip' : 'Download';

    onProgress({
      id: request.id,
      phase: 'downloading',
      percent: 0,
      speed: '',
      eta: '',
      message: isClipDownload ? 'Starting clip download…' : 'Starting download...',
    });

    if (isClipDownload) {
      const directResult = await this.downloadSectionDirect(
        request,
        settings,
        onProgress,
        downloadDir,
        ytDlp.resolvedPath!,
        ffmpeg.resolvedPath!,
      );
      if (directResult !== null) {
        return directResult;
      }
      onProgress({
        id: request.id,
        phase: 'downloading',
        percent: 0,
        speed: '',
        eta: '',
        message: 'Retrying with fragment-based download…',
      });
    }

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
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8',
          /** Avoid tools switching to “no TTY” / no-progress behavior when piped. */
          FORCE_COLOR: '0',
          NO_COLOR: '1',
        },
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
      let lastPartBytes = 0;
      let clipHeartbeat: ReturnType<typeof setInterval> | null = null;
      let mergeWatchdog: ReturnType<typeof setInterval> | null = null;
      let lastSubstantiveStderrAt = Date.now();
      let clipFinalizingHintEmitted = false;
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

      const clearClipHeartbeat = (): void => {
        if (clipHeartbeat != null) {
          clearInterval(clipHeartbeat);
          clipHeartbeat = null;
        }
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
        clearClipHeartbeat();
        this.activeProcesses.delete(request.id);
        resolve(out);
      };

      const mergingMessage = isClipDownload
        ? 'Combining clip streams…'
        : 'Combining streams and writing the final file…';

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
            message: `${progressLabel}: ${progressMatch[1]}%`,
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
            message: `${progressLabel}: ${finishedMatch[1]}% (in ${finishedMatch[2]})`,
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
            message: `${progressLabel}: ${percentOnlyMatch[1]}%`,
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
            message: `${progressLabel}: ${bytesMatch[1]} at ${bytesMatch[2].trim()} (${bytesMatch[3]})`,
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
            message: `${progressLabel}: ${loosePct[1]}%`,
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
              message: isClipDownload ? 'Finalizing clip (ffmpeg)…' : 'Processing output (ffmpeg)…',
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
            message: encodingLike
              ? (isClipDownload ? 'Encoding clip…' : 'Encoding / remuxing…')
              : (isClipDownload ? 'Merging clip…' : 'Merging streams…'),
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

      if (isClipDownload) {
        clipHeartbeat = setInterval(() => {
          if (child.killed) {
            return;
          }
          if (Date.now() - lastProgressEmitAt < 2500) {
            return;
          }

          if (inHeavyPostprocess) {
            const ui = lastPostUi ?? { phase: 'merging' as const, message: mergingMessage };
            const baseMsg = stripElapsedSuffixFromProgressMessage(ui.message) || mergingMessage;
            const sec = Math.floor((Date.now() - (heavyPostprocessSince ?? Date.now())) / 1000);
            emit({
              id: request.id,
              phase: ui.phase,
              percent: 99,
              speed: '',
              eta: '',
              message: sec > 0 ? `${baseMsg} (${sec}s)` : baseMsg,
            });
            return;
          }

          const written = sumStreamingBytesForDownload(tempDir, downloadDir, request.id);
          if (written > lastPartBytes && written > 0) {
            lastPartBytes = written;
            const pct = Math.min(99, 22 + Math.log10(written + 1) * 14);
            emit({
              id: request.id,
              phase: 'downloading',
              percent: Math.round(Math.max(pct, lastShownPercent)),
              speed: '',
              eta: '',
              message: `${progressLabel}: ${formatBytesForProgress(written)} written…`,
            });
            return;
          }

          if (
            !clipFinalizingHintEmitted &&
            lastShownPercent >= 96 &&
            Date.now() - lastSubstantiveStderrAt > 20000
          ) {
            clipFinalizingHintEmitted = true;
            inHeavyPostprocess = true;
            emit({
              id: request.id,
              phase: 'merging',
              percent: 99,
              speed: '',
              eta: '',
              message: clipQuietPhaseHint(request),
            });
            return;
          }

          const pct = Math.min(99, Math.max(lastShownPercent + 2, 10));
          emit({
            id: request.id,
            phase: 'downloading',
            percent: pct,
            speed: '',
            eta: '',
            message: 'Downloading clip…',
          });
        }, 1500);

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
            const heavySince =
              heavyPostprocessSince != null ? Date.now() - heavyPostprocessSince : 0;
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
      }

      timeoutHandle = setTimeout(() => {
        if (!child.killed) {
          clearClipHeartbeat();
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
        clearClipHeartbeat();
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
        clearClipHeartbeat();

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
            message: 'Merge stalled — retrying with sequential fragments…',
          });
          finish({
            id: request.id,
            success: false,
            outputPath: null,
            error: 'Merge step produced no disk progress. Retrying once with safer section settings.',
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
     * For section clips, if audio is still Opus, postprocess fails and we retry once with encode
     * (`shouldRetryMp4WithAacEncodeAfterCopyRemuxFailure`) — same as full-video downloads.
     */
    const tryM4aCopyRemux = this.prefersM4aDashAudio(request);

    const runWithRemuxMode = (
      selection: string[] | undefined,
      mode: 'copy' | 'encode',
      sectionConc?: number | 'omit',
    ): string[] =>
      this.buildArgs(
        request,
        outputTemplate,
        tempDir,
        ffmpeg.resolvedPath,
        settings,
        selection,
        mode,
        sectionConc,
      );

    const initialMode: 'copy' | 'encode' = tryM4aCopyRemux ? 'copy' : 'encode';
    let result = await runAttempt(runWithRemuxMode(undefined, initialMode), { allowMergeStallRecovery: true });
    if (result.mergeStallRetry && this.requiresPartialSectionDownload(request)) {
      mkdirSync(tempDir, { recursive: true });
      result = await runAttempt(runWithRemuxMode(undefined, initialMode, 'omit'), {
        allowMergeStallRecovery: false,
      });
    }
    if (
      !result.success &&
      tryM4aCopyRemux &&
      this.shouldRetryMp4WithAacEncodeAfterCopyRemuxFailure(result.error)
    ) {
      result = await runAttempt(runWithRemuxMode(undefined, 'encode'), { allowMergeStallRecovery: true });
      if (result.mergeStallRetry && this.requiresPartialSectionDownload(request)) {
        mkdirSync(tempDir, { recursive: true });
        result = await runAttempt(runWithRemuxMode(undefined, 'encode', 'omit'), { allowMergeStallRecovery: false });
      }
    }

    if (!result.success && this.isFormatNotAvailableError(result.error)) {
      result = await runAttempt(
        runWithRemuxMode(this.buildFallbackSelectionArgs(request), tryM4aCopyRemux ? 'copy' : 'encode'),
        { allowMergeStallRecovery: true },
      );
      if (result.mergeStallRetry && this.requiresPartialSectionDownload(request)) {
        mkdirSync(tempDir, { recursive: true });
        result = await runAttempt(
          runWithRemuxMode(this.buildFallbackSelectionArgs(request), tryM4aCopyRemux ? 'copy' : 'encode', 'omit'),
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
        if (result.mergeStallRetry && this.requiresPartialSectionDownload(request)) {
          mkdirSync(tempDir, { recursive: true });
          result = await runAttempt(runWithRemuxMode(this.buildFallbackSelectionArgs(request), 'encode', 'omit'), {
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
      if (result.mergeStallRetry && this.requiresPartialSectionDownload(request)) {
        mkdirSync(tempDir, { recursive: true });
        result = await runAttempt(
          runWithRemuxMode(this.buildLastResortSelectionArgs(request), tryM4aCopyRemux ? 'copy' : 'encode', 'omit'),
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
        if (result.mergeStallRetry && this.requiresPartialSectionDownload(request)) {
          mkdirSync(tempDir, { recursive: true });
          result = await runAttempt(runWithRemuxMode(this.buildLastResortSelectionArgs(request), 'encode', 'omit'), {
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

  private buildSectionDirectOutputPath(request: ItemDownloadRequest, downloadDir: string): string {
    const base = sanitizeDownloadDisplayName(request.title);
    let ext: string;
    if (request.mediaType === 'audio-only' || request.audioOnly) {
      ext = this.mapAudioFormat(request.outputFormat);
    } else if (request.outputFormat === 'original') {
      ext = 'mp4';
    } else {
      ext = request.outputFormat;
    }
    return join(downloadDir, `${request.id}__${base}.${ext}`);
  }

  private appendSectionDirectAudioOnlyCodec(
    ffmpegArgs: string[],
    request: ItemDownloadRequest,
    audioStream: SectionDirectResolvedStream,
  ): void {
    const ac = audioStream.acodec.toLowerCase();
    const opus = ac.includes('opus');
    const fmt = request.outputFormat;
    if (fmt === 'webm') {
      ffmpegArgs.push('-c:a', 'copy');
      return;
    }
    if (opus) {
      if (fmt === 'mp3') {
        ffmpegArgs.push('-c:a', 'libmp3lame', '-b:a', '192k');
      } else if (fmt === 'm4a' || fmt === 'mp4') {
        ffmpegArgs.push('-c:a', 'aac', '-b:a', '192k', '-aac_coder', 'fast', '-threads', '0');
      } else if (fmt === 'wav') {
        ffmpegArgs.push('-c:a', 'pcm_s16le');
      } else if (fmt === 'flac') {
        ffmpegArgs.push('-c:a', 'flac');
      } else {
        ffmpegArgs.push('-c:a', 'aac', '-b:a', '192k', '-aac_coder', 'fast', '-threads', '0');
      }
      return;
    }
    ffmpegArgs.push('-c:a', 'copy');
  }

  /**
   * Fast section download: resolve stream URLs with yt-dlp `-j`, then ffmpeg `-ss`/`-to` before `-i`.
   * Returns `null` so the caller falls back to `--download-sections` when this path cannot run or ffmpeg fails.
   */
  private async downloadSectionDirect(
    request: ItemDownloadRequest,
    settings: AppSettings,
    onProgress: ProgressCallback,
    downloadDir: string,
    ytDlpPath: string,
    ffmpegPath: string,
  ): Promise<ItemDownloadResult | null> {
    if (!this.requiresPartialSectionDownload(request)) {
      return null;
    }
    const dur = request.durationSeconds;
    if (dur == null || dur <= 0) {
      return null;
    }
    if (!existsSync(ffmpegPath)) {
      return null;
    }

    const start = request.sectionStartSec ?? 0;
    const end = request.sectionEndSec ?? dur;
    const clipDuration = Math.max(0.1, end - start);

    const logsDownloadsDir = join(this.pathsService.getPaths().managedDirectories.logs, 'downloads');
    let logStream: WriteStream | null = null;
    const logLine = (s: string): void => {
      try {
        logStream?.write(`${s}\n`);
      } catch {
        /* ignore */
      }
    };

    onProgress({
      id: request.id,
      phase: 'downloading',
      percent: 0,
      speed: '',
      eta: '',
      message: 'Clip: resolving stream URLs…',
    });

    const jsonArgs = [
      '--ignore-config',
      '--js-runtimes',
      'node',
      '--no-playlist',
      '--no-warnings',
      ...this.buildSelectionArgs(request),
      ...buildYtDlpCookieArgs(settings, this.pathsService),
      '-j',
      request.url,
    ];

    if (settings.saveDownloadLogs) {
      try {
        mkdirSync(logsDownloadsDir, { recursive: true });
        const safeTime = new Date().toISOString().replace(/[:.]/g, '-');
        const logPath = join(logsDownloadsDir, `${request.id.slice(0, 8)}-direct-${safeTime}.log`);
        logStream = createWriteStream(logPath, { flags: 'a' });
        logLine('# Yoinkr section-direct (ffmpeg stream-seek) log');
        logLine(`# id=${request.id}`);
        logLine(`# url=${request.url}`);
        logLine(`# yt-dlp_version=${toolVersionLine(ytDlpPath, ['--version'])}`);
        logLine(`# ffmpeg_version=${toolVersionLine(ffmpegPath, ['-version'])}`);
        logLine(`# yt-dlp_json_args=${JSON.stringify(jsonArgs)}`);
      } catch {
        logStream = null;
      }
    }

    const probe = spawnSync(ytDlpPath, jsonArgs, {
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      timeout: 60_000,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
    });

    if (probe.error || probe.status !== 0) {
      logLine(`# yt-dlp -j failed status=${probe.status} err=${probe.error?.message ?? ''}`);
      logStream?.end();
      return null;
    }

    let info: unknown;
    try {
      const raw = (probe.stdout ?? '').trim();
      if (!raw) {
        logStream?.end();
        return null;
      }
      info = JSON.parse(raw);
    } catch {
      logLine('# JSON parse failed');
      logStream?.end();
      return null;
    }

    const streams = parseSectionDirectStreamsFromJson(info);
    if (!streams || streams.length === 0) {
      logLine('# No stream URLs in JSON');
      logStream?.end();
      return null;
    }

    const isVid = (s: SectionDirectResolvedStream) => s.vcodec && s.vcodec !== 'none';
    const isAud = (s: SectionDirectResolvedStream) => s.acodec && s.acodec !== 'none';

    let videoStream: SectionDirectResolvedStream | undefined;
    let audioStream: SectionDirectResolvedStream | undefined;
    let singleCombined: SectionDirectResolvedStream | undefined;

    if (streams.length >= 2) {
      videoStream = streams.find(isVid);
      audioStream = streams.find(isAud);
      if (!videoStream || !audioStream) {
        logLine('# Could not split video/audio from requested_formats');
        logStream?.end();
        return null;
      }
    } else {
      const one = streams[0]!;
      if (isVid(one) && isAud(one)) {
        singleCombined = one;
      } else if (isVid(one)) {
        videoStream = one;
      } else if (isAud(one)) {
        audioStream = one;
      } else {
        logStream?.end();
        return null;
      }
    }

    const wantAudioOnly = request.mediaType === 'audio-only' || request.audioOnly;
    const wantVideoOnly = request.mediaType === 'video-only';
    if (wantAudioOnly && !audioStream && !singleCombined) {
      logStream?.end();
      return null;
    }
    if (wantVideoOnly && !videoStream && !singleCombined) {
      logStream?.end();
      return null;
    }
    if (!wantAudioOnly && !wantVideoOnly && !(singleCombined || (videoStream && audioStream))) {
      logStream?.end();
      return null;
    }

    const outPath = this.buildSectionDirectOutputPath(request, downloadDir);
    if (existsSync(outPath)) {
      try {
        unlinkSync(outPath);
      } catch {
        /* ignore */
      }
    }

    const audioForCodec =
      audioStream ?? (singleCombined && isAud(singleCombined) ? singleCombined : undefined);
    const opusAudio =
      audioForCodec != null &&
      audioForCodec.acodec.toLowerCase().includes('opus') &&
      request.outputFormat !== 'webm';
    const needAacForMergedMp4 =
      !wantAudioOnly &&
      !wantVideoOnly &&
      request.outputFormat === 'mp4' &&
      request.audioPreference === 'aac' &&
      opusAudio;

    const muxQ = ['-max_muxing_queue_size', SECTION_FFMPEG_MUX_QUEUE];
    const ffmpegArgs: string[] = ['-nostdin', '-hide_banner', '-y', ...muxQ];

    const pushInput = (headers: Record<string, string> | undefined, url: string): void => {
      ffmpegArgs.push(...ffmpegHeadersArg(headers), '-ss', String(start), '-to', String(end), '-i', url);
    };

    if (singleCombined) {
      pushInput(singleCombined.headers, singleCombined.url);
      if (wantAudioOnly) {
        ffmpegArgs.push('-map', '0:a:0');
        this.appendSectionDirectAudioOnlyCodec(ffmpegArgs, request, singleCombined);
      } else if (wantVideoOnly) {
        ffmpegArgs.push('-map', '0:v:0', '-c:v', 'copy');
      } else {
        ffmpegArgs.push('-map', '0:v:0', '-map', '0:a:0');
        if (needAacForMergedMp4) {
          ffmpegArgs.push(
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-b:a',
            '192k',
            '-aac_coder',
            'fast',
            '-threads',
            '0',
          );
        } else {
          ffmpegArgs.push('-c', 'copy');
        }
      }
    } else if (videoStream && audioStream) {
      pushInput(videoStream.headers, videoStream.url);
      pushInput(audioStream.headers, audioStream.url);
      ffmpegArgs.push('-map', '0:v:0', '-map', '1:a:0');
      if (needAacForMergedMp4) {
        ffmpegArgs.push(
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-aac_coder',
          'fast',
          '-threads',
          '0',
        );
      } else {
        ffmpegArgs.push('-c', 'copy');
      }
    } else if (videoStream) {
      pushInput(videoStream.headers, videoStream.url);
      ffmpegArgs.push('-map', '0:v:0', '-c:v', 'copy');
    } else if (audioStream) {
      pushInput(audioStream.headers, audioStream.url);
      ffmpegArgs.push('-map', '0:a:0');
      this.appendSectionDirectAudioOnlyCodec(ffmpegArgs, request, audioStream);
    } else {
      logStream?.end();
      return null;
    }

    if (!wantAudioOnly) {
      ffmpegArgs.push('-avoid_negative_ts', 'make_zero');
    }
    const containerMp4 =
      (!wantAudioOnly && (request.outputFormat === 'mp4' || request.outputFormat === 'original')) ||
      (wantAudioOnly && request.outputFormat === 'mp4');
    if (containerMp4) {
      ffmpegArgs.push('-movflags', '+faststart');
    }

    ffmpegArgs.push(outPath);

    logLine(`# phase=${new Date().toISOString()} ffmpeg_start`);
    logLine(`# ffmpeg_args=${JSON.stringify(ffmpegArgs)}`);

    onProgress({
      id: request.id,
      phase: 'downloading',
      percent: 1,
      speed: '',
      eta: '',
      message: 'Clip: streaming segment (ffmpeg)…',
    });

    return await new Promise<ItemDownloadResult | null>((resolve) => {
      const child = spawn(ffmpegPath, ffmpegArgs, {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env },
      });

      this.activeProcesses.set(request.id, child);

      let stderrAcc = '';
      let buf = '';
      let lastEmit = 0;
      let finished = false;
      /** Long clips / slow CDN; fallback path still exists if this fires. */
      const directTimeoutMs = 45 * 60 * 1000;
      const timeoutKill = setTimeout(() => {
        if (finished) {
          return;
        }
        logLine(`# direct ffmpeg timeout after ${directTimeoutMs}ms`);
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
      }, directTimeoutMs);

      const done = (out: ItemDownloadResult | null): void => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(timeoutKill);
        this.activeProcesses.delete(request.id);
        logLine(`# phase=${new Date().toISOString()} done success=${out?.success ?? 'null'}`);
        logStream?.end();
        resolve(out);
      };

      const feedErr = (chunk: Buffer): void => {
        const text = chunk.toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        stderrAcc += text;
        buf += text;
        logStream?.write(text);
        let idx: number;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          const clean = stripAnsi(line);
          const tm = clean.match(FFMPEG_TIME_RE);
          if (tm) {
            const now = Date.now();
            if (now - lastEmit >= FFMPEG_PROGRESS_THROTTLE_MS) {
              lastEmit = now;
              const tsec = parseFfmpegTimeToSeconds(tm[1]!);
              const pct = Math.min(99, Math.round((tsec / clipDuration) * 100));
              onProgress({
                id: request.id,
                phase: 'downloading',
                percent: Math.max(1, pct),
                speed: '',
                eta: '',
                message: `Clip: ${pct}%`,
              });
            }
          }
        }
      };

      child.stderr?.on('data', feedErr);

      child.on('error', () => {
        try {
          if (existsSync(outPath)) {
            unlinkSync(outPath);
          }
        } catch {
          /* ignore */
        }
        done(null);
      });

      child.on('close', (code) => {
        if (buf.length > 0) {
          const lines = buf.split('\n');
          for (const line of lines) {
            const clean = stripAnsi(line);
            const tm = clean.match(FFMPEG_TIME_RE);
            if (tm) {
              const tsec = parseFfmpegTimeToSeconds(tm[1]!);
              const pct = Math.min(99, Math.round((tsec / clipDuration) * 100));
              onProgress({
                id: request.id,
                phase: 'downloading',
                percent: Math.max(1, pct),
                speed: '',
                eta: '',
                message: `Clip: ${pct}%`,
              });
            }
          }
          buf = '';
        }
        const userCancelled = this.userCancelledDownloadIds.delete(request.id);
        if (userCancelled) {
          try {
            if (existsSync(outPath)) {
              unlinkSync(outPath);
            }
          } catch {
            /* ignore */
          }
          const msg = 'Download cancelled.';
          onProgress({ id: request.id, phase: 'error', percent: 0, speed: '', eta: '', message: msg });
          done({ id: request.id, success: false, outputPath: null, error: msg });
          return;
        }
        if (code === 0 && existsSync(outPath)) {
          const renamed = this.renameToFriendlyTitle(outPath, request);
          onProgress({
            id: request.id,
            phase: 'complete',
            percent: 100,
            speed: '',
            eta: '',
            message: 'Download complete!',
          });
          done({ id: request.id, success: true, outputPath: renamed });
          return;
        }
        try {
          if (existsSync(outPath)) {
            unlinkSync(outPath);
          }
        } catch {
          /* ignore */
        }
        logLine(`# ffmpeg exit=${code} stderr_tail=${JSON.stringify(stderrAcc.slice(-800))}`);
        done(null);
      });
    });
  }

  /**
   * MP4 + AAC: YouTube DASH audio is often Opus → we must AAC-encode in VideoRemuxer (slow).
   * Prefer **m4a** DASH audio when available so merge/remux is mostly stream-copy.
   */
  private prefersM4aDashAudio(request: ItemDownloadRequest): boolean {
    return (
      request.mediaType === 'video-audio' &&
      !request.audioOnly &&
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
    /**
     * Section jobs: override parallel fragments from settings, or `omit` for yt-dlp default (sequential)
     * after merge-stall recovery.
     */
    sectionConcurrencyOverride?: number | 'omit',
  ): string[] {
    const args: string[] = [
      '--ignore-config',
      '--js-runtimes', 'node',
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

    if (this.requiresPartialSectionDownload(request)) {
      if (sectionConcurrencyOverride !== 'omit') {
        const n =
          sectionConcurrencyOverride != null
            ? clampSectionConcurrentFragments(sectionConcurrencyOverride)
            : clampSectionConcurrentFragments(settings.sectionConcurrentFragments);
        args.push('--concurrent-fragments', String(n));
      }
      /** Fewer `.part` files + AV scanning churn on slow disks (section jobs only). */
      args.push('--no-part');
      /** Cleaner cuts at section boundaries; yt-dlp passes keyframe forcing into ffmpeg. */
      args.push('--force-keyframes-at-cuts');
      args.push('--http-chunk-size', SECTION_HTTP_CHUNK_SIZE);
      args.push('--fragment-retries', '5');
      args.push('--retries', '3');
      /** Long VODs / slow CDNs: avoid dropping connections while fragments still arrive. */
      args.push('--socket-timeout', '120');
      /**
       * Windows: ffmpeg can wait on stdin when spawned under yt-dlp; Merger may need its own ppa.
       */
      args.push('--ppa', `ffmpeg:-nostdin -max_muxing_queue_size ${SECTION_FFMPEG_MUX_QUEUE}`);
      args.push('--ppa', `Merger+ffmpeg:-nostdin -max_muxing_queue_size ${SECTION_FFMPEG_MUX_QUEUE}`);
    }

    args.push(...(selectionOverride ?? this.buildSelectionArgs(request)));

    if (request.mediaType === 'audio-only' || request.audioOnly) {
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
        const muxQ = this.requiresPartialSectionDownload(request)
          ? ` -max_muxing_queue_size ${SECTION_FFMPEG_MUX_QUEUE}`
          : '';
        if (mp4AacRemuxMode === 'copy') {
          args.push('--ppa', `VideoRemuxer+ffmpeg:-nostdin${muxQ} -c:v copy -c:a copy`);
        } else {
          /** Section + encode: slightly lower bitrate saves a bit of CPU with minimal quality loss. */
          const aacBr = this.requiresPartialSectionDownload(request) ? '160k' : '192k';
          /** `-threads 0` = ffmpeg picks core count — much faster AAC encode than forcing 1 thread. */
          args.push(
            '--ppa',
            `VideoRemuxer+ffmpeg:-nostdin${muxQ} -c:v copy -c:a aac -b:a ${aacBr} -aac_coder fast -threads 0`,
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

  /**
   * VP9/AV1 + stream-copy into MP4 after `--download-sections` often shows **all black** in Windows
   * players; prefer AVC (`avc1`) when remuxing section clips to MP4.
   */
  private preferAvcForSectionMp4(request: ItemDownloadRequest): boolean {
    if (request.outputFormat !== 'mp4') {
      return false;
    }
    if (request.mediaType === 'audio-only' || request.audioOnly) {
      return false;
    }
    return this.requiresPartialSectionDownload(request);
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

    if (request.mediaType === 'audio-only' || request.audioOnly) {
      selectors.push('bestaudio/best');

      if (request.audioPreference === 'aac') {
        sortFields.push('aext:m4a');
      } else if (request.audioPreference === 'opus') {
        sortFields.push('acodec:opus', 'aext:webm');
      }
    } else if (request.mediaType === 'video-only') {
      if (this.preferAvcForSectionMp4(request)) {
        selectors.push(
          heightFilter
            ? `bestvideo[vcodec^=avc1][height<=${heightFilter}]/bestvideo[vcodec^=avc][height<=${heightFilter}]/bestvideo[height<=${heightFilter}]/bestvideo/best`
            : 'bestvideo[vcodec^=avc1]/bestvideo[vcodec^=avc]/bestvideo/best',
        );
        sortFields.push('vcodec:h264');
        if (heightFilter) {
          sortFields.push(`res:${heightFilter}`);
        }
      } else {
        selectors.push(
          heightFilter
            ? `bestvideo[height<=${heightFilter}]/bestvideo*[height<=${heightFilter}]/bestvideo/best[height<=${heightFilter}]/best`
            : 'bestvideo/bestvideo*/best',
        );

        if (heightFilter) {
          sortFields.push(`res:${heightFilter}`);
        }
      }
      sortFields.push(...this.getContainerSortBias(request.outputFormat, false, request.audioPreference));
    } else {
      /**
       * Merge video+audio: keep the `-f` chain short and YouTube-stable. Long slash chains with
       * `bestvideo*` / `bv*+ba` variants still fail on some videos ("Requested format is not available").
       * `--remux-video mp4` (below) handles MP4; avoid `-S vext:mp4` here (breaks some merges).
       *
       * For `--download-sections` + MP4, prefer AVC — VP9-in-MP4 stream-copy often plays as black on Windows.
       *
       * MP4 + AAC: prefer `bestaudio[ext=m4a]` + `-S aext:m4a` so DASH audio is often already AAC
       * (mux/remux is much faster than Opus→AAC transcode).
       */
      const m4a = this.prefersM4aDashAudio(request);
      if (this.preferAvcForSectionMp4(request)) {
        if (heightFilter) {
          selectors.push(
            m4a
              ? `bestvideo[vcodec^=avc1][height<=${heightFilter}]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc1][height<=${heightFilter}]+bestaudio/bestvideo[vcodec^=avc][height<=${heightFilter}]+bestaudio/bestvideo[height<=${heightFilter}]+bestaudio/bestvideo+bestaudio/best`
              : `bestvideo[vcodec^=avc1][height<=${heightFilter}]+bestaudio/bestvideo[vcodec^=avc][height<=${heightFilter}]+bestaudio/bestvideo[height<=${heightFilter}]+bestaudio/bestvideo+bestaudio/best`,
          );
          sortFields.push(`res:${heightFilter}`, 'vcodec:h264');
          if (m4a) {
            sortFields.push('aext:m4a');
          }
        } else {
          selectors.push(
            m4a
              ? 'bestvideo[vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc1]+bestaudio/bestvideo[vcodec^=avc]+bestaudio/bestvideo+bestaudio/best'
              : 'bestvideo[vcodec^=avc1]+bestaudio/bestvideo[vcodec^=avc]+bestaudio/bestvideo+bestaudio/best',
          );
          sortFields.push('vcodec:h264');
          if (m4a) {
            sortFields.push('aext:m4a');
          }
        }
      } else if (heightFilter) {
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
    const sectionDownload = this.requiresPartialSectionDownload(request);
    if (request.mediaType === 'audio-only' || request.audioOnly) {
      return ['-f', 'bestaudio/best'];
    }
    if (request.mediaType === 'video-only') {
      if (this.preferAvcForSectionMp4(request)) {
        const sel = heightFilter
          ? `bestvideo[vcodec^=avc1][height<=${heightFilter}]/bestvideo[vcodec^=avc][height<=${heightFilter}]/bestvideo/best`
          : 'bestvideo[vcodec^=avc1]/bestvideo/best';
        return ['-f', sel];
      }
      const sel = heightFilter
        ? `bestvideo[height<=${heightFilter}]/bestvideo/best`
        : 'bestvideo/best';
      if (sectionDownload) {
        return ['-f', 'bestvideo/bestvideo*'];
      }
      return ['-f', sel];
    }
    if (this.preferAvcForSectionMp4(request)) {
      const m4a = this.prefersM4aDashAudio(request);
      const sel = heightFilter
        ? m4a
          ? `bestvideo[vcodec^=avc1][height<=${heightFilter}]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc1][height<=${heightFilter}]+bestaudio/bv*+ba/bestvideo+bestaudio/best`
          : `bestvideo[vcodec^=avc1][height<=${heightFilter}]+bestaudio/bv*+ba/bestvideo+bestaudio/best`
        : m4a
          ? `bestvideo[vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc1]+bestaudio/bv*+ba/bestvideo+bestaudio/best`
          : 'bestvideo[vcodec^=avc1]+bestaudio/bv*+ba/bestvideo+bestaudio/best';
      if (sectionDownload) {
        const sectionSel = heightFilter
          ? m4a
            ? `bestvideo[vcodec^=avc1][height<=${heightFilter}]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc1][height<=${heightFilter}]+bestaudio/bv*+ba/bestvideo+bestaudio`
            : `bestvideo[vcodec^=avc1][height<=${heightFilter}]+bestaudio/bv*+ba/bestvideo+bestaudio`
          : m4a
            ? 'bestvideo[vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc1]+bestaudio/bv*+ba/bestvideo+bestaudio'
            : 'bestvideo[vcodec^=avc1]+bestaudio/bv*+ba/bestvideo+bestaudio';
        return ['-f', sectionSel];
      }
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
    if (sectionDownload) {
      const sectionSel = heightFilter
        ? m4a
          ? `bestvideo[height<=${heightFilter}]+bestaudio[ext=m4a]/bestvideo[height<=${heightFilter}]+bestaudio/bv*+ba/bestvideo+bestaudio`
          : `bestvideo[height<=${heightFilter}]+bestaudio/bv*+ba/bestvideo+bestaudio`
        : m4a
          ? 'bestvideo+bestaudio[ext=m4a]/bv*+ba/bestvideo+bestaudio'
          : 'bv*+ba/bestvideo+bestaudio';
      return ['-f', sectionSel];
    }
    return ['-f', sel];
  }

  /**
   * Last resort: combined `best` stream (often lower quality but almost always available).
   */
  private buildLastResortSelectionArgs(request: ItemDownloadRequest): string[] {
    const sectionDownload = this.requiresPartialSectionDownload(request);
    if (request.mediaType === 'audio-only' || request.audioOnly) {
      return ['-f', 'bestaudio/best'];
    }
    if (request.mediaType === 'video-only') {
      if (sectionDownload) {
        return ['-f', 'bestvideo/bestvideo*'];
      }
      return ['-f', 'best/bestvideo/best'];
    }
    if (sectionDownload) {
      return ['-f', 'bv*+ba/bestvideo+bestaudio'];
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

