import type { useEditorController } from '../use-editor-controller';

type EditorController = ReturnType<typeof useEditorController>;

export const EditorPlayerPanel = ({ controller }: { controller: EditorController }): JSX.Element => {
  const {
    previewRef,
    openResult,
    previewUrl,
    isAudioOnly,
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
    <div className="editor-player-panel">
      {openResult.source.previewSupported && previewUrl ? (
        isAudioOnly ? (
          <audio
            key={previewUrl}
            ref={(node) => { previewRef.current = node; }}
            className="editor-preview-audio"
            src={previewUrl}
            controls
            preload="metadata"
            onLoadedMetadata={(event) => setPreviewDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null)}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onError={() => setPreviewError('Preview unavailable for this format.')}
          />
        ) : (
          <video
            key={previewUrl}
            ref={(node) => { previewRef.current = node; }}
            className="editor-preview-video"
            src={previewUrl}
            controls
            preload="metadata"
            onLoadedMetadata={(event) => setPreviewDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null)}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onError={() => setPreviewError('Preview unavailable for this format.')}
          />
        )
      ) : (
        <div className="editor-no-preview">Preview unavailable for this container.</div>
      )}
      {previewError && <div className="tool-error-msg">{previewError}</div>}
    </div>
  );
};
