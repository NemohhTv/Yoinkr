import type { DiagnosticsInfo } from '@shared/types/app';
import type { BootstrapState } from '@shared/types/app';
import type { DownloadDraft, DownloadMetadata, DownloadUrlValidation, ItemDownloadRequest, ItemDownloadProgress, ItemDownloadResult, DownloadHistoryRecord } from '@shared/types/downloader';
import type { EditorExportPreview, EditorExportRequest, EditorExportResult, EditorOpenRequest, EditorOpenResult, EditorTimelineAssets } from '@shared/types/editor';
import type { Result, BinaryStatus, DownloadableToolName, ToolDownloadProgress, ToolDownloadResult } from '@shared/types/common';
import type { AppSettings, SettingsPatch } from '@shared/types/settings';

export interface YoinkrApi {
  app: {
    getBootstrapState(): Promise<Result<BootstrapState>>;
    revealPath(targetPath: string): Promise<Result<boolean>>;
    resolveFilePath(file: File): string | null;
  };
  settings: {
    get(): Promise<Result<AppSettings>>;
    update(patch: SettingsPatch): Promise<Result<AppSettings>>;
    pickDirectory(title: string): Promise<Result<string | null>>;
    pickCookiesFile(): Promise<Result<string | null>>;
    testYtDlpCookies(patch?: SettingsPatch): Promise<Result<{ ok: boolean; message: string }>>;
    reset(): Promise<Result<AppSettings>>;
  };
  downloader: {
    validateUrls(input: string): Promise<Result<DownloadUrlValidation[]>>;
    getMetadata(url: string): Promise<Result<DownloadMetadata>>;
    enqueueDraft(draft: Omit<DownloadDraft, 'id' | 'createdAt' | 'status'>): Promise<Result<DownloadDraft>>;
    startItem(request: ItemDownloadRequest): Promise<Result<ItemDownloadResult>>;
    cancelItem(id: string): Promise<Result<boolean>>;
    onItemProgress(callback: (progress: ItemDownloadProgress) => void): () => void;
    saveHistory(record: DownloadHistoryRecord): Promise<Result<DownloadHistoryRecord>>;
    deleteHistory(id: string): Promise<Result<boolean>>;
    getHistory(): Promise<Result<DownloadHistoryRecord[]>>;
  };
  editor: {
    openSource(request: EditorOpenRequest): Promise<Result<EditorOpenResult>>;
    getTimelineAssets(sourcePath: string): Promise<Result<EditorTimelineAssets>>;
    previewExport(request: EditorExportRequest): Promise<Result<EditorExportPreview>>;
    pickSourceFile(): Promise<Result<string | null>>;
    pickExportDirectory(): Promise<Result<string | null>>;
    pickExportFile(suggestedName: string): Promise<Result<string | null>>;
    exportMedia(request: EditorExportRequest): Promise<Result<EditorExportResult>>;
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
