import { createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync, chmodSync } from 'node:fs';
import { join, basename } from 'node:path';
import https from 'node:https';

import AdmZip from 'adm-zip';

import type { AppPathsService } from '@main/services/paths/app-paths-service';
import type { ProcessRunner } from '@main/services/shared/process-runner';
import type { DownloadableToolName, ToolDownloadProgress, ToolDownloadResult } from '@shared/types/common';

type ProgressCallback = (progress: ToolDownloadProgress) => void;

const GITHUB_API_HEADERS = {
  'User-Agent': 'Yoinkr-Desktop/0.1',
  Accept: 'application/vnd.github.v3+json',
};

const YTDLP_RELEASE_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
const DENO_RELEASE_API = 'https://api.github.com/repos/denoland/deno/releases/latest';
const FFMPEG_RELEASE_API = 'https://api.github.com/repos/yt-dlp/FFmpeg-Builds/releases/latest';
const FFMPEG_ASSET_PATTERN = /^ffmpeg-.*-win64-gpl\.zip$/;

interface GithubRelease {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string; size: number }>;
}

export class ToolDownloadService {
  constructor(
    private readonly pathsService: AppPathsService,
    private readonly processRunner: ProcessRunner,
  ) {}

  async downloadTool(tool: DownloadableToolName, onProgress: ProgressCallback): Promise<ToolDownloadResult> {
    try {
      if (tool === 'yt-dlp') {
        return await this.downloadYtDlp(onProgress);
      }
      if (tool === 'deno') {
        return await this.downloadDeno(onProgress);
      }
      return await this.downloadFfmpegBundle(onProgress);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown download error';
      onProgress({ tool, phase: 'error', percent: 0, message });
      return { tool, success: false, installedPaths: [], version: null, error: message };
    }
  }

  private async downloadYtDlp(onProgress: ProgressCallback): Promise<ToolDownloadResult> {
    const tool: DownloadableToolName = 'yt-dlp';
    const binariesPath = this.pathsService.getPaths().binariesPath;
    this.ensureDir(binariesPath);

    onProgress({ tool, phase: 'resolving', percent: 0, message: 'Fetching latest yt-dlp release info...' });
    const release = await this.fetchJson<GithubRelease>(YTDLP_RELEASE_API);
    const asset = release.assets.find((a) => a.name === 'yt-dlp.exe');
    if (!asset) {
      throw new Error('Could not find yt-dlp.exe in the latest GitHub release.');
    }

    const destPath = join(binariesPath, 'yt-dlp.exe');
    const tempPath = destPath + '.download';

    onProgress({ tool, phase: 'downloading', percent: 0, message: `Downloading yt-dlp ${release.tag_name}...` });
    await this.downloadFile(asset.browser_download_url, tempPath, asset.size, (percent) => {
      onProgress({ tool, phase: 'downloading', percent, message: `Downloading yt-dlp ${release.tag_name}... ${percent}%` });
    });

    if (existsSync(destPath)) {
      unlinkSync(destPath);
    }
    renameSync(tempPath, destPath);

    onProgress({ tool, phase: 'verifying', percent: 100, message: 'Verifying yt-dlp...' });
    const version = await this.probeVersion(destPath);

    onProgress({ tool, phase: 'complete', percent: 100, message: `yt-dlp ${version ?? release.tag_name} installed.` });
    return { tool, success: true, installedPaths: [destPath], version: version ?? release.tag_name };
  }

  private denoWindowsZipAssetName(): string {
    if (process.arch === 'arm64') {
      return 'deno-aarch64-pc-windows-msvc.zip';
    }
    return 'deno-x86_64-pc-windows-msvc.zip';
  }

