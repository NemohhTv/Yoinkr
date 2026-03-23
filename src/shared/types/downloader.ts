import type { OutputFormat } from './settings';

export type DownloadMediaType = 'video-audio' | 'video-only' | 'audio-only';
export type DownloadValidationErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_URL'
  | 'AUTH_REQUIRED'
  | 'TOOL_MISSING'
  | 'YT_DLP_FAILED';

export interface DownloadUrlValidation {
  input: string;
  normalizedUrl: string;
  isValid: boolean;
  errorCode?: DownloadValidationErrorCode;
  reason?: string;
}

export interface DownloadFormatOption {
  id: string;
  formatId: string;
  label: string;
  formatNote: string | null;
  ext: string | null;
  container: string | null;
  protocol: string | null;
  width: number | null;
  height: number | null;
  resolutionLabel: string;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  hasVideo: boolean;
  hasAudio: boolean;
  audioOnly: boolean;
  videoOnly: boolean;
  dynamicRange: string | null;
  filesizeBytes: number | null;
  filesizeApproxBytes: number | null;
  estimatedSizeText: string;
  sourcePreference: number | null;
  sortKey: string;
}

export interface DownloadMetadata {
  sourceUrl: string;
  normalizedUrl: string;
  title: string;
  uploader: string;
  channel: string;
  thumbnailUrl: string;
  durationSeconds: number | null;
  durationText: string;
  uploadDate: string;
  extractor: string;
  extractorKey: string;
  webpageUrl: string;
  siteWarning: string;
  availableFormats: DownloadFormatOption[];
  audioOnlyAvailable: boolean;
  videoOnlyAvailable: boolean;
  subtitles: string[];
  chapters: string[];
}

export interface DownloadDraft {
  id: string;
  sourceUrl: string;
  normalizedUrl: string;
  qualityTarget: 'best' | '2160p' | '1440p' | '1080p' | '720p' | '480p' | 'audio-only' | 'custom';
  outputFormat: OutputFormat;
  audioOnly: boolean;
  remuxIfPossible: boolean;
  allowReencodeFallback: boolean;
  status: 'draft' | 'queued';
  createdAt: string;
}
