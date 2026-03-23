import { z } from 'zod';

import { DEFAULT_SETTINGS, type AppSettings, type SettingsPatch } from '@shared/types/settings';

const settingsSchema = z.object({
  downloadDirectory: z.string(),
  exportDirectory: z.string(),
  tempDirectory: z.string(),
  maxConcurrentDownloads: z.number().int().min(1).max(8),
  maxConcurrentProcessingJobs: z.number().int().min(1).max(8),
  ytDlpMode: z.enum(['bundled', 'custom', 'auto-detect']),
  ytDlpPath: z.string(),
  ffmpegMode: z.enum(['bundled', 'custom', 'auto-detect']),
  ffmpegPath: z.string(),
  ffprobePath: z.string(),
  preferredBrowser: z.enum(['edge', 'chrome', 'firefox']),
  defaultOutputFormat: z.enum(['original', 'mp4', 'mkv', 'webm', 'mp3', 'm4a', 'wav', 'flac']),
  defaultAudioFormat: z.enum(['mp3', 'm4a', 'wav', 'flac']),
  clipNamingPattern: z.string().min(1).max(120),
  overwriteBehavior: z.enum(['save-as-new', 'replace-existing', 'confirm-replace-original']),
  backupBeforeReplace: z.boolean(),
  theme: z.literal('dark'),
  legalNoticeAccepted: z.boolean(),
});

export class SettingsValidator {
  mergeAndValidate(current: Partial<AppSettings>, patch?: SettingsPatch): AppSettings {
    return settingsSchema.parse({
      ...DEFAULT_SETTINGS,
      ...current,
      ...patch,
    });
  }
}
