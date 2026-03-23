import { useNavigate } from 'react-router-dom';

import type { AudioPreference, DownloadDraft } from '@shared/types/downloader';
import type { EditorOpenRequest } from '@shared/types/editor';

import type { useDownloaderController } from './use-downloader-controller';

type DownloaderController = ReturnType<typeof useDownloaderController>;

export const DownloaderScreen = ({ controller }: { controller: DownloaderController }): JSX.Element => {
  const {
    form,
    validation,
    activeValidation,
    derivedResolutions,
    queueItems,
    queueSummary,
    isLoadingMetadata,
    error,
    activityMessage,
  } = controller;

  const navigate = useNavigate();

  return (
    <div className="dl-page">
      {/* ─── Top URL Bar ─── */}
      <div className="dl-url-bar">
        <input
          className="dl-url-input"
          value={form.urlInput}
          onChange={(e) => controller.updateField('urlInput', e.target.value)}
          placeholder="Insert a URL to download..."
          onKeyDown={(e) => {
            if (e.key === 'Enter') void controller.enqueueDraft();
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            void controller.pasteFromClipboard();
          }}
        />
        <button className="dl-btn dl-btn-primary" onClick={() => void controller.enqueueDraft()} disabled={isLoadingMetadata}>
          {isLoadingMetadata ? 'Loading...' : 'Add'}
        </button>
        <button
          className="dl-btn dl-btn-icon"
          onClick={() => navigate('/settings')}
          title="Settings"
        >
          ⚙
        </button>
      </div>

      {/* ─── Notices ─── */}
      {error && <div className="dl-notice dl-notice-danger">{error}</div>}
      {activityMessage && !error && <div className="dl-notice dl-notice-info">{activityMessage}</div>}

      {validation.length > 0 && (
        <div className="dl-validation-strip">
          {validation.map((item) => (
            <button
              key={`${item.normalizedUrl}-${item.input}`}
              className={`dl-validation-pill ${item.isValid ? 'valid' : 'invalid'} ${activeValidation?.normalizedUrl === item.normalizedUrl ? 'active' : ''}`}
              onClick={() => item.isValid && controller.selectActiveValidation(item.normalizedUrl)}
              disabled={!item.isValid}
              title={item.isValid ? item.normalizedUrl : item.reason}
            >
              <strong>{item.isValid ? 'Ready' : 'Check'}</strong>
              <span>{item.isValid ? new URL(item.normalizedUrl).hostname.replace(/^www\./, '') : item.reason}</span>
            </button>
          ))}
        </div>
      )}

      {/* ─── Unified Item List ─── */}
      <div className="dl-item-list">
        {queueItems.length === 0 ? (
          <div className="dl-item-empty">
            {isLoadingMetadata
              ? 'Fetching metadata...'
              : <>Enter a URL above and click <strong>Add</strong> to start downloading.</>
            }
          </div>
        ) : (
          queueItems.map((item) => {
            const isActive = item.status === 'downloading' || item.status === 'merging' || item.status === 'converting';
            const fileTypes =
              item.mediaType === 'audio-only'
                ? (['mp3', 'm4a', 'wav', 'flac'] as const)
                : (['mp4', 'mkv', 'webm', 'original'] as const);

            return (
              <div key={item.id} className={`dl-item-row ${item.status === 'complete' ? 'dl-item-row-complete' : ''} ${item.status === 'error' ? 'dl-item-row-error' : ''}`}>
                <img className="dl-item-thumb" src={item.thumbnailUrl} alt={item.title} />

                <div className="dl-item-body">
                  <div className="dl-item-head">
                    <h3>{item.title}</h3>
                    <span className="dl-item-subhead">{item.extractor} · {item.durationText}</span>
                  </div>

                  <div className="dl-item-controls">
                    <select className="dl-select" value={item.mediaType} disabled={isActive || item.status === 'complete'} onChange={(e) => controller.updateQueueItem(item.id, { mediaType: e.target.value as typeof item.mediaType })}>
                      <option value="video-audio">Video + Audio</option>
                      <option value="video-only">Video</option>
                      <option value="audio-only">Audio</option>
                    </select>
                    <select className="dl-select" value={item.qualityTarget} disabled={isActive || item.status === 'complete' || item.mediaType === 'audio-only'} onChange={(e) => controller.updateQueueItem(item.id, { qualityTarget: e.target.value as DownloadDraft['qualityTarget'] })}>
                      <option value="best">Best</option>
                      {derivedResolutions.map((r) => (
                        <option key={r.label} value={r.qualityTarget}>{r.label}</option>
                      ))}
                    </select>
                    <select className="dl-select" value={item.fileType} disabled={isActive || item.status === 'complete'} onChange={(e) => controller.updateQueueItem(item.id, { fileType: e.target.value as typeof item.fileType })}>
                      {fileTypes.map((ft) => (<option key={ft} value={ft}>{ft.toUpperCase()}</option>))}
                    </select>
                    {item.mediaType !== 'audio-only' && (
                      <select className="dl-select" value={item.audioPreference} disabled={isActive || item.status === 'complete'} onChange={(e) => controller.updateQueueItem(item.id, { audioPreference: e.target.value as AudioPreference })}>
                        <option value="best">Audio: Best</option>
                        <option value="aac">AAC</option>
                        <option value="opus">Opus</option>
                      </select>
                    )}
                    <span className="dl-item-size">{item.sizeText}</span>
                  </div>

                  {isActive && (
                    <div className="dl-item-progress">
                      <div className="dl-item-progress-track">
                        <div className="dl-item-progress-fill" style={{ width: `${Math.max(2, item.progressPercent)}%` }} />
                      </div>
                      <span className="dl-item-progress-label">{item.progressMessage}</span>
                    </div>
                  )}

                  {item.status === 'complete' && <span className="dl-item-complete-label">Download complete</span>}
                  {item.status === 'error' && <span className="dl-item-error-label">{item.progressMessage || 'Download failed'}</span>}
                </div>

                <div className="dl-item-actions">
                  {isActive ? (
                    <button className="dl-item-action-btn dl-item-action-cancel" onClick={() => void controller.cancelItem(item.id)} title="Cancel download">■</button>
                  ) : (
                    <button
                      className={`dl-item-action-btn ${item.status === 'staged' || item.status === 'error' ? 'dl-item-action-download' : ''}`}
                      onClick={() => void controller.downloadItem(item.id)}
                      title="Download"
                      disabled={item.status === 'complete'}
                    >
                      {item.status === 'complete' ? '✓' : '↓'}
                    </button>
                  )}
                  {item.status === 'complete' && item.outputPath && (
                    <button className="dl-item-action-btn" onClick={() => void controller.revealFile(item.outputPath!)} title="Open file location">📂</button>
                  )}
                  {item.status === 'complete' && (
                    <button
                      className="dl-item-action-btn"
                      onClick={() => {
                        if (!item.outputPath) {
                          return;
                        }
                        const request: EditorOpenRequest = {
                          sourcePath: item.outputPath,
                          sourceKind: 'download',
                          downloadId: item.id,
                          titleHint: item.title,
                          sourceUrl: item.sourceUrl,
                          autoLoad: true,
                        };
                        navigate('/editor', { state: request });
                      }}
                      title="Open in editor"
                      disabled={!item.outputPath}
                    >
                      ✎
                    </button>
                  )}
                  <button
                    className="dl-item-action-btn"
                    onClick={() => { if (item.sourceUrl) window.open(item.sourceUrl); }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (item.sourceUrl) {
                        navigator.clipboard.writeText(item.sourceUrl);
                        controller.triggerPlaceholderAction('Link copied to clipboard.');
                      }
                    }}
                    title="Click to open · Right-click to copy URL"
                  >↗</button>
                  <button className="dl-item-action-btn" onClick={() => controller.removeQueueItem(item.id)} title="Remove" disabled={isActive}>✕</button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ─── Bottom Bar ─── */}
      {queueItems.length > 0 && (
        <div className="dl-bottom-bar">
          <div className="dl-bottom-status">
            {queueSummary.complete > 0 && <span>{queueSummary.complete} done</span>}
            {queueSummary.active > 0 && <span>{queueSummary.active} downloading</span>}
            {queueSummary.pending > 0 && <span>{queueSummary.pending} pending</span>}
            {queueSummary.pending === 0 && queueSummary.active === 0 && queueSummary.complete > 0 && (
              <span>All downloads complete</span>
            )}
          </div>
          <div className="dl-bottom-actions">
            <button className="dl-btn dl-btn-secondary" onClick={() => controller.triggerPlaceholderAction('Queue cleared.')} title="Clear queue">Clear</button>
            {queueSummary.pending > 0 && (
              <button className="dl-btn dl-btn-download" onClick={() => { queueItems.filter((i) => i.status === 'staged' || i.status === 'error').forEach((i) => void controller.downloadItem(i.id)); }}>
                Download{queueSummary.pending > 1 ? ` All (${queueSummary.pending})` : ''}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