  private async downloadDeno(onProgress: ProgressCallback): Promise<ToolDownloadResult> {
    const tool: DownloadableToolName = 'deno';
    if (process.platform !== 'win32') {
      throw new Error('Managed Deno install is only supported on Windows.');
    }

    const binariesPath = this.pathsService.getPaths().binariesPath;
    this.ensureDir(binariesPath);

    const zipAssetName = this.denoWindowsZipAssetName();
    onProgress({ tool, phase: 'resolving', percent: 0, message: 'Fetching latest Deno release info...' });
    const release = await this.fetchJson<GithubRelease>(DENO_RELEASE_API);
    const asset = release.assets.find((a) => a.name === zipAssetName);
    if (!asset) {
      throw new Error(`Could not find ${zipAssetName} in the latest Deno GitHub release.`);
    }

    const zipPath = join(binariesPath, asset.name);
    const tempZipPath = zipPath + '.download';

    onProgress({ tool, phase: 'downloading', percent: 0, message: `Downloading Deno (${this.formatBytes(asset.size)})...` });
    await this.downloadFile(asset.browser_download_url, tempZipPath, asset.size, (percent) => {
      onProgress({ tool, phase: 'downloading', percent, message: `Downloading Deno... ${percent}%` });
    });

    onProgress({ tool, phase: 'extracting', percent: 0, message: 'Extracting deno.exe...' });
    const destPath = this.extractDenoExeFromZip(tempZipPath, binariesPath);
    this.cleanupFile(tempZipPath);

    if (!destPath) {
      throw new Error('Could not find deno.exe inside the downloaded archive.');
    }

    onProgress({ tool, phase: 'verifying', percent: 100, message: 'Verifying Deno...' });
    const version = await this.probeVersion(destPath);

    onProgress({ tool, phase: 'complete', percent: 100, message: `Deno ${version ?? release.tag_name} installed.` });
    return { tool, success: true, installedPaths: [destPath], version: version ?? release.tag_name };
  }

  private extractDenoExeFromZip(zipPath: string, destDir: string): string | null {
    const zip = new AdmZip(zipPath);
    const entry = zip
      .getEntries()
      .find((e) => !e.isDirectory && basename(e.entryName).toLowerCase() === 'deno.exe');
    if (!entry) {
      return null;
    }

    const targetPath = join(destDir, 'deno.exe');
    const data = entry.getData();
    const tempPath = targetPath + '.tmp';
    writeFileSync(tempPath, data);

    if (existsSync(targetPath)) {
      unlinkSync(targetPath);
    }
    renameSync(tempPath, targetPath);

    try {
      chmodSync(targetPath, 0o755);
    } catch {
      /* Windows */
    }

    return targetPath;
  }

  private async downloadFfmpegBundle(onProgress: ProgressCallback): Promise<ToolDownloadResult> {
    const tool: DownloadableToolName = 'ffmpeg-bundle';
    const binariesPath = this.pathsService.getPaths().binariesPath;
    this.ensureDir(binariesPath);

    onProgress({ tool, phase: 'resolving', percent: 0, message: 'Fetching latest ffmpeg release info...' });
    const release = await this.fetchJson<GithubRelease>(FFMPEG_RELEASE_API);
    const asset = release.assets.find((a) => FFMPEG_ASSET_PATTERN.test(a.name));
    if (!asset) {
      throw new Error('Could not find a win64 GPL ffmpeg build in the latest release.');
    }

    const zipPath = join(binariesPath, asset.name);
    const tempZipPath = zipPath + '.download';

    onProgress({ tool, phase: 'downloading', percent: 0, message: `Downloading ffmpeg (${this.formatBytes(asset.size)})...` });
    await this.downloadFile(asset.browser_download_url, tempZipPath, asset.size, (percent) => {
      onProgress({ tool, phase: 'downloading', percent, message: `Downloading ffmpeg... ${percent}%` });
    });

    onProgress({ tool, phase: 'extracting', percent: 0, message: 'Extracting ffmpeg and ffprobe...' });
    const extracted = this.extractFfmpegFromZip(tempZipPath, binariesPath);
    this.cleanupFile(tempZipPath);

    if (extracted.length === 0) {
      throw new Error('Could not find ffmpeg.exe or ffprobe.exe inside the downloaded archive.');
    }

    onProgress({ tool, phase: 'verifying', percent: 100, message: 'Verifying ffmpeg...' });
    const ffmpegPath = extracted.find((p) => basename(p).startsWith('ffmpeg.'));
    const version = ffmpegPath ? await this.probeVersion(ffmpegPath) : null;

    onProgress({ tool, phase: 'complete', percent: 100, message: `ffmpeg ${version ?? release.tag_name} installed.` });
    return { tool, success: true, installedPaths: extracted, version: version ?? release.tag_name };
  }

