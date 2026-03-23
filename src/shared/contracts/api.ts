import type { DiagnosticsInfo } from '@shared/types/app';
import type { BootstrapState } from '@shared/types/app';
import type { DownloadDraft, DownloadMetadata, DownloadUrlValidation } from '@shared/types/downloader';
import type { Result, BinaryStatus, DownloadableToolName, ToolDownloadProgress, ToolDownloadResult } from '@shared/types/common';
import type { AppSettings, SettingsPatch } from '@shared/types/settings';

export interface YoinkrApi {
  app: {
    getBootstrapState(): Promise<Result<BootstrapState>>;
    revealPath(targetPath: string): Promise<Result<boolean>>;
  };
  settings: {
    get(): Promise<Result<AppSettings>>;
    update(patch: SettingsPatch): Promise<Result<AppSettings>>;
    pickDirectory(title: string): Promise<Result<string | null>>;
    reset(): Promise<Result<AppSettings>>;
  };
  downloader: {
    validateUrls(input: string): Promise<Result<DownloadUrlValidation[]>>;
    getMetadata(url: string): Promise<Result<DownloadMetadata>>;
    enqueueDraft(draft: Omit<DownloadDraft, 'id' | 'createdAt' | 'status'>): Promise<Result<DownloadDraft>>;
  };
  tools: {
    getBinaryStatus(): Promise<Result<BinaryStatus[]>>;
    selectBinaryPath(toolName: BinaryStatus['toolName']): Promise<Result<string | null>>;
    downloadTool(tool: DownloadableToolName): Promise<Result<ToolDownloadResult>>;
    onDownloadProgress(callback: (progress: ToolDownloadProgress) => void): () => void;
  };
  diagnostics: {
    getAppInfo(): Promise<Result<DiagnosticsInfo>>;
  };
}
