import type { useEditorController } from '../use-editor-controller';

type EditorController = ReturnType<typeof useEditorController>;

export const EditorHeader = ({ controller }: { controller: EditorController }): JSX.Element => {
  const { openResult, isLoadingSource, activityMessage, pickSourceFile, revealOutputPath } = controller;

  return (
    <section className="panel editor-header-panel">
      <div className="editor-header-main">
        <div className="stack gap-sm">
          <p className="eyebrow">Editor</p>
          <h1>{openResult ? openResult.source.displayName : 'Lossless and exact cut workspace'}</h1>
          <p className="muted">
            {openResult
              ? openResult.source.sourcePath
              : 'Open a downloaded file from Yoinkr or drop a local file here to begin editing.'}
          </p>
        </div>

        <div className="button-cluster">
          <button className="button" onClick={() => void pickSourceFile()} disabled={isLoadingSource}>
            {isLoadingSource ? 'Opening...' : 'Open local file'}
          </button>
          {openResult && (
            <button className="button secondary" onClick={() => void revealOutputPath(openResult.source.sourcePath)}>
              Reveal source
            </button>
          )}
        </div>
      </div>

      {activityMessage && <div className="editor-header-status muted">{activityMessage}</div>}
    </section>
  );
};
