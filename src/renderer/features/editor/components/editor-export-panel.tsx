import type { useEditorController } from '../use-editor-controller';

type EditorController = ReturnType<typeof useEditorController>;

const shortenFolderPath = (path: string, maxChars = 42): string => {
  const t = path.trim();
  if (t.length <= maxChars) {
    return t;
  }
  return `…${t.slice(1 - maxChars)}`;
};

export const EditorExportPanel = ({ controller }: { controller: EditorController }): JSX.Element => {
  const {
    outputDirectory,
    exportFileName,
    exportOutputStem,
    exportOutputExtension,
    setExportOutputStem,
    pickExportDirectory,
  } = controller;

  const folderSummary = outputDirectory ? shortenFolderPath(outputDirectory) : '';

  const onStemInput = (raw: string): void => {
    let v = raw;
    if (exportOutputExtension && v.toLowerCase().endsWith(exportOutputExtension.toLowerCase())) {
      v = v.slice(0, -exportOutputExtension.length);
    }
    setExportOutputStem(v);
  };

  return (
    <div className="editor-output-split">
      <section className="editor-output-split-col editor-output-split-col--name" aria-labelledby="editor-output-name-label">
        <div className="editor-output-row-label" id="editor-output-name-label">
          Output name
        </div>
        <div className="editor-output-name-field">
          <input
            type="text"
            className="editor-output-name-input"
            value={exportOutputStem}
            onChange={(event) => onStemInput(event.target.value)}
            placeholder="Name for exported file"
            title={exportFileName.trim() ? exportFileName : 'Base name — extension matches your source'}
            spellCheck={false}
            autoComplete="off"
          />
          {exportOutputExtension ? (
            <span className="editor-output-ext" title="Extension is kept from the source file">
              {exportOutputExtension}
            </span>
          ) : null}
        </div>
      </section>

      <section className="editor-output-split-col editor-output-split-col--folder" aria-labelledby="editor-output-folder-label">
        <div className="editor-output-row-label" id="editor-output-folder-label">
          Output folder
        </div>
        <div className="editor-output-folder-field">
          <div
            className="editor-output-folder-path"
            title={
              outputDirectory
                ? outputDirectory
                : 'Choose a folder with the button on the right (or use your default export directory).'
            }
          >
            {outputDirectory ? folderSummary : 'Default / not set'}
          </div>
          <button
            type="button"
            className={`button secondary editor-output-folder-btn${outputDirectory ? ' is-set' : ''}`}
            onClick={() => void pickExportDirectory()}
            title={
              outputDirectory
                ? `Output folder:\n${outputDirectory}\n\nClick to change.`
                : 'Choose where exports are saved'
            }
          >
            {outputDirectory ? 'Folder ✓' : 'Folder'}
          </button>
        </div>
      </section>
    </div>
  );
};
