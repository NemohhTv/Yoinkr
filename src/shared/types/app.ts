import type { DirectoryInfo } from './common';

export interface BootstrapState {
  appName: string;
  appVersion: string;
  platform: NodeJS.Platform;
  firstRun: boolean;
  managedDirectories: DirectoryInfo[];
}

export interface DiagnosticsInfo {
  appVersion: string;
  userDataPath: string;
  databasePath: string;
  logsPath: string;
  binariesPath: string;
}
