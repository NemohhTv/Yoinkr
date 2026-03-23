export const APP_ID = 'com.yoinkr.app';
export const APP_NAME = 'Yoinkr';
export const APP_THEME = 'dark';

export const MANAGED_DIRECTORY_KEYS = [
  'downloads',
  'exports',
  'temp',
  'projects',
  'thumbnails',
  'waveforms',
  'logs',
  'cache',
] as const;

export type ManagedDirectoryKey = (typeof MANAGED_DIRECTORY_KEYS)[number];
