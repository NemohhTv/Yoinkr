import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { BrowserWindow, app } from 'electron';
import electronUpdater from 'electron-updater';

import { ipcChannels } from '@shared/contracts/channels';
import type { UpdateStatusPayload } from '@shared/types/update';

/** `electron-updater` is CJS; default import avoids ESM named-export errors in packaged `out/main`. */
const { autoUpdater } = electronUpdater;

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

function isMissingUpdateMetadataError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('ENOENT') && msg.includes('app-update.yml');
}

function normalizeUpdateError(err: unknown): string {
  if (isMissingUpdateMetadataError(err)) {
    return '';
  }
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
 * GitHub Releases + electron-builder: `app-update.yml` lives in `resources` for published installers.
 * Plain `win-unpacked` builds often omit it — skip the updater instead of surfacing ENOENT.
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

  const updateConfigPath = join(process.resourcesPath, 'app-update.yml');
  if (!existsSync(updateConfigPath)) {
    setSnapshot({
      phase: 'disabled',
      disabledReason: 'Unpackaged build',
    });
    updaterEnabled = false;
    return;
  }

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
    if (isMissingUpdateMetadataError(err)) {
      updaterEnabled = false;
      setSnapshot({
        phase: 'disabled',
        disabledReason: 'Unpackaged build',
        error: undefined,
      });
      return;
    }
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
      if (isMissingUpdateMetadataError(err)) {
        updaterEnabled = false;
        setSnapshot({
          phase: 'disabled',
          disabledReason: 'Unpackaged build',
          error: undefined,
        });
        return;
      }
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
