import type { BinaryStatus, DownloadableToolName, ToolDownloadProgress, ToolDownloadResult } from '@shared/types/common';
import type { DownloadDraft, DownloadMetadata, DownloadUrlValidation } from '@shared/types/downloader';
import type { AppSettings, SettingsPatch } from '@shared/types/settings';
import type { BootstrapState, DiagnosticsInfo } from '@shared/types/app';

import { unwrapResult } from './result';

const appClient = {
  getBootstrapState: async (): Promise<BootstrapState> =>
    unwrapResult(await window.yoinkrApi.app.getBootstrapState()),
  revealPath: async (targetPath: string): Promise<boolean> =>
    unwrapResult(await window.yoinkrApi.app.revealPath(targetPath)),
};

const settingsClient = {
  get: async (): Promise<AppSettings> => unwrapResult(await window.yoinkrApi.settings.get()),
  update: async (patch: SettingsPatch): Promise<AppSettings> =>
    unwrapResult(await window.yoinkrApi.settings.update(patch)),
  pickDirectory: async (title: string): Promise<string | null> =>
    unwrapResult(await window.yoinkrApi.settings.pickDirectory(title)),
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

export const yoinkrClient = {
  app: appClient,
  settings: settingsClient,
  downloader: downloaderClient,
  tools: toolsClient,
  diagnostics: diagnosticsClient,
};
