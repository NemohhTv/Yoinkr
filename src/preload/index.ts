import { contextBridge, ipcRenderer, webUtils } from 'electron';

import { ipcChannels } from '@shared/contracts/channels';
import type { YoinkrApi } from '@shared/contracts/api';
import type { ToolDownloadProgress } from '@shared/types/common';
import type { DownloadHistoryRecord, ItemDownloadProgress } from '@shared/types/downloader';
import type { EditorExportProgressPayload } from '@shared/types/editor';
import type { UpdateStatusPayload } from '@shared/types/update';

const api: YoinkrApi = {
  app: {
    getBootstrapState: () => ipcRenderer.invoke(ipcChannels.appGetBootstrapState),
    revealPath: (targetPath) => ipcRenderer.invoke(ipcChannels.appRevealPath, targetPath),
    openDownloadLogsDirectory: () => ipcRenderer.invoke(ipcChannels.appOpenDownloadLogsDirectory),
    resolveFilePath: (file) => webUtils.getPathForFile(file) || null,
  },
  settings: {
    get: () => ipcRenderer.invoke(ipcChannels.settingsGet),
    update: (patch) => ipcRenderer.invoke(ipcChannels.settingsUpdate, patch),
    pickDirectory: (title) => ipcRenderer.invoke(ipcChannels.settingsPickDirectory, title),
    pickCookiesFile: () => ipcRenderer.invoke(ipcChannels.settingsPickCookiesFile),
    testYtDlpCookies: (patch) => ipcRenderer.invoke(ipcChannels.settingsTestYtDlpCookies, patch),
    reset: () => ipcRenderer.invoke(ipcChannels.settingsReset),
  },
  downloader: {
    validateUrls: (input) => ipcRenderer.invoke(ipcChannels.downloaderValidateUrls, input),
    getMetadata: (url) => ipcRenderer.invoke(ipcChannels.downloaderGetMetadata, url),
    enqueueDraft: (draft) => ipcRenderer.invoke(ipcChannels.downloaderEnqueueDraft, draft),
    startItem: (request) => ipcRenderer.invoke(ipcChannels.downloaderStartItem, request),
    cancelItem: (id) => ipcRenderer.invoke(ipcChannels.downloaderCancelItem, id),
    onItemProgress: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: ItemDownloadProgress): void => {
        callback(progress);
      };
      ipcRenderer.on(ipcChannels.downloaderItemProgress, handler);
      return () => {
        ipcRenderer.removeListener(ipcChannels.downloaderItemProgress, handler);
      };
    },
    saveHistory: (record: DownloadHistoryRecord) => ipcRenderer.invoke(ipcChannels.downloaderSaveHistory, record),
    deleteHistory: (id: string) => ipcRenderer.invoke(ipcChannels.downloaderDeleteHistory, id),
    getHistory: () => ipcRenderer.invoke(ipcChannels.downloaderGetHistory),
  },
  editor: {
    openSource: (request) => ipcRenderer.invoke(ipcChannels.editorOpenSource, request),
    onPreviewProxyReady: (callback) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: { sourcePath: string; playbackPath: string },
      ): void => {
        callback(payload);
      };
      ipcRenderer.on(ipcChannels.editorPreviewProxyReady, handler);
      return () => {
        ipcRenderer.removeListener(ipcChannels.editorPreviewProxyReady, handler);
      };
    },
    getTimelineAssets: (sourcePath) => ipcRenderer.invoke(ipcChannels.editorGetTimelineAssets, sourcePath),
    previewExport: (request) => ipcRenderer.invoke(ipcChannels.editorPreviewExport, request),
    pickSourceFile: () => ipcRenderer.invoke(ipcChannels.editorPickSourceFile),
    pickExportDirectory: () => ipcRenderer.invoke(ipcChannels.editorPickExportDirectory),
    pickExportFile: (suggestedName) => ipcRenderer.invoke(ipcChannels.editorPickExportFile, suggestedName),
    exportMedia: (request) => ipcRenderer.invoke(ipcChannels.editorExportMedia, request),
    onExportProgress: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: EditorExportProgressPayload): void => {
        callback(payload);
      };
      ipcRenderer.on(ipcChannels.editorExportProgress, handler);
      return () => {
        ipcRenderer.removeListener(ipcChannels.editorExportProgress, handler);
      };
    },
  },
  tools: {
    getBinaryStatus: () => ipcRenderer.invoke(ipcChannels.toolsGetBinaryStatus),
    selectBinaryPath: (toolName) => ipcRenderer.invoke(ipcChannels.toolsSelectBinaryPath, toolName),
    downloadTool: (tool) => ipcRenderer.invoke(ipcChannels.toolsDownloadTool, tool),
    onDownloadProgress: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: ToolDownloadProgress): void => {
        callback(progress);
      };
      ipcRenderer.on(ipcChannels.toolsDownloadProgress, handler);
      return () => {
        ipcRenderer.removeListener(ipcChannels.toolsDownloadProgress, handler);
      };
    },
  },
  diagnostics: {
    getAppInfo: () => ipcRenderer.invoke(ipcChannels.diagnosticsGetAppInfo),
  },
  updates: {
    getStatus: () => ipcRenderer.invoke(ipcChannels.updatesGetStatus),
    checkNow: () => ipcRenderer.invoke(ipcChannels.updatesCheckNow),
    download: () => ipcRenderer.invoke(ipcChannels.updatesDownload),
    install: () => ipcRenderer.invoke(ipcChannels.updatesInstall),
    onStatus: (callback: (payload: UpdateStatusPayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: UpdateStatusPayload): void => {
        callback(payload);
      };
      ipcRenderer.on(ipcChannels.updatesStatus, handler);
      return () => {
        ipcRenderer.removeListener(ipcChannels.updatesStatus, handler);
      };
    },
  },
};

contextBridge.exposeInMainWorld('yoinkrApi', api);
