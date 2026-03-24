import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Downloads use `-o <dir>/<downloadId>__%(title)...` so we can find the real file on disk
 * even when stdout path parsing fails (Unicode, merges, or odd yt-dlp output).
 * After success, the file may be renamed to a friendly `Title.ext` (see YtDlpDownloadService).
 */
export function findLatestOutputByDownloadId(downloadDir: string, downloadId: string): string | null {
  if (!downloadId || !existsSync(downloadDir)) {
    return null;
  }
  const prefix = `${downloadId}__`;
  try {
    const names = readdirSync(downloadDir);
    const candidates = names
      .filter((name) => name.startsWith(prefix))
      .map((name) => {
        const full = join(downloadDir, name);
        try {
          const st = statSync(full);
          if (!st.isFile()) {
            return null;
          }
          return { full, mtime: st.mtimeMs };
        } catch {
          return null;
        }
      })
      .filter((x): x is { full: string; mtime: number } => x !== null);
    if (candidates.length === 0) {
      return null;
    }
    candidates.sort((a, b) => b.mtime - a.mtime);
    return candidates[0].full;
  } catch {
    return null;
  }
}
