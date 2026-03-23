import type { useEditorController } from '../use-editor-controller';

type EditorController = ReturnType<typeof useEditorController>;

export const EditorTransportBar = ({ controller }: { controller: EditorController }): JSX.Element => {
  const {
    currentTime,
    isPlaying,
    keyframeTimes,
    segmentLabel,
    setSegmentLabel,
    stepBy,
    stepToPreviousKeyframe,
    stepToNextKeyframe,
    togglePlayback,
    setInToCurrent,
    setOutToCurrent,
    jumpToInPoint,
    jumpToOutPoint,
    snapInToKeyframe,
    snapOutToKeyframe,
    addSegment,
    updateSelectedSegment,
    selectedSegmentId,
  } = controller;

  return (
    <section className="panel editor-transport-panel">
      <div className="editor-transport-row">
        <button className="button secondary" onClick={() => void togglePlayback()}>
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button className="button secondary" onClick={() => stepBy(-1 / 30)}>Prev frame</button>
        <button className="button secondary" onClick={() => stepBy(1 / 30)}>Next frame</button>
        <button className="button secondary" onClick={stepToPreviousKeyframe} disabled={keyframeTimes.length === 0}>
          Prev keyframe
        </button>
        <button className="button secondary" onClick={stepToNextKeyframe} disabled={keyframeTimes.length === 0}>
          Next keyframe
        </button>
        <button className="button secondary" onClick={setInToCurrent}>Mark in</button>
        <button className="button secondary" onClick={setOutToCurrent}>Mark out</button>
        <button className="button secondary" onClick={jumpToInPoint}>Jump in</button>
        <button className="button secondary" onClick={jumpToOutPoint}>Jump out</button>
        <button className="button secondary" onClick={snapInToKeyframe} disabled={keyframeTimes.length === 0}>
          Snap in
        </button>
        <button className="button secondary" onClick={snapOutToKeyframe} disabled={keyframeTimes.length === 0}>
          Snap out
        </button>
      </div>

      <div className="editor-transport-footer">
        <div className="editor-time-readout">
          <strong>{currentTime.toFixed(3)}s</strong>
          <span className="muted">Space = play/pause, I = in, O = out, Shift+Arrows = keyframes</span>
        </div>

        <div className="editor-transport-actions">
          <input
            value={segmentLabel}
            onChange={(event) => setSegmentLabel(event.target.value)}
            placeholder="Clip label"
          />
          <button className="button" onClick={addSegment}>Add segment</button>
          <button className="button secondary" onClick={updateSelectedSegment} disabled={!selectedSegmentId}>
            Update selected
          </button>
        </div>
      </div>
    </section>
  );
};
