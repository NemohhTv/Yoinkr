import type { useEditorController } from '../use-editor-controller';

type EditorController = ReturnType<typeof useEditorController>;

export const EditorPlayerPanel = ({ controller }: { controller: EditorController }): JSX.Element => {
  const {
    previewRef,
    openResult,
    previewUrl,
    isAudioOnly,
    currentTime,
    previewError,
    setCurrentTime,
    setPreviewDuration,
    setPreviewError,
    setIsPlaying,
  } = controller;

  if (!openResult) {
    return <></>;
  }

  return (
    <section className="panel editor-player-panel">
      <div className="editor-panel-heading">
        <div>
          <p className="eyebrow">Preview</p>
          <h2>Player</h2>
        </div>
        <div className="editor-time-readout">
          <strong>{currentTime.toFixed(3)}s</strong>
          <span className="muted">current playhead</span>
        </div>
      </div>

      {openResult.source.previewSupported && previewUrl ? (
        isAudioOnly ? (
          <audio
            key={previewUrl}
            ref={(node) => {
              previewRef.current = node;
            }}
            className="editor-preview-audio"
            src={previewUrl}
            controls
            preload="metadata"
            onLoadedMetadata={(event) => setPreviewDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null)}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onError={() => setPreviewError('Chromium could not preview this source, but probe/export can still work.')}
          />
        ) : (
          <video
            key={previewUrl}
            ref={(node) => {
              previewRef.current = node;
            }}
            className="editor-preview-video"
            src={previewUrl}
            controls
            preload="metadata"
            onLoadedMetadata={(event) => setPreviewDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null)}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onError={() => setPreviewError('Chromium could not preview this source, but probe/export can still work.')}
          />
        )
      ) : (
        <div className="workspace-preview">
          <div className="workspace-strip">Preview is unavailable for this container in Chromium.</div>
        </div>
      )}

      {previewError && <div className="tool-error-msg">{previewError}</div>}
    </section>
  );
};
