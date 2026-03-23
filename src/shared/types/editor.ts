export type EditorOpenSourceKind = 'download' | 'local';
export type EditorKeyframeAnalysisStatus = 'available' | 'unavailable' | 'not-applicable';
export type EditorCutMode = 'auto' | 'stream-copy' | 'exact';
export type EditorExportStrategy = 'stream-copy' | 'smart-cut' | 're-encode';
export type EditorExportMode = 'single-cut' | 'separate-files' | 'merge-cuts' | 'merge-and-separate';
export type EditorSegmentExportStatus = 'idle' | 'planned' | 'exporting' | 'complete' | 'error';

export interface EditorOpenRequest {
  sourcePath: string;
  sourceKind: EditorOpenSourceKind;
  downloadId?: string;
  titleHint?: string | null;
  sourceUrl?: string | null;
  autoLoad?: boolean;
}

export interface EditorMediaStreamInfo {
  index: number;
  codecType: string;
  codecName: string | null;
  codecLongName: string | null;
  profile: string | null;
  width: number | null;
  height: number | null;
  pixelFormat: string | null;
  sampleRate: number | null;
  channels: number | null;
  channelLayout: string | null;
  avgFrameRate: string | null;
  bitRate: number | null;
  durationSeconds: number | null;
  isDefault: boolean;
}

export interface EditorMediaChapter {
  id: string;
  title: string | null;
  startSeconds: number;
  endSeconds: number;
}

export interface EditorMediaInfo {
  formatName: string | null;
  formatLongName: string | null;
  container: string | null;
  durationSeconds: number | null;
  startTimeSeconds: number | null;
  bitRate: number | null;
  probeScore: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  primaryVideoStream: EditorMediaStreamInfo | null;
  primaryAudioStream: EditorMediaStreamInfo | null;
  streams: EditorMediaStreamInfo[];
  chapters: EditorMediaChapter[];
  keyframeTimes: number[];
  keyframeAnalysisStatus: EditorKeyframeAnalysisStatus;
  keyframeAnalysisMessage: string | null;
  streamCopySupported: boolean;
  mergeCutsSupported: boolean;
  warnings: string[];
}

export interface EditorSourceSummary {
  sourcePath: string;
  sourceKind: EditorOpenSourceKind;
  fileName: string;
  displayName: string;
  sourceUrl: string | null;
  sizeBytes: number | null;
  modifiedAt: string | null;
  container: string | null;
  durationSeconds: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  previewSupported: boolean;
  canEditLosslessly: boolean;
  isMissing: boolean;
  warnings: string[];
}

export interface EditorOpenResult {
  request: EditorOpenRequest;
  source: EditorSourceSummary;
  mediaInfo: EditorMediaInfo;
}

export interface EditorCutBoundaryInfo {
  requestedStartSeconds: number;
  requestedEndSeconds: number;
  actualStartSeconds: number;
  actualEndSeconds: number;
  previousKeyframeSeconds: number | null;
  nextKeyframeSeconds: number | null;
  keyframeSafe: boolean;
  exactRequested: boolean;
  adjustmentReason: string | null;
}

export interface EditorSegment {
  id: string;
  label: string;
  requestedStartSeconds: number;
  requestedEndSeconds: number;
  selected: boolean;
  exportStatus: EditorSegmentExportStatus;
}

export interface EditorTimelineThumbnail {
  id: string;
  timeSeconds: number;
  imagePath: string;
}

export interface EditorTimelineAssets {
  thumbnails: EditorTimelineThumbnail[];
  waveformImagePath: string | null;
  warnings: string[];
}

export interface EditorPreviewSegment {
  segmentId: string;
  label: string;
  boundary: EditorCutBoundaryInfo;
  strategy: EditorExportStrategy;
  warnings: string[];
}

export interface EditorExportPreview {
  exportMode: EditorExportMode;
  cutMode: EditorCutMode;
  strategy: EditorExportStrategy;
  canExport: boolean;
  mergeSupported: boolean;
  outputDescription: string;
  outputPathHint: string | null;
  warnings: string[];
  segments: EditorPreviewSegment[];
}

export interface EditorExportRequest {
  sourcePath: string;
  sourceKind: EditorOpenSourceKind;
  segments: EditorSegment[];
  exportMode: EditorExportMode;
  cutMode: EditorCutMode;
  outputDirectory?: string | null;
  outputFilePath?: string | null;
  baseName?: string | null;
  preserveOriginal: boolean;
}

export interface EditorExportResult {
  success: boolean;
  outputPaths: string[];
  strategy: EditorExportStrategy;
  preview: EditorExportPreview;
  warnings: string[];
  message: string;
}

export type EditorSegmentDraft = EditorSegment;
