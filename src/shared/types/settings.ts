export type BinaryMode = 'bundled' | 'custom' | 'auto-detect';
export type OutputFormat = 'original' | 'mp4' | 'mkv' | 'webm' | 'mp3' | 'm4a' | 'wav' | 'flac';
export type OverwriteBehavior = 'save-as-new' | 'replace-existing' | 'confirm-replace-original';

export interface AppSettings {
  downloadDirectory: string;
  exportDirectory: string;
  tempDirectory: string;
  maxConcurrentDownloads: number;
  maxConcurrentProcessingJobs: number;
  ytDlpMode: BinaryMode;
  ytDlpPath: string;
  ffmpegMode: BinaryMode;
  ffmpegPath: string;
  ffprobePath: string;
  preferredBrowser: 'edge' | 'chrome' | 'firefox';
  defaultOutputFormat: OutputFormat;
  defaultAudioFormat: Extract<OutputFormat, 'mp3' | 'm4a' | 'wav' | 'flac'>;
  clipNamingPattern: string;
  overwriteBehavior: OverwriteBehavior;
  backupBeforeReplace: boolean;
  theme: 'dark';
  legalNoticeAccepted: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  downloadDirectory: '',
  exportDirectory: '',
  tempDirectory: '',
  maxConcurrentDownloads: 2,
  maxConcurrentProcessingJobs: 1,
  ytDlpMode: 'auto-detect',
  ytDlpPath: '',
  ffmpegMode: 'auto-detect',
  ffmpegPath: '',
  ffprobePath: '',
  preferredBrowser: 'edge',
  defaultOutputFormat: 'mp4',
  defaultAudioFormat: 'm4a',
  clipNamingPattern: '{title}_{yyyyMMdd}',
  overwriteBehavior: 'save-as-new',
  backupBeforeReplace: true,
  theme: 'dark',
  legalNoticeAccepted: false,
};

export type SettingsPatch = Partial<AppSettings>;
