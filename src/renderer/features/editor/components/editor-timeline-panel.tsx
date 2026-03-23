import type { useEditorController } from '../use-editor-controller';

type EditorController = ReturnType<typeof useEditorController>;

export const EditorTimelinePanel = ({ controller }: { controller: EditorController }): JSX.Element => {
  const {
    sourceDuration,
    currentTime,
    selection,
    selectionInputs,
    timelineZoom,
    timelineWindow,
    timelineThumbnails,
    waveformUrl,
    keyframeMarkers,
    keyframeTimes,
    exportPreview,
    updateSelectionInput,
    commitSelectionInput,
    seekTo,
    setSelectionRange,
    setTimelineZoom,
  } = controller;

  const activePreviewSegment = exportPreview?.segments[0] ?? null;
  const selectionStartPercent = sourceDuration > 0 ? (selection.inPointSeconds / sourceDuration) * 100 : 0;
  const selectionEndPercent = sourceDuration > 0 ? (selection.outPointSeconds / sourceDuration) * 100 : 0;

  return (
    <section className="panel editor-timeline-panel">
      <div className="editor-panel-heading">
        <div>
          <p className="eyebrow">Timeline</p>
          <h2>Requested and actual boundaries</h2>
        </div>
        <div className="editor-zoom-controls">
          {[1, 2, 4, 8].map((zoom) => (
            <button
              key={zoom}
              className={`button secondary ${timelineZoom === zoom ? 'editor-button-active' : ''}`}
              onClick={() => setTimelineZoom(zoom)}
            >
              {zoom}x
            </button>
          ))}
        </div>
      </div>

      <div className="editor-timecode-grid">
        <label className="field">
          <span>In point</span>
          <input
            value={selectionInputs.inPoint}
            onChange={(event) => updateSelectionInput('inPoint', event.target.value)}
            onBlur={() => commitSelectionInput('inPoint')}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitSelectionInput('inPoint');
              }
            }}
          />
        </label>
        <label className="field">
          <span>Out point</span>
          <input
            value={selectionInputs.outPoint}
            onChange={(event) => updateSelectionInput('outPoint', event.target.value)}
            onBlur={() => commitSelectionInput('outPoint')}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitSelectionInput('outPoint');
              }
            }}
          />
        </label>
      </div>

      <div className="editor-selection-summary">
        <div className="editor-selection-pill">
          <span>Requested start</span>
          <strong>{selection.inPointSeconds.toFixed(3)}s</strong>
        </div>
        <div className="editor-selection-pill">
          <span>Requested end</span>
          <strong>{selection.outPointSeconds.toFixed(3)}s</strong>
        </div>
        <div className="editor-selection-pill">
          <span>Length</span>
          <strong>{Math.max(0, selection.outPointSeconds - selection.inPointSeconds).toFixed(3)}s</strong>
        </div>
        {activePreviewSegment && (
          <div className="editor-selection-pill">
            <span>Actual export</span>
            <strong>{activePreviewSegment.boundary.actualStartSeconds.toFixed(3)}s to {activePreviewSegment.boundary.actualEndSeconds.toFixed(3)}s</strong>
          </div>
        )}
      </div>

      <div className="editor-overview-track">
        <div className="editor-selection-highlight" style={{ left: `${selectionStartPercent}%`, width: `${Math.max(1, selectionEndPercent - selectionStartPercent)}%` }} />
        {keyframeMarkers.map((marker) => (
          <span key={marker.id} className="editor-keyframe-marker" style={{ left: `${marker.percent}%` }} />
        ))}
        <input
          className="editor-range-input"
          type="range"
          min={0}
          max={sourceDuration || 0}
          step={0.001}
          value={Math.min(currentTime, sourceDuration || currentTime)}
          onChange={(event) => seekTo(Number.parseFloat(event.target.value))}
        />
      </div>

      <div className="editor-boundary-sliders">
        <label className="field">
          <span>Adjust in</span>
          <input
            type="range"
            min={0}
            max={sourceDuration || 0}
            step={0.001}
            value={selection.inPointSeconds}
            onChange={(event) => setSelectionRange(Number.parseFloat(event.target.value), selection.outPointSeconds)}
          />
        </label>
        <label className="field">
          <span>Adjust out</span>
          <input
            type="range"
            min={0}
            max={sourceDuration || 0}
            step={0.001}
            value={selection.outPointSeconds}
            onChange={(event) => setSelectionRange(selection.inPointSeconds, Number.parseFloat(event.target.value))}
          />
        </label>
      </div>

      <div className="editor-window-summary muted">
        Visible window: {timelineWindow.startSeconds.toFixed(3)}s to {timelineWindow.endSeconds.toFixed(3)}s
        {keyframeTimes.length > 0 ? ` • ${keyframeTimes.length} keyframes` : ''}
      </div>

      {waveformUrl && (
        <div className="editor-waveform-strip">
          <img src={waveformUrl} alt="Waveform preview" />
        </div>
      )}

      {timelineThumbnails.length > 0 && (
        <div className="editor-thumbnail-strip">
          {timelineThumbnails.map((thumbnail) => (
            <button
              key={thumbnail.id}
              className="editor-thumbnail-button"
              onClick={() => seekTo(thumbnail.timeSeconds)}
              title={`${thumbnail.timeSeconds.toFixed(3)}s`}
            >
              <img src={thumbnail.fileUrl} alt={`Thumbnail at ${thumbnail.timeSeconds.toFixed(3)} seconds`} />
              <span>{thumbnail.timeSeconds.toFixed(1)}s</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
};
