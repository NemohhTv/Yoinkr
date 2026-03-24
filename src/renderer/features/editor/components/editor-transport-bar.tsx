import type { useEditorController } from '../use-editor-controller';

type EditorController = ReturnType<typeof useEditorController>;

/** Edit controls (left) + export mode + Export (right) — one compact row. */
export const EditorTransportBar = ({ controller }: { controller: EditorController }): JSX.Element => {
  const {
    formatTimecode,
    currentTime,
    selection,
    isPlaying,
    togglePlayback,
    setInToCurrent,
    setOutToCurrent,
    addSegment,
    isExporting,
    exportMode,
    exportJob,
    setExportMode,
    exportMedia,
    revealOutputPath,
  } = controller;

  const canAddSegment = selection.outPointSeconds > selection.inPointSeconds + 0.001;

  return (
    <div className="editor-bottom-bar editor-bottom-bar--unified">
      <div className="editor-transport-left">
        <button type="button" className="button secondary" onClick={() => void togglePlayback()}>
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>
        <button type="button" className="button secondary" onClick={setInToCurrent} title="Set start (I)">
          Set start
        </button>
        <button type="button" className="button secondary" onClick={setOutToCurrent} title="Set end (O)">
          Set end
        </button>
        <button
          className="button"
          type="button"
          disabled={!canAddSegment}
          title={
            canAddSegment
              ? 'Add the current in/out range as an export segment'
              : 'Set start and end so end is after start (or wait for duration to load)'
          }
          onClick={addSegment}
        >
          Add segment
        </button>

        <span className="editor-timecode">{formatTimecode(currentTime)}</span>
      </div>

      <div className="editor-toolbar-export-cluster">
        <select
          className="editor-export-mode-select"
          value={exportMode}
          onChange={(event) => setExportMode(event.target.value as typeof exportMode)}
          title="Export layout"
        >
          <option value="separate-files">Separate files</option>
          <option value="merge-cuts">Merge cuts</option>
        </select>
        <button
          type="button"
          className="button primary editor-export-submit"
          disabled={isExporting}
          onClick={() => void exportMedia()}
        >
          {isExporting ? 'Exporting…' : 'Export'}
        </button>
        {exportJob.status === 'complete' && exportJob.outputPaths[0] && (
          <button
            type="button"
            className="button secondary editor-export-reveal-btn"
            onClick={() => void revealOutputPath(exportJob.outputPaths[0])}
            title="Reveal exported file"
          >
            📂
          </button>
        )}
      </div>
    </div>
  );
};
