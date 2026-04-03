export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

export interface AppError {
  code: string;
  message: string;
  details?: string;
}

export interface DirectoryInfo {
  key: string;
  path: string;
}

export interface BinaryStatus {
  toolName: 'yt-dlp' | 'deno' | 'ffmpeg' | 'ffprobe';
  mode: 'bundled' | 'custom' | 'auto-detect';
  resolvedPath: string | null;
  exists: boolean;
  versionText: string | null;
  status: 'ready' | 'missing' | 'unconfigured';
}

export type DownloadableToolName = 'yt-dlp' | 'ffmpeg-bundle';

export interface ToolDownloadProgress {
  tool: DownloadableToolName;
  phase: 'resolving' | 'downloading' | 'extracting' | 'verifying' | 'complete' | 'error';
  percent: number;
  message: string;
}

export interface ToolDownloadResult {
  tool: DownloadableToolName;
  success: boolean;
  installedPaths: string[];
  version: string | null;
  error?: string;
}
