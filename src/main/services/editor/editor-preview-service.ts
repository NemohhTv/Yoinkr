import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

import { BrowserWindow } from 'electron';

import type { AppPathsService } from '@main/services/paths/app-paths-service';
import type { BinaryResolver } from '@main/services/tools/binary-resolver';
import type { EditorMediaInfo, EditorMediaStreamInfo } from '@shared/types/editor';
import type { AppSettings } from '@shared/types/settings';
import { ipcChannels } from '@shared/contracts/channels';

const AUDIO_PREVIEW_EXTENSIONS = new Set([
  '.mp4',
  '.m4v',
  '.webm',
  '.mp3',
  '.m4a',
  '.wav',
  '.ogg',
  '.oga',
]);

function videoNeedsProxy(stream: EditorMediaStreamInfo | null): boolean {
  if (!stream) {
    return true;
  }

  const codec = (stream.codecName ?? '').toLowerCase();
  const profile = (stream.profile ?? '').toLowerCase();
  const pix = (stream.pixelFormat ?? '').toLowerCase();

  if (codec === 'vp8' || codec === 'vp9' || codec === 'av1' || codec === 'libvpx-vp9' || codec === 'libvpx') {
    return false;
  }
  if (codec === 'theora') {
    return false;
  }
  // HEVC: do not force an H.264 proxy — same idea as 0.1.0 (file:// + Chromium/Electron often HW-decodes
  // HEVC in MP4 on Windows). Background transcode was hiding that and could run for huge files.
  // Proxy only when pixel format/profile suggests <video> is unlikely to decode (10/12-bit, high chroma).
  if (codec === 'hevc' || codec === 'h265') {
    if (pix.includes('10') || pix.includes('12') || pix.includes('422') || pix.includes('444')) {
      return true;
    }
    if (profile.includes('main 10') || profile.includes('high 10') || profile.includes('4:2:2') || profile.includes('4:4:4')) {
      return true;
    }
    return false;
  }
  if (codec === 'mpeg2video' || codec === 'mpeg2') {
    return true;
  }
  if (codec === 'prores' || codec === 'dnxhd' || codec === 'dnxhr' || codec === 'mjpeg' || codec === 'jpeg2000') {
    return true;
  }
  if (codec === 'h264' || codec === 'avc' || codec === 'avc1') {
    if (pix.includes('10') || pix.includes('12') || pix.includes('422') || pix.includes('444')) {
      return true;
    }
    if (profile.includes('high 10') || profile.includes('high 4:2:2') || profile.includes('4:4:4')) {
      return true;
    }
    return false;
  }
  if (codec === 'mpeg4' || codec === 'msmpeg4' || codec === 'msmpeg4v3' || codec === 'wmv3' || codec === 'vc1') {
    return true;
  }
  return true;
}

function cachePathForSource(sourcePath: string, cacheRoot: string): string {
  const st = statSync(sourcePath);
  const hash = createHash('sha256')
    .update(`${sourcePath}|${st.size}|${st.mtimeMs}`)
    .digest('hex')
    .slice(0, 32);
  return join(cacheRoot, `${hash}.mp4`);
}

function runFfmpeg(ffmpegPath: string, args: string[], timeoutMs: number): Promise<{ exitCode: number | null; stderrTail: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderrTail = '';
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderrTail += chunk.toString();
      if (stderrTail.length > 96_000) {
        stderrTail = stderrTail.slice(-48_000);
      }
    });

    let timeoutHandle: NodeJS.Timeout | null = null;
    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        child.kill('SIGKILL');
      }, timeoutMs);
    }

    child.on('error', (error) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      reject(error);
    });

    child.on('close', (exitCode) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      resolve({ exitCode, stderrTail });
    });
  });
}

export interface EditorPreviewResolution {
  playbackPath: string;
  previewSupported: boolean;
  note: string | null;
}

function buildPreviewTranscodeArgs(sourcePath: string, mediaInfo: EditorMediaInfo, cacheFile: string): string[] {
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', sourcePath];

  const vi = mediaInfo.primaryVideoStream?.index;
  if (vi !== undefined && vi !== null) {
    args.push('-map', `0:${vi}`);
  } else {
    args.push('-map', '0:v:0');
  }

  if (mediaInfo.hasAudio && mediaInfo.primaryAudioStream) {
    args.push('-map', `0:${mediaInfo.primaryAudioStream.index}`);
  }

  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-profile:v',
    'high',
    '-level',
    '4.1',
    '-movflags',
    '+faststart',
  );

  if (mediaInfo.hasAudio && mediaInfo.primaryAudioStream) {
    args.push('-c:a', 'aac', '-b:a', '128k');
  }

  args.push(cacheFile);
  return args;
}

