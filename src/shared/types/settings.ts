export type BinaryMode = 'bundled' | 'custom' | 'auto-detect';
export type OutputFormat = 'original' | 'mp4' | 'mkv' | 'webm' | 'mp3' | 'm4a' | 'wav' | 'flac';
export type OverwriteBehavior = 'save-as-new' | 'replace-existing' | 'confirm-replace-original';

/** How yt-dlp should authenticate for sites that need a logged-in session (e.g. age-gated YouTube). */
export type YtDlpCookieMode = 'none' | 'browser' | 'file' | 'paste';

export interface AppSettings {
  /** Default folder for video and mixed video+audio downloads. */
  downloadDirectory: string;
  /**
   * Folder for audio-only downloads (and video+audio jobs that extract to mp3/m4a/etc.).
   * Empty = use `downloadDirectory`.
   */
  audioDownloadDirectory: string;
  exportDirectory: string;
  tempDirectory: string;
  maxConcurrentDownloads: number;
  maxConcurrentProcessingJobs: number;
  ytDlpMode: BinaryMode;
  ytDlpPath: string;
  /** Deno ≥2 for YouTube JS challenges when using yt-dlp; see yt-dlp release notes / issue #14404. */
  denoMode: BinaryMode;
  denoPath: string;
  ffmpegMode: BinaryMode;
  ffmpegPath: string;
  ffprobePath: string;
  preferredBrowser: 'edge' | 'chrome' | 'firefox';
  /**
   * Optional yt-dlp browser profile id when using cookie source "browser".
   * Examples: Chrome/Edge `Default`, `Profile 1`; Firefox folder name e.g. `abc123.default-release`.
   * Empty = let yt-dlp pick its default profile.
   */
  ytDlpBrowserProfile: string;
  /** Pass cookies to yt-dlp for restricted videos; `browser` uses `preferredBrowser`. */
  ytDlpCookieMode: YtDlpCookieMode;
  /** Netscape-format cookies.txt (e.g. from "Get cookies.txt" extension). Used when `ytDlpCookieMode === 'file'`. */
  ytDlpCookiesFilePath: string;
  /** Raw Netscape cookies.txt content pasted in Settings. Written to app data when used; `ytDlpCookieMode === 'paste'`. */
  ytDlpCookiesPastedText: string;
  defaultOutputFormat: OutputFormat;
  defaultAudioFormat: Extract<OutputFormat, 'mp3' | 'm4a' | 'wav' | 'flac'>;
  clipNamingPattern: string;
  overwriteBehavior: OverwriteBehavior;
  backupBeforeReplace: boolean;
  theme: 'dark';
  legalNoticeAccepted: boolean;
  /** When true, each download writes yt-dlp stderr to %AppData%/Yoinkr/logs/downloads/ for debugging. */
  saveDownloadLogs: boolean;
  /**
   * Parallel DASH/HLS fragments for **section** (`--download-sections`) jobs only.
   * Lower (e.g. 4–8) on slow disks or flaky networks; higher on fast machines (max 32).
   */
  sectionConcurrentFragments: number;
  /**
   * When true, uses Yoinkr’s built-in “gentle” yt-dlp preset (sleep between downloads, fewer parallel fragments)
   * and runs **Download all** one queue item at a time. Not a guarantee against site limits.
   */
  downloadThrottleMode: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  downloadDirectory: '',
  audioDownloadDirectory: '',
  exportDirectory: '',
  tempDirectory: '',
  maxConcurrentDownloads: 2,
  maxConcurrentProcessingJobs: 1,
  ytDlpMode: 'auto-detect',
  ytDlpPath: '',
  denoMode: 'auto-detect',
  denoPath: '',
  ffmpegMode: 'auto-detect',
  ffmpegPath: '',
  ffprobePath: '',
  preferredBrowser: 'edge',
  ytDlpBrowserProfile: '',
  ytDlpCookieMode: 'none',
  ytDlpCookiesFilePath: '',
  ytDlpCookiesPastedText: '',
  defaultOutputFormat: 'mp4',
  defaultAudioFormat: 'm4a',
  clipNamingPattern: '{title}_{yyyyMMdd}',
  overwriteBehavior: 'save-as-new',
  backupBeforeReplace: true,
  theme: 'dark',
  legalNoticeAccepted: false,
  saveDownloadLogs: true,
  sectionConcurrentFragments: 8,
  downloadThrottleMode: false,
};

export type SettingsPatch = Partial<AppSettings>;
