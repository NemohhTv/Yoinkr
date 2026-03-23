import type { AppPathsService } from '@main/services/paths/app-paths-service';
import type { ProcessRunner } from '@main/services/shared/process-runner';
import { ServiceError } from '@main/services/shared/service-error';
import type {
  DownloadFormatOption,
  DownloadMetadata,
  DownloadUrlValidation,
} from '@shared/types/downloader';
import type { AppSettings } from '@shared/types/settings';

import { BinaryResolver } from './binary-resolver';
import { buildYtDlpCookieArgs, getYtDlpCookieCacheFingerprint } from './yt-dlp-cookie-args';
import type { MetadataCache } from './metadata-cache';

interface YtDlpChapter {
  title?: string;
}

interface YtDlpFormat {
  format_id?: string;
  format?: string;
  format_note?: string;
  ext?: string;
  protocol?: string;
  width?: number;
  height?: number;
  resolution?: string;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  dynamic_range?: string;
  filesize?: number;
  filesize_approx?: number;
  source_preference?: number;
}

interface YtDlpMetadataResponse {
  title?: string;
  uploader?: string;
  channel?: string;
  thumbnail?: string;
  duration?: number;
  upload_date?: string;
  extractor?: string;
  extractor_key?: string;
  webpage_url?: string;
  subtitles?: Record<string, unknown>;
  automatic_captions?: Record<string, unknown>;
  chapters?: YtDlpChapter[];
  formats?: YtDlpFormat[];
  is_live?: boolean;
}

export class YtDlpMetadataService {
  constructor(
    private readonly processRunner: ProcessRunner,
    private readonly binaryResolver: BinaryResolver,
    private readonly metadataCache: MetadataCache,
    private readonly pathsService: AppPathsService,
  ) {}

