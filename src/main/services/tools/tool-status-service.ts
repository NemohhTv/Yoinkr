import type { ProcessRunner } from '@main/services/shared/process-runner';
import type { BinaryStatus } from '@shared/types/common';
import type { AppSettings } from '@shared/types/settings';

import { BinaryResolver } from './binary-resolver';

export class ToolStatusService {
  constructor(
    private readonly processRunner: ProcessRunner,
    private readonly binaryResolver: BinaryResolver,
  ) {}

  async getBinaryStatuses(settings: AppSettings): Promise<BinaryStatus[]> {
    const tools: BinaryStatus['toolName'][] = ['yt-dlp', 'ffmpeg', 'ffprobe'];

    return Promise.all(
      tools.map(async (toolName) => {
        const resolved = this.binaryResolver.resolveTool(toolName, settings);

        if (!resolved.resolvedPath) {
          return {
            toolName,
            mode: resolved.mode,
            resolvedPath: null,
            exists: false,
            versionText: null,
            status: resolved.mode === 'custom' ? 'unconfigured' : 'missing',
          } satisfies BinaryStatus;
        }

        if (!resolved.exists) {
          return {
            toolName,
            mode: resolved.mode,
            resolvedPath: resolved.resolvedPath,
            exists: false,
            versionText: null,
            status: 'missing',
          } satisfies BinaryStatus;
        }

        const versionText = await this.getVersionText(resolved.resolvedPath);

        return {
          toolName,
          mode: resolved.mode,
          resolvedPath: resolved.resolvedPath,
          exists: true,
          versionText,
          status: 'ready',
        } satisfies BinaryStatus;
      }),
    );
  }

  private async getVersionText(command: string): Promise<string | null> {
    try {
      const result = await this.processRunner.run({
        command,
        args: ['--version'],
        timeoutMs: 8000,
        maxBufferBytes: 128 * 1024,
      });

      const text = result.stdout || result.stderr;
      const firstLine = text.split(/\r?\n/).find(Boolean)?.trim() ?? null;
      return result.exitCode === 0 ? firstLine : null;
    } catch {
      return null;
    }
  }
}
