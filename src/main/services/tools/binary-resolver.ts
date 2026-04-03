import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

import type { AppPathsService } from '@main/services/paths/app-paths-service';
import type { BinaryStatus } from '@shared/types/common';
import type { AppSettings } from '@shared/types/settings';

export interface ResolvedBinary {
  toolName: BinaryStatus['toolName'];
  mode: BinaryStatus['mode'];
  resolvedPath: string | null;
  exists: boolean;
}

const toolExecutables: Record<BinaryStatus['toolName'], string[]> = {
  'yt-dlp': ['yt-dlp.exe', 'yt-dlp'],
  deno: ['deno.exe', 'deno'],
  ffmpeg: ['ffmpeg.exe', 'ffmpeg'],
  ffprobe: ['ffprobe.exe', 'ffprobe'],
};

export class BinaryResolver {
  constructor(private readonly pathsService: AppPathsService) {}

  resolveTool(toolName: BinaryStatus['toolName'], settings: AppSettings): ResolvedBinary {
    const mode =
      toolName === 'yt-dlp'
        ? settings.ytDlpMode
        : toolName === 'deno'
          ? settings.denoMode
          : settings.ffmpegMode;
    const configuredPath = this.getConfiguredPath(toolName, settings);

    if (mode === 'custom') {
      const resolvedPath = configuredPath.trim() || null;
      return {
        toolName,
        mode,
        resolvedPath,
        exists: resolvedPath ? existsSync(resolvedPath) : false,
      };
    }

    if (mode === 'bundled') {
      const resolvedPath = this.resolveBundled(toolName);
      return {
        toolName,
        mode,
        resolvedPath,
        exists: resolvedPath ? existsSync(resolvedPath) : false,
      };
    }

    const resolvedPath = this.resolveAutoDetected(toolName);
    return {
      toolName,
      mode,
      resolvedPath,
      exists: resolvedPath ? existsSync(resolvedPath) : false,
    };
  }

  private getConfiguredPath(toolName: BinaryStatus['toolName'], settings: AppSettings): string {
    if (toolName === 'yt-dlp') {
      return settings.ytDlpPath;
    }
    if (toolName === 'deno') {
      return settings.denoPath;
    }

    return toolName === 'ffmpeg' ? settings.ffmpegPath : settings.ffprobePath;
  }

  private resolveBundled(toolName: BinaryStatus['toolName']): string | null {
    const binariesPath = this.pathsService.getPaths().binariesPath;
    const candidates = toolExecutables[toolName].map((fileName) => join(binariesPath, fileName));
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  }

  private resolveAutoDetected(toolName: BinaryStatus['toolName']): string | null {
    const pathEntries = process.env['PATH']?.split(delimiter).filter(Boolean) ?? [];

    for (const pathEntry of pathEntries) {
      for (const fileName of toolExecutables[toolName]) {
        const candidate = join(pathEntry, fileName);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  }
}
