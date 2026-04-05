import type { DownloadMediaType } from '@shared/types/downloader';
import type { OutputFormat } from '@shared/types/settings';

const AUDIO_OUTPUT_FORMATS: ReadonlySet<OutputFormat> = new Set(['mp3', 'm4a', 'wav', 'flac']);

/**
 * True when the job should use the audio download folder and yt-dlp audio extraction semantics.
 * Uses output format as a fallback when `audioOnly` was not kept in sync with `mediaType`.
 */
export function isAudioDestinationDownload(params: {
  mediaType: DownloadMediaType;
  audioOnly: boolean;
  outputFormat: OutputFormat;
}): boolean {
  return (
    params.mediaType === 'audio-only' ||
    params.audioOnly ||
    AUDIO_OUTPUT_FORMATS.has(params.outputFormat)
  );
}
