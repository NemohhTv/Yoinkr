import type { BinaryStatus, DownloadableToolName, ToolDownloadProgress, ToolDownloadResult } from '@shared/types/common';
import type { DownloadDraft, DownloadMetadata, DownloadUrlValidation, DownloadHistoryRecord, ItemDownloadRequest, ItemDownloadProgress, ItemDownloadResult } from '@shared/types/downloader';
import type {
  EditorExportPreview,
  EditorExportProgressPayload,
  EditorExportRequest,
  EditorExportResult,
  EditorOpenRequest,
  EditorOpenResult,
  EditorTimelineAssets,
} from '@shared/types/editor';
import type { AppSettings, SettingsPatch } from '@shared/types/settings';
import type { BootstrapState, DiagnosticsInfo } from '@shared/types/app';
import type { UpdateStatusPayload } from '@shared/types/update';

import { unwrapResult } from './result';

const appClient = {
  getBootstrapState: async (): Promise<BootstrapState> =>
    unwrapResult(await window.yoinkrApi.app.getBootstrapState()),
  revealPath: async (targetPath: string): Promise<boolean> =>
    unwrapResult(await window.yoinkrApi.app.revealPath(targetPath)),
  openDownloadLogsDirectory: async (): Promise<boolean> =>
    unwrapResult(await window.yoinkrApi.app.openDownloadLogsDirectory()),
  resolveFilePath: (file: File): string | null => window.yoinkrApi.app.resolveFilePath(file),
};

const settingsClient = {
  get: async (): Promise<AppSettings> => unwrapResult(await window.yoinkrApi.settings.get()),
  update: async (patch: SettingsPatch): Promise<AppSettings> =>
    unwrapResult(await window.yoinkrApi.settings.update(patch)),
  pickDirectory: async (title: string): Promise<string | null> =>
    unwrapResult(await window.yoinkrApi.settings.pickDirectory(title)),
  pickCookiesFile: async (): Promise<string | null> =>
    unwrapResult(await window.yoinkrApi.settings.pickCookiesFile()),
  testYtDlpCookies: async (patch?: SettingsPatch): Promise<{ ok: boolean; message: string }> =>
    unwrapResult(await window.yoinkrApi.settings.testYtDlpCookies(patch)),
  reset: async (): Promise<AppSettings> => unwrapResult(await window.yoinkrApi.settings.reset()),
};

const downloaderClient = {
  validateUrls: async (input: string): Promise<DownloadUrlValidation[]> =>
    unwrapResult(await window.yoinkrApi.downloader.validateUrls(input)),
  getMetadata: async (url: string): Promise<DownloadMetadata> =>
    unwrapResult(await window.yoinkrApi.downloader.getMetadata(url)),
  enqueueDraft: async (
    draft: Omit<DownloadDraft, 'id' | 'createdAt' | 'status'>,
  ): Promise<DownloadDraft> => unwrapResult(await window.yoinkrApi.downloader.enqueueDraft(draft)),
  startItem: async (request: ItemDownloadRequest): Promise<ItemDownloadResult> =>
    unwrapResult(await window.yoinkrApi.downloader.startItem(request)),
  cancelItem: async (id: string): Promise<boolean> =>
    unwrapResult(await window.yoinkrApi.downloader.cancelItem(id)),
  onItemProgress: (callback: (progress: ItemDownloadProgress) => void): (() => void) =>
    window.yoinkrApi.downloader.onItemProgress(callback),
  saveHistory: async (record: DownloadHistoryRecord): Promise<DownloadHistoryRecord> =>
    unwrapResult(await window.yoinkrApi.downloader.saveHistory(record)),
  deleteHistory: async (id: string): Promise<boolean> =>
    unwrapResult(await window.yoinkrApi.downloader.deleteHistory(id)),
  getHistory: async (): Promise<DownloadHistoryRecord[]> =>
    unwrapResult(await window.yoinkrApi.downloader.getHistory()),
};

const editorClient = {
  openSource: async (request: EditorOpenRequest): Promise<EditorOpenResult> =>
    unwrapResult(await window.yoinkrApi.editor.openSource(request)),
  onPreviewProxyReady: (callback: (payload: { sourcePath: string; playbackPath: string }) => void): (() => void) =>
    window.yoinkrApi.editor.onPreviewProxyReady(callback),
  getTimelineAssets: async (sourcePath: string): Promise<EditorTimelineAssets> =>
    unwrapResult(await window.yoinkrApi.editor.getTimelineAssets(sourcePath)),
  previewExport: async (request: EditorExportRequest): Promise<EditorExportPreview> =>
    unwrapResult(await window.yoinkrApi.editor.previewExport(request)),
  pickSourceFile: async (): Promise<string | null> =>
    unwrapResult(await window.yoinkrApi.editor.pickSourceFile()),
  pickExportDirectory: async (): Promise<string | null> =>
    unwrapResult(await window.yoinkrApi.editor.pickExportDirectory()),
  pickExportFile: async (suggestedName: string): Promise<string | null> =>
    unwrapResult(await window.yoinkrApi.editor.pickExportFile(suggestedName)),
  exportMedia: async (request: EditorExportRequest): Promise<EditorExportResult> =>
    unwrapResult(await window.yoinkrApi.editor.exportMedia(request)),
  onExportProgress: (callback: (payload: EditorExportProgressPayload) => void): (() => void) =>
    window.yoinkrApi.editor.onExportProgress(callback),
};

const toolsClient = {
  getBinaryStatus: async (): Promise<BinaryStatus[]> =>
    unwrapResult(await window.yoinkrApi.tools.getBinaryStatus()),
  selectBinaryPath: async (toolName: BinaryStatus['toolName']): Promise<string | null> =>
    unwrapResult(await window.yoinkrApi.tools.selectBinaryPath(toolName)),
  downloadTool: async (tool: DownloadableToolName): Promise<ToolDownloadResult> =>
    unwrapResult(await window.yoinkrApi.tools.downloadTool(tool)),
  onDownloadProgress: (callback: (progress: ToolDownloadProgress) => void): (() => void) =>
    window.yoinkrApi.tools.onDownloadProgress(callback),
};

const diagnosticsClient = {
  getAppInfo: async (): Promise<DiagnosticsInfo> =>
    unwrapResult(await window.yoinkrApi.diagnostics.getAppInfo()),
};

const updatesClient = {
  getStatus: async (): Promise<UpdateStatusPayload> =>
    unwrapResult(await window.yoinkrApi.updates.getStatus()),
  checkNow: async (): Promise<void> => {
    unwrapResult(await window.yoinkrApi.updates.checkNow());
  },
  download: async (): Promise<void> => {
    unwrapResult(await window.yoinkrApi.updates.download());
  },
  install: async (): Promise<void> => {
    unwrapResult(await window.yoinkrApi.updates.install());
  },
  onStatus: (callback: (payload: UpdateStatusPayload) => void): (() => void) =>
    window.yoinkrApi.updates.onStatus(callback),
};

export const yoinkrClient = {
  app: appClient,
  settings: settingsClient,
  downloader: downloaderClient,
  editor: editorClient,
  tools: toolsClient,
  diagnostics: diagnosticsClient,
  updates: updatesClient,
};
