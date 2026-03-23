import type { useEditorController } from './use-editor-controller';

type EditorController = ReturnType<typeof useEditorController>;

export const EditorScreen = ({ controller }: { controller: EditorController }): JSX.Element => {
  const { isDragActive, hints, onDragEnter, onDragLeave, onDrop } = controller;

  return (
    <div className="editor-page stack gap-lg">
      <section className="hero-surface">
        <div className="hero-intro stack gap-sm">
          <p className="eyebrow">Editor</p>
          <h1>Reserved workspace for fast lossless cutting</h1>
          <p className="muted">
            This route is now part of the primary product structure so future trimming and merge tools can land in a dedicated workspace.
          </p>
        </div>
      </section>

      <section
        className={`editor-dropzone ${isDragActive ? 'active' : ''}`}
        onDragEnter={onDragEnter}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={onDragLeave}
        onDrop={(event) => {
          event.preventDefault();
          onDrop();
        }}
      >
        <div className="editor-drop-content stack gap-md">
          <p className="eyebrow">Future Workspace</p>
          <h2>Drop a local video here later</h2>
          <p className="muted">
            Local file opening, project resume, frame stepping, segments, and export controls are intentionally deferred.
          </p>
          <div className="button-cluster centered">
            <button className="button secondary">Open file later</button>
            <button className="button secondary">Open recent later</button>
          </div>
        </div>
      </section>

      <section className="editor-lower-grid">
        <div className="panel stack gap-md">
          <p className="eyebrow">Planned Capabilities</p>
          <h2>Editor lane</h2>
          {hints.map((hint) => (
            <div key={hint} className="list-card">
              <span>{hint}</span>
            </div>
          ))}
        </div>

        <div className="panel stack gap-md">
          <p className="eyebrow">Reserved Regions</p>
          <h2>Workspace blocks</h2>
          <div className="workspace-preview">
            <div className="workspace-strip">Player and scrub bar</div>
            <div className="workspace-grid">
              <div className="workspace-block">Segment list</div>
              <div className="workspace-block">Timeline and waveform</div>
            </div>
            <div className="workspace-strip">Export summary and action bar</div>
          </div>
        </div>
      </section>
    </div>
  );
};
