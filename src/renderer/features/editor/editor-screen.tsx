import type { useEditorController } from './use-editor-controller';
import { EditorEmptyState } from './components/editor-empty-state';
import { EditorPlayerPanel } from './components/editor-player-panel';
import { EditorSegmentList } from './components/editor-segment-list';
import { EditorExportPanel } from './components/editor-export-panel';
import { EditorTimelinePanel } from './components/editor-timeline-panel';
import { EditorTransportBar } from './components/editor-transport-bar';

type EditorController = ReturnType<typeof useEditorController>;

export const EditorScreen = ({ controller }: { controller: EditorController }): JSX.Element => {
  const { openResult, error, activityMessage, pickSourceFile, closeEdit, isExporting, exportJob } = controller;

  return (
    <div className="editor-page">
      {error && <div className="dl-notice dl-notice-danger">{error}</div>}
      {isExporting && (
        <div className="dl-notice dl-notice-info">
          {exportJob.strategyHeadline && (
            <div>
              <strong>{exportJob.strategyHeadline}</strong>
            </div>
          )}
          {exportJob.strategyHint && (
            <div className="muted" style={{ fontSize: '0.9em', marginTop: '4px' }}>
              {exportJob.strategyHint}
            </div>
          )}
          {exportJob.message && (
            <div style={{ marginTop: '6px' }}>{exportJob.message}</div>
          )}
        </div>
      )}
      {activityMessage && !error && !isExporting && <div className="dl-notice dl-notice-success">{activityMessage}</div>}

      {openResult ? (
        <div className="editor-workspace">
          <div className="editor-workspace-main">
            <div className="editor-workspace-stack">
              <section className="editor-card editor-card--media" aria-label="Source and preview">
                <header className="editor-source-bar">
                  <div className="editor-source-name-wrap">
                    <span className="editor-source-name" title={openResult.source.sourcePath}>
                      {openResult.source.displayName}
                    </span>
                  </div>
                  <div className="editor-source-actions">
                    <button type="button" className="editor-new-edit-btn" onClick={() => void pickSourceFile()}>
                      New edit
                    </button>
                    <button type="button" className="editor-close-edit-btn" onClick={closeEdit}>
                      Close
                    </button>
                  </div>
                </header>
                <div className="editor-preview-stage">
                  <EditorPlayerPanel controller={controller} />
                </div>
              </section>

              <section className="editor-card editor-card--timeline" aria-label="Timeline">
                <EditorTimelinePanel controller={controller} />
              </section>

              <section className="editor-card editor-card--toolbar" aria-label="Playback and export">
                <EditorTransportBar controller={controller} />
              </section>

              <div className="editor-output-split-wrap">
                <EditorExportPanel controller={controller} />
              </div>
            </div>
          </div>

          <aside className="editor-workspace-side" aria-label="Segments">
            <EditorSegmentList controller={controller} />
          </aside>
        </div>
      ) : (
        <EditorEmptyState controller={controller} />
      )}
    </div>
  );
};
