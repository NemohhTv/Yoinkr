import type { AppSettings } from '@shared/types/settings';

/** Applied when Settings → Download throttle mode is on (balanced, not extreme). */
export const YT_DLP_THROTTLE_PRESET = {
  sleepIntervalSecondsMin: 2,
  sleepIntervalSecondsMax: 6,
  maxConcurrentFragments: 3,
} as const;

/** Random or fixed sleep between yt-dlp operations when throttle mode is enabled. */
export function appendYtDlpSleepArgs(args: string[], settings: AppSettings): void {
  if (!settings.downloadThrottleMode) {
    return;
  }
  const min = YT_DLP_THROTTLE_PRESET.sleepIntervalSecondsMin;
  const max = YT_DLP_THROTTLE_PRESET.sleepIntervalSecondsMax;
  args.push('--sleep-interval', String(min));
  if (max > min) {
    args.push('--max-sleep-interval', String(max));
  }
}

/** Adds `--concurrent-fragments` for full-file downloads when throttle mode is on. */
export function appendYtDlpConcurrentFragmentsArg(args: string[], settings: AppSettings): void {
  if (!settings.downloadThrottleMode) {
    return;
  }
  args.push('--concurrent-fragments', String(YT_DLP_THROTTLE_PRESET.maxConcurrentFragments));
}

/** Caps section-clip fragment parallelism when throttle mode is on. */
export function effectiveSectionConcurrentFragments(settings: AppSettings, sectionFragments: number): number {
  if (!settings.downloadThrottleMode) {
    return sectionFragments;
  }
  return Math.min(sectionFragments, YT_DLP_THROTTLE_PRESET.maxConcurrentFragments);
}