  validateUrls(input: string): DownloadUrlValidation[] {
    return input
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => {
        try {
          const normalizedUrl = this.normalizeAbsoluteUrl(value);
          return {
            input: value,
            normalizedUrl,
            isValid: true,
          } satisfies DownloadUrlValidation;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Enter a valid absolute URL to continue.';
          return {
            input: value,
            normalizedUrl: value,
            isValid: false,
            errorCode: 'INVALID_URL',
            reason: message,
          } satisfies DownloadUrlValidation;
        }
      });
  }

  async getMetadata(url: string, settings: AppSettings): Promise<DownloadMetadata> {
    const normalizedUrl = this.normalizeAbsoluteUrl(url);
    const cacheKey = `${normalizedUrl}::${getYtDlpCookieCacheFingerprint(settings)}`;
    const cached = this.metadataCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const ytDlpBinary = this.binaryResolver.resolveTool('yt-dlp', settings);
    if (!ytDlpBinary.resolvedPath || !ytDlpBinary.exists) {
      throw new ServiceError(
        'TOOL_MISSING',
        '`yt-dlp` is not available. Check Settings > Tool configuration.',
      );
    }

    const cookieArgs = buildYtDlpCookieArgs(settings, this.pathsService);
    const result = await this.processRunner.run({
      command: ytDlpBinary.resolvedPath,
      args: [
        '--ignore-config',
        '--js-runtimes', 'node',
        ...cookieArgs,
        '--dump-single-json',
        '--no-playlist',
        '--no-warnings',
        '--skip-download',
        normalizedUrl,
      ],
      timeoutMs: 30000,
      maxBufferBytes: 8 * 1024 * 1024,
    });

    if (result.exitCode !== 0) {
      throw this.toMetadataError(result.stderr || result.stdout);
    }

    let payload: YtDlpMetadataResponse;
    try {
      payload = JSON.parse(result.stdout) as YtDlpMetadataResponse;
    } catch (error) {
      throw new ServiceError(
        'METADATA_PARSE_FAILED',
        'Yoinkr could not parse the metadata returned by `yt-dlp`.',
        error instanceof Error ? error.message : undefined,
      );
    }

    const metadata = this.normalizeMetadata(payload, normalizedUrl);
    this.metadataCache.set(cacheKey, metadata);
    return metadata;
  }

  /**
   * Quick validation that the cookie source resolves to usable yt-dlp args.
   * Does NOT perform a network probe -- just checks that the file exists / text is present.
   */
  async testCookies(settings: AppSettings): Promise<{ ok: boolean; message: string }> {
    if (settings.ytDlpCookieMode === 'none') {
      return {
        ok: false,
        message: 'Cookie mode is off. Set it to Browser, Cookies file, or Paste text, then try again.',
      };
    }

    const cookieArgs = buildYtDlpCookieArgs(settings, this.pathsService);
    if (cookieArgs.length === 0) {
      if (settings.ytDlpCookieMode === 'file') {
        const p = settings.ytDlpCookiesFilePath.trim();
        return { ok: false, message: p ? `Cookie file not found: ${p}` : 'Choose a cookies.txt file path.' };
      }
      if (settings.ytDlpCookieMode === 'paste') {
        return { ok: false, message: 'Paste Netscape-format cookie text before validating.' };
      }
      return { ok: false, message: 'Cookie source could not be prepared.' };
    }

    const description = settings.ytDlpCookieMode === 'browser'
      ? `Browser: ${settings.preferredBrowser}${settings.ytDlpBrowserProfile.trim() ? `:${settings.ytDlpBrowserProfile.trim()}` : ''}`
      : `Cookie file: ${cookieArgs[cookieArgs.indexOf('--cookies') + 1]}`;

    return {
      ok: true,
      message: `${description}\n\nYoinkr will pass this directly to yt-dlp for inspect and download.`,
    };
  }

  private normalizeAbsoluteUrl(input: string): string {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new ServiceError('INVALID_URL', 'Enter a valid http or https URL to continue.');
    }

    return url.toString();
  }

  private toMetadataError(output: string): ServiceError {
    const text = output.toLowerCase();

    if (text.includes('unsupported url') || text.includes('no suitable extractor')) {
      return new ServiceError(
        'UNSUPPORTED_URL',
        'This URL is not supported by the installed `yt-dlp` extractor set.',
        output,
      );
    }

    if (
      text.includes('login required')
      || text.includes('sign in')
      || text.includes('private video')
      || text.includes('members-only')
      || text.includes('age-restricted')
      || text.includes('cookies')
      || text.includes('authentication')
    ) {
      return new ServiceError(
        'AUTH_REQUIRED',
        'This media appears to require your own authorized session or cookies.',
        output,
      );
    }

    return new ServiceError('YT_DLP_FAILED', 'Unable to inspect media with `yt-dlp`.', output);
  }

  private normalizeMetadata(payload: YtDlpMetadataResponse, normalizedUrl: string): DownloadMetadata {
    const availableFormats = this.normalizeFormats(payload.formats ?? []);

    return {
      sourceUrl: normalizedUrl,
      normalizedUrl,
      title: payload.title?.trim() || 'Untitled media',
      uploader: payload.uploader?.trim() || 'Unknown uploader',
      channel: payload.channel?.trim() || payload.uploader?.trim() || 'Unknown channel',
      thumbnailUrl: payload.thumbnail?.trim() || '',
      durationSeconds: payload.duration ?? null,
      durationText: formatDuration(payload.duration ?? null),
      uploadDate: formatUploadDate(payload.upload_date),
      extractor: payload.extractor?.trim() || new URL(normalizedUrl).hostname.replace(/^www\./, ''),
      extractorKey: payload.extractor_key?.trim() || '',
      webpageUrl: payload.webpage_url?.trim() || normalizedUrl,
      siteWarning: payload.is_live ? 'Live media may have limited format details.' : '',
      availableFormats,
      audioOnlyAvailable: availableFormats.some((format) => format.audioOnly),
      videoOnlyAvailable: availableFormats.some((format) => format.videoOnly),
      subtitles: uniqueKeys([payload.subtitles, payload.automatic_captions]),
      chapters: (payload.chapters ?? [])
        .map((chapter) => chapter.title?.trim())
        .filter((title): title is string => Boolean(title)),
    };
  }

  private normalizeFormats(formats: YtDlpFormat[]): DownloadFormatOption[] {
    return formats
      .map((format, index) => {
        const formatId = format.format_id?.trim() || `format-${index}`;
        const ext = format.ext?.trim() || null;
        const hasVideo = Boolean(format.vcodec && format.vcodec !== 'none');
        const hasAudio = Boolean(format.acodec && format.acodec !== 'none');
        const audioOnly = hasAudio && !hasVideo;
        const videoOnly = hasVideo && !hasAudio;
        const resolutionLabel = getResolutionLabel(format, audioOnly);
        const estimatedSizeText = formatBytes(format.filesize ?? format.filesize_approx ?? null);

        return {
          id: `${formatId}-${ext ?? 'unknown'}-${index}`,
          formatId,
          label: getFormatLabel({
            ext,
            resolutionLabel,
            hasVideo,
            hasAudio,
            audioOnly,
            videoOnly,
          }),
          formatNote: format.format_note?.trim() || null,
          ext,
          container: ext,
          protocol: format.protocol?.trim() || null,
          width: format.width ?? null,
          height: format.height ?? null,
          resolutionLabel,
          fps: format.fps ?? null,
          videoCodec: format.vcodec?.trim() || null,
          audioCodec: format.acodec?.trim() || null,
          hasVideo,
          hasAudio,
          audioOnly,
          videoOnly,
          dynamicRange: format.dynamic_range?.trim() || null,
          filesizeBytes: format.filesize ?? null,
          filesizeApproxBytes: format.filesize_approx ?? null,
          estimatedSizeText,
          sourcePreference: format.source_preference ?? null,
          sortKey: [
            audioOnly ? 'audio' : videoOnly ? 'video-only' : hasVideo && hasAudio ? 'muxed' : 'other',
            String(format.height ?? 0).padStart(5, '0'),
            String(format.fps ?? 0).padStart(4, '0'),
            formatId,
          ].join(':'),
        } satisfies DownloadFormatOption;
      })
      .filter((format) => format.hasVideo || format.hasAudio)
      .sort((left, right) => right.sortKey.localeCompare(left.sortKey));
  }
}

