import { useCallback, useEffect, useState } from 'react';

import { yoinkrClient } from '@renderer/lib/api/yoinkr-client';
import type { UpdateStatusPayload } from '@shared/types/update';

const labelForPhase = (status: UpdateStatusPayload, currentVersion: string): string => {
  switch (status.phase) {
    case 'disabled':
      return status.disabledReason ?? 'Updates unavailable';
    case 'idle':
      return `v${currentVersion}`;
    case 'checking':
      return `v${currentVersion} · Checking for updates…`;
    case 'not-available':
      return `v${currentVersion} · Up to date`;
    case 'available':
      return status.availableVersion
        ? `v${currentVersion} · v${status.availableVersion} available`
        : `v${currentVersion} · Update available`;
    case 'downloading':
      return `v${currentVersion} · Downloading${status.percent != null ? ` ${status.percent}%` : '…'}`;
    case 'downloaded':
      return `v${currentVersion} · Ready to install v${status.availableVersion ?? ''}`.trim();
    case 'error':
      return `v${currentVersion} · ${status.error ?? 'Update error'}`;
    default:
      return `v${currentVersion}`;
  }
};

export const UpdateStatusBar = ({ appVersion }: { appVersion: string }): JSX.Element => {
  const [status, setStatus] = useState<UpdateStatusPayload>({ phase: 'idle' });

  useEffect(() => {
    void yoinkrClient.updates.getStatus().then(setStatus);
    return yoinkrClient.updates.onStatus(setStatus);
  }, []);

  const onCheck = useCallback(() => {
    void yoinkrClient.updates.checkNow();
  }, []);

  const onDownload = useCallback(() => {
    void yoinkrClient.updates.download();
  }, []);

  const onInstall = useCallback(() => {
    void yoinkrClient.updates.install();
  }, []);

  const showCheck =
    status.phase !== 'disabled' &&
    status.phase !== 'checking' &&
    status.phase !== 'downloading' &&
    status.phase !== 'downloaded';

  const showDownload = status.phase === 'available';
  const showInstall = status.phase === 'downloaded';

  return (
    <div className="update-status-bar">
      <span className="update-status-bar__text" title={status.releaseNotes}>
        {labelForPhase(status, appVersion)}
      </span>
      <span className="update-status-bar__actions">
        {showCheck ? (
          <button type="button" className="button compact ghost update-status-bar__btn" onClick={onCheck}>
            Check updates
          </button>
        ) : null}
        {showDownload ? (
          <button type="button" className="button compact primary update-status-bar__btn" onClick={onDownload}>
            Download
          </button>
        ) : null}
        {showInstall ? (
          <button type="button" className="button compact primary update-status-bar__btn" onClick={onInstall}>
            Restart &amp; install
          </button>
        ) : null}
      </span>
    </div>
  );
};
