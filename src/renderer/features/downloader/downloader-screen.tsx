import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { DownloadDraft } from '@shared/types/downloader';

import type { useDownloaderController } from './use-downloader-controller';

type DownloaderController = ReturnType<typeof useDownloaderController>;

export const DownloaderScreen = ({ controller }: { controller: DownloaderController }): JSX.Element => {
  const {
    form,
    validation,
    activeValidation,
    metadata,
    activeMetadataFormats,
    availableFileTypes,
    queueItems,
    queueSummary,
    historyItems,
    isLoadingMetadata,
    error,
    activityMessage,
  } = controller;

  const [historyOpen, setHistoryOpen] = useState(true);
  const navigate = useNavigate();

  return (
    <div className="dl-page">
      {/* ─── Top URL Bar ─── */}
      <div className="dl-url-bar">
        <input
          className="dl-url-input"
          value={form.urlInput}
          onChange={(e) => controller.updateField('urlInput', e.target.value)}
          placeholder="https://youtu.be/BO8lX3hDU30"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void controller.inspectUrl();
          }}
        />
        <button className="dl-btn dl-btn-secondary" onClick={() => void controller.inspectUrl()}>
          {isLoadingMetadata ? 'Inspecting...' : 'Inspect'}
        </button>
        <button className="dl-btn dl-btn-primary" onClick={() => void controller.enqueueDraft()}>
          Add
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

      <section className="dl-preview-panel">
        {isLoadingMetadata ? (
          <div className="dl-preview-empty">
            <strong>Inspecting media...</strong>
            <span>Yoinkr is reading live metadata and format details from `yt-dlp`.</span>
          </div>
        ) : metadata ? (
          <div className="dl-preview-grid">
            <img className="dl-preview-thumb" src={metadata.thumbnailUrl || 'https://placehold.co/320x180/111827/FFFFFF?text=Preview'} alt={metadata.title} />
            <div className="dl-preview-meta">
              <div className="dl-preview-head">
                <div>
                  <h3>{metadata.title}</h3>
                  <p className="dl-preview-subhead">
                    {metadata.extractor} · {metadata.channel || metadata.uploader} · {metadata.durationText || 'Unknown duration'}
                  </p>
                </div>
                <button
                  className="dl-history-action dl-history-action-link"
                  onClick={() => window.open(metadata.webpageUrl)}
                  title="Open source URL"
                >
                  ↗
                </button>
              </div>

              <div className="dl-preview-details">
                <span>Uploader: {metadata.uploader}</span>
                <span>Upload date: {metadata.uploadDate || 'Unknown'}</span>
                <span>Formats: {metadata.availableFormats.length}</span>
                <span>Subtitles: {metadata.subtitles.length}</span>
              </div>

              {metadata.siteWarning ? <div className="dl-preview-warning">{metadata.siteWarning}</div> : null}

              <div className="dl-preview-formats">
                {activeMetadataFormats.slice(0, 8).map((format) => (
                  <button
                    key={format.id}
                    className="dl-format-pill"
                    onClick={() => controller.applyFormatSuggestion(format)}
                    title={`${format.label} · ${format.estimatedSizeText} · ${format.videoCodec ?? 'no video'} / ${format.audioCodec ?? 'no audio'}`}
                  >
                    <strong>{format.label}</strong>
                    <span>{format.ext?.toUpperCase() ?? 'Unknown'} · {format.estimatedSizeText}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="dl-preview-empty">
            <strong>{activeValidation ? 'Ready to inspect' : 'Paste a URL to inspect'}</strong>
            <span>
              {activeValidation
                ? 'Inspect the active validated item to load live site, title, duration, and format data.'
                : 'Yoinkr will validate one or many URLs, then let you inspect one active item at a time.'}
            </span>
          </div>
        )}
      </section>

      {/* ─── Card Grid ─── */}
      <div className="dl-card-grid">
        {queueItems.length === 0 ? (
          <div className="dl-empty-grid">
            <div className="dl-empty-icon">⬇</div>
            <p>Paste a URL above and click <strong>Add</strong> to start building your queue.</p>
          </div>
        ) : (
          queueItems.map((item) => {
            const fileTypes =
              item.mediaType === 'audio-only'
                ? (['mp3', 'm4a', 'wav', 'flac'] as const)
                : (['mp4', 'mkv', 'webm', 'original'] as const);

            return (
              <article key={item.id} className="dl-card">
                <div className="dl-card-thumb-wrap">
                  <img className="dl-card-thumb" src={item.thumbnailUrl} alt={item.title} />
                </div>

                <div className="dl-card-info">
                  <h3 className="dl-card-title">{item.title}</h3>

                  <div className="dl-card-selects">
                    <select
                      className="dl-select"
                      value={item.mediaType}
                      onChange={(e) =>
                        controller.updateQueueItem(item.id, {
                          mediaType: e.target.value as typeof item.mediaType,
                        })
                      }
                    >
                      <option value="video-audio">Video + Audio</option>
                      <option value="video-only">Video</option>
                      <option value="audio-only">Audio</option>
                    </select>

                    <select
                      className="dl-select"
                      value={item.qualityTarget}
                      onChange={(e) =>
                        controller.updateQueueItem(item.id, {
                          qualityTarget: e.target.value as DownloadDraft['qualityTarget'],
                        })
                      }
                      disabled={item.mediaType === 'audio-only'}
                    >
                      <option value="best">Best</option>
                      <option value="2160p">2160p</option>
                      <option value="1440p">1440p</option>
                      <option value="1080p">1080p</option>
                      <option value="720p">720p</option>
                      <option value="480p">480p</option>
                    </select>
                  </div>

                  <div className="dl-card-selects">
                    <select
                      className="dl-select"
                      value={item.fileType}
                      onChange={(e) =>
                        controller.updateQueueItem(item.id, {
                          fileType: e.target.value as typeof item.fileType,
                        })
                      }
                    >
                      {fileTypes.map((ft) => (
                        <option key={ft} value={ft}>
                          {ft.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="dl-card-meta">
                    <span>Duration: {item.durationText}</span>
                    <span>Size: {item.sizeText}</span>
                  </div>
                </div>

                <div className="dl-card-actions">
                  <button
                    className="dl-card-action-btn"
                    onClick={() => controller.removeQueueItem(item.id)}
                    title="Remove"
                  >
                    ✕
                  </button>
                  <button
                    className="dl-card-action-btn"
                    onClick={() => {
                      if (item.sourceUrl) window.open(item.sourceUrl);
                    }}
                    title="Open source URL"
                  >
                    ↗
                  </button>
                  <button
                    className="dl-card-action-btn"
                    onClick={() =>
                      controller.triggerPlaceholderAction('Individual download will connect when the queue engine is live.')
                    }
                    title="Download"
                  >
                    ↓
                  </button>
                  <button
                    className="dl-card-action-btn"
                    onClick={() => void controller.inspectUrl(item.sourceUrl)}
                    title="Info"
                  >
                    ⓘ
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>

      {/* ─── History / Library ─── */}
      <div className="dl-history-section">
        <button className="dl-history-toggle" onClick={() => setHistoryOpen((v) => !v)}>
          <span className="dl-history-toggle-icon">{historyOpen ? '▾' : '▸'}</span>
          <span>History &amp; Library</span>
          <span className="dl-history-count">{historyItems.length}</span>
        </button>

        {historyOpen && (
          <div className="dl-history-list">
            {historyItems.map((item) => (
              <div key={item.id} className="dl-history-row">
                <img className="dl-history-thumb" src={item.thumbnailUrl} alt={item.title} />
                <div className="dl-history-info">
                  <strong>{item.title}</strong>
                  <span className="dl-history-meta">
                    {item.state} · {item.format} · {item.resolution} · {item.durationText} · {item.sizeText}
                  </span>
                </div>
                <span className="dl-history-date">{item.updatedAt}</span>
                <div className="dl-history-actions">
                  {item.sourceUrl && (
                    <button
                      className="dl-history-action dl-history-action-link"
                      onClick={() => window.open(item.sourceUrl)}
                      title="Open source URL in browser"
                    >
                      ↗
                    </button>
                  )}
                  <button
                    className="dl-history-action"
                    onClick={() => controller.triggerPlaceholderAction('Open file will hook into native file actions once media outputs are real.')}
                  >
                    Open
                  </button>
                  <button
                    className="dl-history-action"
                    onClick={() => controller.triggerPlaceholderAction('Reveal in folder will connect when saved media paths are loaded.')}
                  >
                    Folder
                  </button>
                  <button
                    className="dl-history-action"
                    onClick={() => controller.triggerPlaceholderAction('Open in editor will route selected media into the editor workspace.')}
                  >
                    Edit
                  </button>
                  <button
                    className="dl-history-action"
                    onClick={() => controller.triggerPlaceholderAction('Retry will replay this item through the queue once download execution exists.')}
                  >
                    Retry
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Bottom Action Bar ─── */}
      <div className="dl-bottom-bar">
        <div className="dl-bottom-status">
          Ready to download! {queueSummary.total} item{queueSummary.total !== 1 ? 's' : ''} queued.
        </div>

        <div className="dl-bottom-controls">
          <select
            className="dl-select"
            value={form.mediaType}
            onChange={(e) => controller.updateField('mediaType', e.target.value as typeof form.mediaType)}
          >
            <option value="video-audio">Video + Audio</option>
            <option value="video-only">Video</option>
            <option value="audio-only">Audio</option>
          </select>

          <select
            className="dl-select"
            value={form.fileType}
            onChange={(e) => controller.updateField('fileType', e.target.value as typeof form.fileType)}
          >
            {availableFileTypes.map((ft) => (
              <option key={ft} value={ft}>
                {ft.toUpperCase()}
              </option>
            ))}
          </select>

          <label className="dl-check">
            <input
              type="checkbox"
              checked={form.remuxIfPossible}
              onChange={(e) => controller.updateField('remuxIfPossible', e.target.checked)}
            />
            Remux
          </label>

          <label className="dl-check">
            <input
              type="checkbox"
              checked={form.allowReencodeFallback}
              onChange={(e) => controller.updateField('allowReencodeFallback', e.target.checked)}
            />
            Re-encode fallback
          </label>
        </div>

        <div className="dl-bottom-actions">
          <button
            className="dl-btn dl-btn-icon"
            title="Clear queue"
            onClick={() =>
              controller.triggerPlaceholderAction('Bulk queue controls will connect when real download execution is added.')
            }
          >
            🗑
          </button>
          <button
            className="dl-btn dl-btn-download"
            onClick={() =>
              controller.triggerPlaceholderAction('Download all will execute queued items in Phase 2.')
            }
          >
            Download
          </button>
        </div>
      </div>
    </div>
  );
};