const uniqueKeys = (collections: Array<Record<string, unknown> | undefined>): string[] =>
  [...new Set(collections.flatMap((collection) => Object.keys(collection ?? {})))];

const formatUploadDate = (value?: string): string => {
  if (!value) {
    return '';
  }

  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }

  return value;
};

const formatDuration = (seconds: number | null): string => {
  if (seconds == null || Number.isNaN(seconds)) {
    return 'Unknown';
  }

  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainingSeconds = wholeSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, remainingSeconds].map((value, index) => (index === 0 ? String(value) : String(value).padStart(2, '0'))).join(':');
  }

  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
};

const formatBytes = (bytes: number | null): string => {
  if (bytes == null || Number.isNaN(bytes) || bytes <= 0) {
    return 'Unknown';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const precision = size >= 100 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
};

const getResolutionLabel = (format: YtDlpFormat, audioOnly: boolean): string => {
  if (audioOnly) {
    return 'audio only';
  }

  if (format.height) {
    return `${format.height}p`;
  }

  if (format.width && format.height) {
    return `${format.width}x${format.height}`;
  }

  return format.resolution?.trim() || format.format_note?.trim() || 'Unknown';
};

const getFormatLabel = ({
  ext,
  resolutionLabel,
  hasVideo,
  hasAudio,
  audioOnly,
  videoOnly,
}: {
  ext: string | null;
  resolutionLabel: string;
  hasVideo: boolean;
  hasAudio: boolean;
  audioOnly: boolean;
  videoOnly: boolean;
}): string => {
  const extensionLabel = ext?.toUpperCase() ?? 'Unknown';

  if (audioOnly) {
    return `${extensionLabel} audio`;
  }

  if (videoOnly) {
    return `${resolutionLabel} video only`;
  }

  if (hasVideo && hasAudio) {
    return `${resolutionLabel} ${extensionLabel}`;
  }

  return extensionLabel;
};
