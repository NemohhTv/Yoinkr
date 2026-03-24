export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'disabled';

export interface UpdateStatusPayload {
  phase: UpdatePhase;
  /** New version on GitHub (when an update exists or finished downloading). */
  availableVersion?: string;
  releaseNotes?: string;
  /** 0–100 while downloading */
  percent?: number;
  /** True when the installer payload is ready and the app can restart into the new version */
  downloaded?: boolean;
  error?: string;
  /** Shown when updates are not supported (dev build, portable exe, etc.) */
  disabledReason?: string;
}
