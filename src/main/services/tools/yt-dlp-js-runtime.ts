import { delimiter, dirname } from 'node:path';

import type { BinaryResolver } from './binary-resolver';
import type { AppSettings } from '@shared/types/settings';

/**
 * YouTube extraction will require a real JS runtime for challenges; Deno ≥2 is recommended.
 * @see https://github.com/yt-dlp/yt-dlp/issues/14404
 */
export function getYtDlpJsRuntimeCliArgs(settings: AppSettings, binaryResolver: BinaryResolver): string[] {
  const deno = binaryResolver.resolveTool('deno', settings);
  if (deno.resolvedPath && deno.exists) {
    return ['--js-runtimes', 'deno'];
  }
  return ['--js-runtimes', 'node'];
}

/** Prepend Deno's directory to PATH so yt-dlp can spawn a custom Deno install. */
export function getDenoPathEnvForYtDlpSpawn(
  settings: AppSettings,
  binaryResolver: BinaryResolver,
): Record<string, string> | undefined {
  const deno = binaryResolver.resolveTool('deno', settings);
  if (!deno.resolvedPath || !deno.exists) {
    return undefined;
  }
  const dir = dirname(deno.resolvedPath);
  const key = process.platform === 'win32' ? 'Path' : 'PATH';
  const cur = process.env[key] ?? '';
  return { [key]: `${dir}${delimiter}${cur}` };
}
