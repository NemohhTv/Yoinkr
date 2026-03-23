import type { useEditorController } from '../use-editor-controller';

type EditorController = ReturnType<typeof useEditorController>;

export const EditorExportRail = ({ controller }: { controller: EditorController }): JSX.Element => {
  const {
    openResult,
    workingSegments,
    cutMode,
    exportMode,
    exportPreview,
    exportJob,
    outputDirectory,
    outputFilePath,
    isPlanningExport,
    isExporting,
    previewWarnings,
    setCutMode,
    setExportMode,
    pickExportDirectory,
    pickExportFile,
    exportMedia,
    revealOutputPath,
  } = controller;

  if (!openResult) {
    return <></>;
  }

  return (
    <section className="panel editor-export-rail">
      <div className="editor-panel-heading">
        <div>
          <p className="eyebrow">Export</p>
          <h2>Planner and output</h2>
        </div>
        <span className="muted">{workingSegments.length} active segment{workingSegments.length === 1 ? '' : 's'}</span>
      </div>

      <div className="editor-summary-grid">
        <div className="editor-summary-item">
          <span className="muted">Container</span>
          <strong>{openResult.source.container ?? 'Unknown'}</strong>
        </div>
        <div className="editor-summary-item">
          <span className="muted">Keyframes</span>
          <strong>
            {openResult.mediaInfo.keyframeAnalysisStatus === 'available'
              ? `${openResult.mediaInfo.keyframeTimes.length} detected`
              : openResult.mediaInfo.keyframeAnalysisStatus}
          </strong>
        </div>
        <div className="editor-summary-item">
          <span className="muted">Original file</span>
          <strong>Preserved</strong>
        </div>
        <div className="editor-summary-item">
          <span className="muted">Timeline assets</span>
          <strong>{controller.isLoadingTimelineAssets ? 'Building...' : 'Ready'}</strong>
        </div>
      </div>

      <div className="editor-export-grid">
        <label className="field">
          <span>Cut mode</span>
          <select value={cutMode} onChange={(event) => setCutMode(event.target.value as typeof cutMode)}>
            <option value="auto">Auto / recommended</option>
            <option value="stream-copy">Fast lossless stream copy</option>
            <option value="exact">Exact timestamps</option>
          </select>
        </label>

        <label className="field">
          <span>Export mode</span>
          <select value={exportMode} onChange={(event) => setExportMode(event.target.value as typeof exportMode)}>
            <option value="single-cut">Single cut</option>
            <option value="separate-files">Separate files</option>
            <option value="merge-cuts">Merge cuts</option>
            <option value="merge-and-separate">Merge and separate</option>
          </select>
        </label>
      </div>

      {(exportMode === 'separate-files' || exportMode === 'merge-and-separate') && (
        <div className="field">
          <span>Export folder</span>
          <div className="editor-path-row">
            <input value={outputDirectory ?? ''} readOnly placeholder="Choose an export folder" />
            <button className="button secondary" onClick={() => void pickExportDirectory()}>Browse</button>
          </div>
        </div>
      )}

      {(exportMode === 'single-cut' || exportMode === 'merge-cuts' || exportMode === 'merge-and-separate') && (
        <div className="field">
          <span>Output file</span>
          <div className="editor-path-row">
            <input value={outputFilePath ?? ''} readOnly placeholder="Choose a destination file" />
            <button className="button secondary" onClick={() => void pickExportFile()}>Browse</button>
          </div>
        </div>
      )}

      <div className="editor-export-summary">
        <div className="editor-selection-pill">
          <span>Planner</span>
          <strong>{isPlanningExport ? 'Updating...' : exportPreview?.strategy ?? 'Waiting'}</strong>
        </div>
        <div className="editor-selection-pill">
          <span>Preview</span>
          <strong>{exportPreview?.outputDescription ?? 'No active preview'}</strong>
        </div>
        <div className="editor-selection-pill">
          <span>Can export</span>
          <strong>{exportPreview?.canExport ? 'Yes' : 'No'}</strong>
        </div>
      </div>

      {exportPreview?.warnings.map((warning) => (
        <div key={warning} className="list-card editor-warning-card">
          <span>{warning}</span>
        </div>
      ))}

      {!exportPreview?.warnings.length && previewWarnings.slice(0, 2).map((warning) => (
        <div key={warning} className="list-card editor-warning-card">
          <span>{warning}</span>
        </div>
      ))}

      <div className="button-cluster">
        <button className="button" onClick={() => void exportMedia()} disabled={isExporting || workingSegments.length === 0 || !exportPreview?.canExport}>
          {isExporting ? 'Exporting...' : 'Export now'}
        </button>
        {exportJob.outputPaths[0] && (
          <button className="button secondary" onClick={() => void revealOutputPath(exportJob.outputPaths[0])}>
            Reveal output
          </button>
        )}
      </div>

      {exportJob.message && (
        <div className={`dl-notice ${exportJob.status === 'error' ? 'dl-notice-danger' : 'dl-notice-info'}`}>
          {exportJob.message}
        </div>
      )}
    </section>
  );
};
