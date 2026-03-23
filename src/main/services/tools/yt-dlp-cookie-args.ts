import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AppPathsService } from '@main/services/paths/app-paths-service';

import type { AppSettings } from '@shared/types/settings';

const PASTED_COOKIES_FILENAME = 'pasted-cookies.txt';

export interface PreparedYtDlpCookieSource {
  args: string[];
  mode: AppSettings['ytDlpCookieMode'];
  sourcePath: string | null;
  summary: string;
  warnings: string[];
}

/**
 * Stable fingerprint for metadata cache invalidation when cookie auth changes.
 */
export function getYtDlpCookieCacheFingerprint(settings: AppSettings): string {
  switch (settings.ytDlpCookieMode) {
    case 'none':
      return 'none';
    case 'browser': {
      const prof = settings.ytDlpBrowserProfile.trim();
      return prof ? `browser:${settings.preferredBrowser}:${prof}` : `browser:${settings.preferredBrowser}`;
    }
    case 'file':
      return `file:${settings.ytDlpCookiesFilePath.trim()}`;
    case 'paste':
      return `paste:${hashText(settings.ytDlpCookiesPastedText ?? '')}`;
    default:
      return 'none';
  }
}

/**
 * Build yt-dlp args for cookie auth.
 *
 * KEY DESIGN: For file mode we pass the ORIGINAL file path straight to yt-dlp
 * without reading, normalizing, or caching it ourselves.  yt-dlp handles
 * Netscape cookie files natively and our previous normalization was corrupting
 * cookie data.  This matches how Parabolic passes cookies.
 *
 * For paste mode we still need to write text to a temp file since yt-dlp only
 * accepts a path.  We write the raw text without modification.
 */
export function buildYtDlpCookieArgs(settings: AppSettings, pathsService: AppPathsService): string[] {
  return prepareYtDlpCookieSource(settings, pathsService).args;
}

export function prepareYtDlpCookieSource(
  settings: AppSettings,
  pathsService: AppPathsService,
): PreparedYtDlpCookieSource {
  if (settings.ytDlpCookieMode === 'paste') {
    const rawText = (settings.ytDlpCookiesPastedText ?? '').trim();
    if (!rawText) {
      return {
        args: [],
        mode: 'paste',
        sourcePath: null,
        summary: 'Paste mode is selected, but no cookie text is present.',
        warnings: ['Paste the full Netscape cookies.txt export before testing or downloading.'],
      };
    }
    const filePath = writePastedCookiesFile(pathsService, rawText);
    return {
      args: ['--cookies', filePath],
      mode: 'paste',
      sourcePath: filePath,
      summary: 'Pasted cookies written to temp file for yt-dlp.',
      warnings: [],
    };
  }

  if (settings.ytDlpCookieMode === 'file') {
    const filePath = settings.ytDlpCookiesFilePath.trim();
    if (!filePath) {
      return {
        args: [],
        mode: 'file',
        sourcePath: null,
        summary: 'Cookie file mode is selected, but no file path is set.',
        warnings: ['Choose a valid Netscape cookies.txt export before testing or downloading.'],
      };
    }
    if (!existsSync(filePath)) {
      return {
        args: [],
        mode: 'file',
        sourcePath: null,
        summary: `Cookie file was not found: ${filePath}`,
        warnings: ['Choose a valid Netscape cookies.txt export before testing or downloading.'],
      };
    }
    return {
      args: ['--cookies', filePath],
      mode: 'file',
      sourcePath: filePath,
      summary: `Cookies file: ${filePath}`,
      warnings: [],
    };
  }

  if (settings.ytDlpCookieMode === 'browser') {
    const spec = buildCookiesFromBrowserSpec(settings);
    return {
      args: ['--cookies-from-browser', spec],
      mode: 'browser',
      sourcePath: null,
      summary: `Browser cookies via ${spec}.`,
      warnings: [],
    };
  }

  return {
    args: [],
    mode: 'none',
    sourcePath: null,
    summary: 'Cookie auth is disabled.',
    warnings: [],
  };
}

function mapPreferredBrowserToYtDlp(preferred: AppSettings['preferredBrowser']): string {
  const map: Record<AppSettings['preferredBrowser'], string> = {
    edge: 'edge',
    chrome: 'chrome',
    firefox: 'firefox',
  };
  return map[preferred];
}

function buildCookiesFromBrowserSpec(settings: AppSettings): string {
  const browser = mapPreferredBrowserToYtDlp(settings.preferredBrowser);
  const profile = settings.ytDlpBrowserProfile.trim();
  if (!profile) {
    return browser;
  }
  return `${browser}:${profile}`;
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function writePastedCookiesFile(pathsService: AppPathsService, rawText: string): string {
  const cacheDir = join(pathsService.getPaths().userDataRoot, 'cache');
  mkdirSync(cacheDir, { recursive: true });
  const filePath = join(cacheDir, PASTED_COOKIES_FILENAME);
  writeFileSync(filePath, rawText, 'utf8');
  return filePath;
}
