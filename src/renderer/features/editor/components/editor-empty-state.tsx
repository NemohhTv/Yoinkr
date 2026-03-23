import type { useEditorController } from '../use-editor-controller';

type EditorController = ReturnType<typeof useEditorController>;

export const EditorEmptyState = ({ controller }: { controller: EditorController }): JSX.Element => {
  const { isDragActive, onDragEnter, onDragLeave, onDrop, pickSourceFile } = controller;

  return (
    <section
      className={`editor-dropzone ${isDragActive ? 'active' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={(event) => void onDrop(event)}
    >
      <div className="editor-drop-content stack gap-md">
        <p className="eyebrow">Open Source</p>
        <h2>Drop a local media file here</h2>
        <p className="muted">
          Downloaded items can also jump straight into this editor from the downloader `Edit` action.
        </p>
        <div className="button-cluster centered">
          <button className="button" onClick={() => void pickSourceFile()}>Choose file</button>
        </div>
      </div>
    </section>
  );
};
