import type { useEditorController } from './use-editor-controller';
import { EditorEmptyState } from './components/editor-empty-state';
import { EditorExportRail } from './components/editor-export-rail';
import { EditorHeader } from './components/editor-header';
import { EditorPlayerPanel } from './components/editor-player-panel';
import { EditorSegmentList } from './components/editor-segment-list';
import { EditorTimelinePanel } from './components/editor-timeline-panel';
import { EditorTransportBar } from './components/editor-transport-bar';

type EditorController = ReturnType<typeof useEditorController>;

export const EditorScreen = ({ controller }: { controller: EditorController }): JSX.Element => {
  const { openResult, error } = controller;

  return (
    <div className="editor-page stack gap-lg">
      <EditorHeader controller={controller} />

      {error && <div className="dl-notice dl-notice-danger">{error}</div>}

      {openResult ? (
        <div className="editor-shell-grid">
          <div className="editor-main-column">
            <EditorPlayerPanel controller={controller} />
            <EditorTimelinePanel controller={controller} />
            <EditorTransportBar controller={controller} />
          </div>

          <div className="editor-side-column">
            <EditorExportRail controller={controller} />
            <EditorSegmentList controller={controller} />
          </div>
        </div>
      ) : (
        <EditorEmptyState controller={controller} />
      )}
    </div>
  );
};
