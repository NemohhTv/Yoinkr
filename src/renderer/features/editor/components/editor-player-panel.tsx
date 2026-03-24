import { useEffect } from 'react';

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

  /** `onError` used to stick forever — reset when the source URL changes. */
  useEffect(() => {
    setPreviewError(null);
  }, [previewUrl, setPreviewError]);

  if (!openResult) {
    return <></>;
  }

  const clearPreviewError = (): void => {
    setPreviewError(null);
  };

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
            onLoadedMetadata={(event) => {
              clearPreviewError();
              setPreviewDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null);
            }}
            onCanPlay={clearPreviewError}
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
            onLoadedMetadata={(event) => {
              clearPreviewError();
              setPreviewDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null);
            }}
            onCanPlay={clearPreviewError}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onError={() => setPreviewError('Preview unavailable for this format.')}
          />
        )
      ) : (
        <div className="editor-no-preview">
          {openResult.previewPlaybackNote?.trim()
            ? openResult.previewPlaybackNote
            : 'Preview unavailable for this format.'}
        </div>
      )}
      {previewError && <div className="tool-error-msg">{previewError}</div>}
    </div>
  );
};
