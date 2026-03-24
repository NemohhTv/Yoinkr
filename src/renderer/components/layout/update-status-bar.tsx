import { useCallback, useEffect, useState } from 'react';

import { yoinkrClient } from '@renderer/lib/api/yoinkr-client';
import type { UpdateStatusPayload } from '@shared/types/update';

const truncateStatus = (text: string, maxLen: number): string => {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxLen) {
    return oneLine;
  }
  return `${oneLine.slice(0, maxLen - 1)}…`;
};

/** Short line for the sidebar strip (no long paths). */
const statusLine = (status: UpdateStatusPayload): string => {
  switch (status.phase) {
    case 'disabled':
      return status.disabledReason ?? '—';
    case 'idle':
      return '…';
    case 'checking':
      return 'Checking…';
    case 'not-available':
      return 'Up to date';
    case 'available':
      return status.availableVersion ? `v${status.availableVersion} ready` : 'Update ready';
    case 'downloading':
      return status.percent != null ? `Downloading ${status.percent}%` : 'Downloading…';
    case 'downloaded':
      return 'Ready to install';
    case 'error':
      return truncateStatus(status.error ?? 'Update error', 80);
    default:
      return '';
  }
};

const statusDetailTitle = (status: UpdateStatusPayload): string | undefined => {
  if (status.phase === 'error' && status.error) {
    return status.error;
  }
  return status.releaseNotes;
};

export const UpdateStatusBar = ({ appVersion }: { appVersion: string }): JSX.Element => {
  const [status, setStatus] = useState<UpdateStatusPayload>({ phase: 'idle' });

  useEffect(() => {
    void yoinkrClient.updates.getStatus().then(setStatus);
    return yoinkrClient.updates.onStatus(setStatus);
  }, []);

  const onCheckUpdates = useCallback(() => {
    void yoinkrClient.updates.checkNow().catch(() => {
      /* autoUpdater `error` event also updates snapshot; avoid unhandled rejection */
    });
  }, []);

  const onDownload = useCallback(() => {
    void yoinkrClient.updates.download().catch(() => {
      /* same — phase may move to `error` via updater event */
    });
  }, []);

  const onInstall = useCallback(() => {
    void yoinkrClient.updates.install().catch(() => {});
  }, []);

  const showDownload = status.phase === 'available';
  const showInstall = status.phase === 'downloaded';
  const showRetry = status.phase === 'error';
  const showCheckUpdates =
    status.phase !== 'disabled' &&
    status.phase !== 'checking' &&
    status.phase !== 'downloading' &&
    status.phase !== 'downloaded' &&
    status.phase !== 'error';

  return (
    <div className="sidebar-update">
      <div className="sidebar-update__version">v{appVersion}</div>
      <div className="sidebar-update__status" title={statusDetailTitle(status)}>
        {statusLine(status)}
      </div>
      <div className="sidebar-update__actions">
        {showCheckUpdates ? (
          <button type="button" className="sidebar-update__btn ghost" onClick={onCheckUpdates}>
            Check updates
          </button>
        ) : null}
        {showDownload ? (
          <button type="button" className="sidebar-update__btn primary" onClick={onDownload}>
            Download
          </button>
        ) : null}
        {showInstall ? (
          <button type="button" className="sidebar-update__btn primary" onClick={onInstall}>
            Install
          </button>
        ) : null}
        {showRetry ? (
          <button type="button" className="sidebar-update__btn ghost" onClick={onCheckUpdates}>
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
};
