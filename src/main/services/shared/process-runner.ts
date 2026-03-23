import { spawn } from 'node:child_process';

import { ServiceError } from './service-error';

export interface ProcessRunOptions {
  command: string;
  args: string[];
  timeoutMs?: number;
  maxBufferBytes?: number;
  cwd?: string;
}

export interface ProcessRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class ProcessRunner {
  async run({
    command,
    args,
    timeoutMs = 20000,
    maxBufferBytes = 16 * 1024 * 1024,
    cwd,
  }: ProcessRunOptions): Promise<ProcessRunResult> {
    return new Promise<ProcessRunResult>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const cleanup = (): void => {
        clearTimeout(timeoutHandle);
      };

      const fail = (error: Error): void => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        reject(error);
      };

      const timeoutHandle = setTimeout(() => {
        child.kill();
        fail(new ServiceError('PROCESS_TIMEOUT', `Timed out after ${timeoutMs}ms while running ${command}.`));
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString();
        if (stdout.length + stderr.length > maxBufferBytes) {
          child.kill();
          fail(new ServiceError('PROCESS_OUTPUT_TOO_LARGE', `Process output exceeded ${maxBufferBytes} bytes.`));
        }
      });

      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
        if (stdout.length + stderr.length > maxBufferBytes) {
          child.kill();
          fail(new ServiceError('PROCESS_OUTPUT_TOO_LARGE', `Process output exceeded ${maxBufferBytes} bytes.`));
        }
      });

      child.on('error', (error) => {
        fail(new ServiceError('PROCESS_START_FAILED', `Unable to start ${command}.`, error.message));
      });

      child.on('close', (exitCode) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: exitCode ?? -1,
        });
      });
    });
  }
}
