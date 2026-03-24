/**
 * Import this first from main `index.ts` so failures loading native modules (e.g. better-sqlite3)
 * still log + show an error box instead of a silent exit.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { dialog } from 'electron';

import { APP_NAME } from '@shared/constants/app';

/** Easiest to find: Run dialog Win+R → %APPDATA%\Yoinkr\logs */
export function resolvePersistentStartupLogPath(): string {
  if (process.platform === 'win32') {
    const roaming = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    return join(roaming, APP_NAME, 'logs', 'startup-error.log');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Logs', APP_NAME, 'startup-error.log');
  }
  return join(homedir(), '.local', 'share', APP_NAME, 'logs', 'startup-error.log');
}

/** Backup if roaming is weird / locked */
export const STARTUP_ERROR_LOG_TEMP = join(tmpdir(), 'yoinkr-startup-error.log');

/** Primary path we tell users about */
export const STARTUP_ERROR_LOG = resolvePersistentStartupLogPath();

export const STARTUP_LOG_LOCATIONS_MESSAGE = `Main log (open File Explorer, paste in address bar):
%APPDATA%\\${APP_NAME}\\logs\\startup-error.log

Full path:
${STARTUP_ERROR_LOG}

Backup copy:
${STARTUP_ERROR_LOG_TEMP}`;

const logTargets = (): string[] => [STARTUP_ERROR_LOG, STARTUP_ERROR_LOG_TEMP];

export const appendStartupLog = (body: string): void => {
  const line = `[${new Date().toISOString()}]\n${body}\n\n`;
  for (const targetPath of logTargets()) {
    try {
      mkdirSync(dirname(targetPath), { recursive: true });
      appendFileSync(targetPath, line, 'utf8');
    } catch {
      // ignore
    }
  }
};

const log = (err: unknown): void => {
  const text = err instanceof Error ? `${err.stack ?? err.message}` : String(err);
  appendStartupLog(text);
};

process.on('uncaughtException', (error) => {
  log(error);
  try {
    dialog.showErrorBox(
      'Yoinkr failed to start',
      `A fatal error occurred.\n\n${STARTUP_LOG_LOCATIONS_MESSAGE}\n\n---\n${String(error).slice(0, 500)}`,
    );
  } catch {
    // ignore
  }
  process.exit(1);
});

/**
 * Do NOT call process.exit() here. Electron/Chromium often surfaces benign
 * unhandled rejections during dev (and sometimes in prod); exiting would
 * close the app immediately with no window — exactly what users see as "dev won't open".
 */
process.on('unhandledRejection', (reason) => {
  appendStartupLog(`[unhandledRejection] ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
  // eslint-disable-next-line no-console
  console.error('[Yoinkr] Unhandled promise rejection (logged, app continues):', reason);
});
