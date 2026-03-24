import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { BrowserWindow, app } from 'electron';
import electronUpdater from 'electron-updater';
import type { AppUpdater } from 'electron-updater';

import { ipcChannels } from '@shared/contracts/channels';
import type { UpdateStatusPayload } from '@shared/types/update';

/** `electron-updater` is CJS; default import avoids ESM named-export errors in packaged `out/main`. */
const { autoUpdater } = electronUpdater;

/** Same target as `build.publish` — explicit feed so updates work even without `resources/app-update.yml` (local `npm run dist` often omits that file; CI embeds it). */
const GITHUB_RELEASE_FEED = {
  provider: 'github' as const,
  owner: 'NemohhTv',
  repo: 'Yoinkr',
};

/**
 * electron-updater still reads `app-update.yml` for `updaterCacheDirName` (and optional
 * `publisherName`) when downloading — even if `setFeedURL()` is used for the provider.
 * Installs that omit `resources/app-update.yml` then fail at download with ENOENT; the UI used to
 * hide those errors. We point the updater at a small file under userData instead.
 *
 * Omit `publisherName` so unsigned NSIS builds are not rejected by signature verification.
 */
const LOCAL_UPDATE_YML = `provider: github
owner: ${GITHUB_RELEASE_FEED.owner}
repo: ${GITHUB_RELEASE_FEED.repo}
updaterCacheDirName: yoinkr-updater
`;

function writeLocalUpdaterConfigPath(): string | null {
  try {
    const configPath = join(app.getPath('userData'), 'yoinkr-updater.yml');
    writeFileSync(configPath, LOCAL_UPDATE_YML, 'utf8');
    return configPath;
  } catch (err) {
    console.warn('[Yoinkr] Could not write local updater config:', err);
    return null;
  }
}

let snapshot: UpdateStatusPayload = { phase: 'idle' };
let updaterEnabled = false;

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(ipcChannels.updatesStatus, snapshot);
  }
}

function setSnapshot(patch: Partial<UpdateStatusPayload>): void {
  snapshot = { ...snapshot, ...patch };
  broadcast();
}

function normalizeUpdateError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function normalizeReleaseNotes(notes: unknown): string | undefined {
  if (notes == null) {
    return undefined;
  }
  if (typeof notes === 'string') {
    return notes;
  }
  if (Array.isArray(notes)) {
    return notes
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }
        if (entry && typeof entry === 'object' && 'note' in entry) {
          return String((entry as { note?: string }).note ?? '');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return undefined;
}

export function getUpdateSnapshot(): UpdateStatusPayload {
  return { ...snapshot };
}

export function isUpdaterEnabled(): boolean {
  return updaterEnabled;
}

/**
 * NSIS-installed builds: always set the GitHub feed explicitly so updates work whether or not
 * `app-update.yml` was embedded (CI publishes embed it; local installers from `release/` often do not).
 */
export function initializeAutoUpdater(): void {
  if (!app.isPackaged) {
    setSnapshot({
      phase: 'disabled',
      disabledReason: 'Dev',
    });
    updaterEnabled = false;
    return;
  }

  if (process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE) {
    setSnapshot({
      phase: 'disabled',
      disabledReason: 'Portable',
    });
    updaterEnabled = false;
    return;
  }

  const localConfigPath = writeLocalUpdaterConfigPath();
  if (localConfigPath) {
    (autoUpdater as AppUpdater).updateConfigPath = localConfigPath;
  }
  /** Must run after `updateConfigPath` — that setter clears `clientPromise`. */
  autoUpdater.setFeedURL(GITHUB_RELEASE_FEED);

  updaterEnabled = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    setSnapshot({ phase: 'checking', error: undefined });
  });

  autoUpdater.on('update-available', (info) => {
    setSnapshot({
      phase: 'available',
      availableVersion: info.version,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      percent: undefined,
      downloaded: false,
      error: undefined,
    });
  });

  autoUpdater.on('update-not-available', () => {
    setSnapshot({
      phase: 'not-available',
      error: undefined,
    });
  });

  autoUpdater.on('error', (err) => {
    setSnapshot({
      phase: 'error',
      error: normalizeUpdateError(err) || 'Update error',
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    setSnapshot({
      phase: 'downloading',
      percent: Math.round(progress.percent),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    setSnapshot({
      phase: 'downloaded',
      availableVersion: info.version,
      downloaded: true,
      error: undefined,
    });
  });

  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((err) => {
      const text = normalizeUpdateError(err);
      if (text) {
        setSnapshot({
          phase: 'error',
          error: text,
        });
      }
    });
  }, 400);
}

export async function checkForUpdatesNow(): Promise<void> {
  if (!updaterEnabled) {
    return;
  }
  await autoUpdater.checkForUpdates();
}

export async function downloadUpdate(): Promise<void> {
  if (!updaterEnabled) {
    return;
  }
  await autoUpdater.downloadUpdate();
}

export function quitAndInstall(): void {
  if (!updaterEnabled) {
    return;
  }
  autoUpdater.quitAndInstall(false, true);
}