export class EditorPreviewService {
  constructor(
    private readonly pathsService: AppPathsService,
    private readonly binaryResolver: BinaryResolver,
  ) {}

  private notifyPreviewProxyReady(sourcePath: string, playbackPath: string): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(ipcChannels.editorPreviewProxyReady, { sourcePath, playbackPath });
      }
    }
  }

  private startBackgroundProxyTranscode(
    sourcePath: string,
    mediaInfo: EditorMediaInfo,
    ffmpegPath: string,
    cacheFile: string,
  ): void {
    const args = buildPreviewTranscodeArgs(sourcePath, mediaInfo, cacheFile);
    const timeoutMs = 6 * 60 * 60 * 1000;
    void runFfmpeg(ffmpegPath, args, timeoutMs)
      .then(({ exitCode }) => {
        if (exitCode !== 0) {
          return;
        }
        try {
          if (existsSync(cacheFile) && statSync(cacheFile).size > 4096) {
            this.notifyPreviewProxyReady(sourcePath, cacheFile);
          }
        } catch {
          // ignore
        }
      })
      .catch(() => {
        // ignore — user still has timeline/export
      });
  }

  async resolvePlaybackPath(
    sourcePath: string,
    mediaInfo: EditorMediaInfo,
    settings: AppSettings,
    options?: { backgroundProxy?: boolean },
  ): Promise<EditorPreviewResolution> {
    const backgroundProxy = options?.backgroundProxy !== false;
    if (!mediaInfo.hasVideo) {
      const ext = extname(sourcePath).toLowerCase();
      const ok = AUDIO_PREVIEW_EXTENSIONS.has(ext);
      return {
        playbackPath: sourcePath,
        previewSupported: ok,
        note: ok ? null : 'Preview may not be available for this audio container.',
      };
    }

    const stream = mediaInfo.primaryVideoStream;
    if (!videoNeedsProxy(stream)) {
      return { playbackPath: sourcePath, previewSupported: true, note: null };
    }

    const ffmpegResolved = this.binaryResolver.resolveTool('ffmpeg', settings);
    if (!ffmpegResolved.resolvedPath || !ffmpegResolved.exists) {
      return {
        playbackPath: sourcePath,
        previewSupported: false,
        note: 'FFmpeg is required to preview this codec (e.g. HEVC/H.265). Configure FFmpeg in Settings.',
      };
    }

    const cacheRoot = join(this.pathsService.getPaths().managedDirectories.cache, 'video-preview');
    mkdirSync(cacheRoot, { recursive: true });
    const cacheFile = cachePathForSource(sourcePath, cacheRoot);

    if (existsSync(cacheFile)) {
      try {
        const st = statSync(cacheFile);
        if (st.size > 4096) {
          return { playbackPath: cacheFile, previewSupported: true, note: null };
        }
      } catch {
        // regenerate
      }
    }

    if (backgroundProxy) {
      this.startBackgroundProxyTranscode(sourcePath, mediaInfo, ffmpegResolved.resolvedPath, cacheFile);
      return {
        playbackPath: sourcePath,
        previewSupported: false,
        note: 'Encoding H.264 preview in the background (large files can take several minutes). Timeline, in/out, and export work now — video preview will appear when encoding finishes.',
      };
    }

    const args = buildPreviewTranscodeArgs(sourcePath, mediaInfo, cacheFile);
    const timeoutMs = 6 * 60 * 60 * 1000;

    try {
      const { exitCode, stderrTail } = await runFfmpeg(ffmpegResolved.resolvedPath, args, timeoutMs);
      if (exitCode !== 0) {
        return {
          playbackPath: sourcePath,
          previewSupported: false,
          note: `Preview transcode failed: ${stderrTail.trim().slice(0, 400) || `exit ${exitCode}`}`,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        playbackPath: sourcePath,
        previewSupported: false,
        note: `Preview transcode failed: ${message}`,
      };
    }

    if (!existsSync(cacheFile)) {
      return {
        playbackPath: sourcePath,
        previewSupported: false,
        note: 'Preview transcode finished but output file was missing.',
      };
    }

    return { playbackPath: cacheFile, previewSupported: true, note: null };
  }
}
