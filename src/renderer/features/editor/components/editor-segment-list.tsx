import type { useEditorController } from '../use-editor-controller';

type EditorController = ReturnType<typeof useEditorController>;

export const EditorSegmentList = ({ controller }: { controller: EditorController }): JSX.Element => {
  const {
    segments,
    selectedSegmentId,
    exportPreview,
    loadSegment,
    moveSegment,
    toggleSegmentSelected,
    duplicateSegment,
    removeSegment,
  } = controller;

  return (
    <section className="panel editor-segment-panel">
      <div className="editor-panel-heading">
        <div>
          <p className="eyebrow">Segments</p>
          <h2>Cut list</h2>
        </div>
        <span className="muted">{segments.length} saved</span>
      </div>

      {segments.length === 0 ? (
        <div className="workspace-preview">
          <div className="workspace-strip">No saved segments yet. The current selection can still be previewed and exported as a single cut.</div>
        </div>
      ) : (
        <div className="editor-segment-list">
          {segments.map((segment, index) => {
            const previewSegment = exportPreview?.segments.find((item) => item.segmentId === segment.id) ?? null;

            return (
              <div key={segment.id} className={`editor-segment-card ${selectedSegmentId === segment.id ? 'active' : ''}`}>
                <div className="editor-segment-head">
                  <div className="stack gap-xs">
                    <strong>{segment.label}</strong>
                    <p className="muted">
                      Requested {segment.requestedStartSeconds.toFixed(3)}s to {segment.requestedEndSeconds.toFixed(3)}s
                    </p>
                    {previewSegment && (
                      <p className="muted">
                        Actual {previewSegment.boundary.actualStartSeconds.toFixed(3)}s to {previewSegment.boundary.actualEndSeconds.toFixed(3)}s
                      </p>
                    )}
                  </div>
                  <span className="editor-segment-length">
                    {(segment.requestedEndSeconds - segment.requestedStartSeconds).toFixed(3)}s
                  </span>
                </div>

                {previewSegment?.warnings.length ? (
                  <div className="editor-segment-warning muted">{previewSegment.warnings.join(' ')}</div>
                ) : null}

                <div className="button-cluster">
                  <button className="button secondary" onClick={() => loadSegment(segment.id)}>Load</button>
                  <button className="button secondary" onClick={() => toggleSegmentSelected(segment.id)}>
                    {segment.selected ? 'Deselect' : 'Select'}
                  </button>
                  <button className="button secondary" onClick={() => moveSegment(segment.id, -1)} disabled={index === 0}>Up</button>
                  <button className="button secondary" onClick={() => moveSegment(segment.id, 1)} disabled={index === segments.length - 1}>Down</button>
                  <button className="button secondary" onClick={() => duplicateSegment(segment.id)}>Duplicate</button>
                  <button className="button secondary" onClick={() => removeSegment(segment.id)}>Remove</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