  private extractFfmpegFromZip(zipPath: string, destDir: string): string[] {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    const installed: string[] = [];

    for (const entry of entries) {
      const name = basename(entry.entryName).toLowerCase();
      if (name === 'ffmpeg.exe' || name === 'ffprobe.exe') {
        const targetPath = join(destDir, name);
        const data = entry.getData();
        const tempPath = targetPath + '.tmp';

        writeFileSync(tempPath, data);

        if (existsSync(targetPath)) {
          unlinkSync(targetPath);
        }
        renameSync(tempPath, targetPath);

        try {
          chmodSync(targetPath, 0o755);
        } catch {
          // chmod may not be meaningful on Windows, ignore
        }

        installed.push(targetPath);
      }
    }

    return installed;
  }

  private downloadFile(
    url: string,
    destPath: string,
    expectedSize: number,
    onPercent: (percent: number) => void,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const request = https.get(url, { headers: { 'User-Agent': 'Yoinkr-Desktop/0.1' } }, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (!redirectUrl) {
            reject(new Error('Redirect with no Location header'));
            return;
          }
          response.resume();
          this.downloadFile(redirectUrl, destPath, expectedSize, onPercent).then(resolve, reject);
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Download failed with HTTP ${response.statusCode}`));
          return;
        }

        const totalBytes = parseInt(response.headers['content-length'] ?? '0', 10) || expectedSize;
        let receivedBytes = 0;
        const fileStream = createWriteStream(destPath);

        response.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length;
          if (totalBytes > 0) {
            onPercent(Math.min(99, Math.round((receivedBytes / totalBytes) * 100)));
          }
        });

        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });

        fileStream.on('error', (err) => {
          this.cleanupFile(destPath);
          reject(err);
        });

        response.on('error', (err) => {
          this.cleanupFile(destPath);
          reject(err);
        });
      });

      request.on('error', reject);
      request.setTimeout(120_000, () => {
        request.destroy();
        reject(new Error('Download timed out after 120 seconds.'));
      });
    });
  }

  private fetchJson<T>(url: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const request = https.get(url, { headers: GITHUB_API_HEADERS }, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (!redirectUrl) {
            reject(new Error('Redirect with no Location header'));
            return;
          }
          response.resume();
          this.fetchJson<T>(redirectUrl).then(resolve, reject);
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`GitHub API returned HTTP ${response.statusCode}`));
          return;
        }

        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => {
          try {
            resolve(JSON.parse(body) as T);
          } catch {
            reject(new Error('Invalid JSON from GitHub API'));
          }
        });
        response.on('error', reject);
      });

      request.on('error', reject);
      request.setTimeout(30_000, () => {
        request.destroy();
        reject(new Error('GitHub API request timed out.'));
      });
    });
  }

  private async probeVersion(exePath: string): Promise<string | null> {
    try {
      const result = await this.processRunner.run({ command: exePath, args: ['--version'], timeoutMs: 8000, maxBufferBytes: 128 * 1024 });
      const firstLine = (result.stdout || result.stderr).split(/\r?\n/).find(Boolean)?.trim() ?? null;
      return result.exitCode === 0 ? firstLine : null;
    } catch {
      return null;
    }
  }

  private ensureDir(dirPath: string): void {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
  }

  private cleanupFile(filePath: string): void {
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch {
      // best-effort cleanup
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
