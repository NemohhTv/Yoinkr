import { contextBridge, ipcRenderer } from 'electron';

import { ipcChannels } from '@shared/contracts/channels';
import type { YoinkrApi } from '@shared/contracts/api';
import type { ToolDownloadProgress } from '@shared/types/common';

const api: YoinkrApi = {
  app: {
    getBootstrapState: () => ipcRenderer.invoke(ipcChannels.appGetBootstrapState),
    revealPath: (targetPath) => ipcRenderer.invoke(ipcChannels.appRevealPath, targetPath),
  },
  settings: {
    get: () => ipcRenderer.invoke(ipcChannels.settingsGet),
    update: (patch) => ipcRenderer.invoke(ipcChannels.settingsUpdate, patch),
    pickDirectory: (title) => ipcRenderer.invoke(ipcChannels.settingsPickDirectory, title),
    reset: () => ipcRenderer.invoke(ipcChannels.settingsReset),
  },
  downloader: {
    validateUrls: (input) => ipcRenderer.invoke(ipcChannels.downloaderValidateUrls, input),
    getMetadata: (url) => ipcRenderer.invoke(ipcChannels.downloaderGetMetadata, url),
    enqueueDraft: (draft) => ipcRenderer.invoke(ipcChannels.downloaderEnqueueDraft, draft),
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
};

contextBridge.exposeInMainWorld('yoinkrApi', api);
