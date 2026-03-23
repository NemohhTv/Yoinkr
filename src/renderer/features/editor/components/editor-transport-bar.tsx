import type { useEditorController } from '../use-editor-controller';

type EditorController = ReturnType<typeof useEditorController>;

export const EditorTransportBar = ({ controller }: { controller: EditorController }): JSX.Element => {
  const {
    formatTimecode,
    currentTime,
    isPlaying,
    isExporting,
    exportMode,
    outputDirectory,
    exportFileName,
    exportJob,
    togglePlayback,
    setInToCurrent,
    setOutToCurrent,
    addSegment,
    setExportMode,
    setExportFileName,
    pickExportDirectory,
    exportMedia,
    revealOutputPath,
    setOutputDirectory,
  } = controller;

  return (
    <div className="editor-bottom-bar">
      <div className="editor-transport-left">
        <button className="button secondary" onClick={() => void togglePlayback()}>
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>
        <button className="button secondary" onClick={setInToCurrent} title="Set start (I)">Set start</button>
        <button className="button secondary" onClick={setOutToCurrent} title="Set end (O)">Set end</button>
        <button className="button" onClick={addSegment}>Add segment</button>

        <span className="editor-timecode">{formatTimecode(currentTime)}</span>
      </div>

      <div className="editor-transport-right">
        <input
          type="text"
          className="editor-filename-input"
          value={exportFileName}
          onChange={(event) => setExportFileName(event.target.value)}
          placeholder="File name..."
          title="Export file name"
        />

        <div className="editor-export-path" title={outputDirectory ?? 'No export folder set'}>
          <input
            type="text"
            readOnly
            value={outputDirectory ?? ''}
            placeholder="Folder..."
            onClick={() => void pickExportDirectory()}
            onChange={(event) => setOutputDirectory(event.target.value)}
          />
          <button className="button secondary" onClick={() => void pickExportDirectory()}>Browse</button>
        </div>

        <select
          className="editor-export-mode-select"
          value={exportMode}
          onChange={(event) => setExportMode(event.target.value as typeof exportMode)}
        >
          <option value="separate-files">Separate files</option>
          <option value="merge-cuts">Merge cuts</option>
        </select>

        <button
          className="button primary"
          disabled={isExporting}
          onClick={() => void exportMedia()}
        >
          {isExporting ? 'Exporting...' : 'Export'}
        </button>

        {exportJob.status === 'complete' && exportJob.outputPaths[0] && (
          <button
            className="button secondary"
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
