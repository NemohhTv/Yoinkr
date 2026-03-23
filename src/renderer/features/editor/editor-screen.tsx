import type { useEditorController } from './use-editor-controller';
import { EditorEmptyState } from './components/editor-empty-state';
import { EditorPlayerPanel } from './components/editor-player-panel';
import { EditorSegmentList } from './components/editor-segment-list';
import { EditorTimelinePanel } from './components/editor-timeline-panel';
import { EditorTransportBar } from './components/editor-transport-bar';

type EditorController = ReturnType<typeof useEditorController>;

export const EditorScreen = ({ controller }: { controller: EditorController }): JSX.Element => {
  const { openResult, error, activityMessage, pickSourceFile, closeEdit } = controller;

  return (
    <div className="editor-page">
      {error && <div className="dl-notice dl-notice-danger">{error}</div>}
      {activityMessage && !error && <div className="dl-notice dl-notice-success">{activityMessage}</div>}

      {openResult ? (
        <>
          <div className="editor-top-row">
            <div className="editor-player-wrapper">
              <div className="editor-source-bar">
                <span className="editor-source-name" title={openResult.source.sourcePath}>
                  {openResult.source.displayName}
                </span>
                <div className="editor-source-actions">
                  <button className="editor-new-edit-btn" onClick={() => void pickSourceFile()}>
                    New edit
                  </button>
                  <button className="editor-close-edit-btn" onClick={closeEdit}>
                    Close
                  </button>
                </div>
              </div>
              <EditorPlayerPanel controller={controller} />
            </div>
            <EditorSegmentList controller={controller} />
          </div>

          <div className="editor-timeline-row">
            <EditorTimelinePanel controller={controller} />
          </div>

          <div className="editor-transport-row">
            <EditorTransportBar controller={controller} />
          </div>
        </>
      ) : (
        <EditorEmptyState controller={controller} />
      )}
    </div>
  );
};
