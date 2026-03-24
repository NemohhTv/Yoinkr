import { useNavigate } from 'react-router-dom';

import type { AudioPreference, DownloadDraft } from '@shared/types/downloader';
import type { EditorOpenRequest } from '@shared/types/editor';

import { DownloadSectionTimeline } from './download-section-timeline';
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
    sectionTimelineOpenId,
    toggleSectionTimeline,
    updateQueueItem,
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
        <button
          className="dl-btn dl-btn-primary"
          type="button"
          onClick={() => void controller.enqueueDraft()}
          disabled={isLoadingMetadata}
        >
          {isLoadingMetadata ? 'Loading…' : 'Add'}
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
              : (
                <span className="dl-item-empty-hint">
                  Enter a URL above, then click{' '}
                  <span className="dl-item-empty-add">Add</span>
                  {' '}
                  to start downloading.
                </span>
              )}
          </div>
        ) : (
          queueItems.map((item) => {
            const isActive = item.status === 'downloading' || item.status === 'merging' || item.status === 'converting';
            const isPostDownload = item.status === 'merging' || item.status === 'converting';
            const fileTypes =
              item.mediaType === 'audio-only'
                ? (['mp3', 'm4a', 'wav', 'flac'] as const)
                : (['mp4', 'mkv', 'webm', 'original'] as const);

            const canSection =
              item.durationSeconds != null && item.durationSeconds > 0;
            const sectionTimelineOpen = sectionTimelineOpenId === item.id;

            const downloadPct = Math.min(100, Math.max(0, item.progressPercent));
            const progressMsgRaw = (item.progressMessage ?? '').trim();
            const hideProgressDetail =
              !progressMsgRaw ||
              /^Starting\b/i.test(progressMsgRaw) ||
              /^Downloading( clip)?\.\.\.?\s*$/i.test(progressMsgRaw) ||
              // Same % as bold line; message often repeats yt-dlp's string (e.g. 64.7% vs rounded 65%)
              /^(Download|Clip):\s*\d+(\.\d+)?%\s*$/i.test(progressMsgRaw);

            return (
              <div
                key={item.id}
                className={`dl-item-row-wrap ${item.status === 'complete' ? 'dl-item-row-wrap-complete' : ''} ${item.status === 'error' ? 'dl-item-row-wrap-error' : ''}`}
              >
                <div className="dl-item-row">
                  <button
                    type="button"
                    className={`dl-item-thumb-btn ${sectionTimelineOpen ? 'dl-item-thumb-btn-active' : ''}`}
                    disabled={!canSection || isActive}
                    onClick={() => toggleSectionTimeline(item.id)}
                    title={
                      !canSection
                        ? 'Duration unknown — full video only'
                        : sectionTimelineOpen
                          ? 'Hide download section'
                          : 'Choose download section (click to show timeline)'
                    }
                  >
                    <img className="dl-item-thumb" src={item.thumbnailUrl} alt="" />
                  </button>

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
                        <option key={`${r.height}-${r.fps}`} value={r.qualityTarget}>{r.label}</option>
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
                      <div
                        className={`dl-item-progress-track${isPostDownload ? ' dl-item-progress-track--busy' : ''}`}
                      >
                        {isPostDownload ? (
                          <div className="dl-item-progress-fill dl-item-progress-fill--busy" />
                        ) : (
                          <div className="dl-item-progress-fill" style={{ width: `${Math.max(2, downloadPct)}%` }} />
                        )}
                      </div>
                      <span className="dl-item-progress-label">
                        <span className="dl-item-progress-pct">
                          {isPostDownload
                            ? item.status === 'converting'
                              ? 'Encoding…'
                              : 'Merging…'
                            : `Download: ${downloadPct.toFixed(1)}%`}
                        </span>
                        {!hideProgressDetail && (
                          <span className="dl-item-progress-detail"> · {progressMsgRaw}</span>
                        )}
                      </span>
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
                      className={`dl-item-action-btn ${item.status === 'staged' || item.status === 'error' || item.status === 'complete' ? 'dl-item-action-download' : ''}`}
                      onClick={() => void controller.downloadItem(item.id)}
                      title={item.status === 'complete' ? 'Download again' : 'Download'}
                      type="button"
                    >
                      {item.status === 'complete' ? '↻' : '↓'}
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

                {sectionTimelineOpen && canSection && (
                  <DownloadSectionTimeline
                    durationSec={item.durationSeconds!}
                    startSec={item.clipStartSec}
                    endSec={item.clipEndSec}
                    disabled={isActive}
                    onChange={(start, end) => updateQueueItem(item.id, { clipStartSec: start, clipEndSec: end })}
                  />
                )}
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
