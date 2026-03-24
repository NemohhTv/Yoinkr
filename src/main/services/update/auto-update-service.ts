import { BrowserWindow, app } from 'electron';
import { autoUpdater } from 'electron-updater';

import { ipcChannels } from '@shared/contracts/channels';
import type { UpdateStatusPayload } from '@shared/types/update';

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
 * GitHub Releases + electron-builder: `latest.yml` and installers are published next to each other.
 * Only the NSIS-installed build checks for updates; portable builds skip (no stable install path).
 */
export function initializeAutoUpdater(): void {
  if (!app.isPackaged) {
    setSnapshot({
      phase: 'disabled',
      disabledReason: 'Updates run in installed builds only (not dev).',
    });
    updaterEnabled = false;
    return;
  }

  if (process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE) {
    setSnapshot({
      phase: 'disabled',
      disabledReason: 'Portable build — use the NSIS installer for automatic updates.',
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
    setSnapshot({
      phase: 'error',
      error: err instanceof Error ? err.message : String(err),
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
      setSnapshot({
        phase: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, 4000);
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
