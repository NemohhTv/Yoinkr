import { useCallback, useEffect, useRef, useState } from 'react';

import type { BinaryStatus, DownloadableToolName, ToolDownloadProgress } from '@shared/types/common';
import type { DiagnosticsInfo } from '@shared/types/app';
import type { AppSettings } from '@shared/types/settings';

import { useAppState } from '@renderer/app/providers/app-state-context';
import { yoinkrClient } from '@renderer/lib/api/yoinkr-client';

export interface ToolDownloadState {
  isDownloading: boolean;
  progress: ToolDownloadProgress | null;
}

export const useSettingsController = () => {
  const { settings, applySettings } = useAppState();
  const [draft, setDraft] = useState<AppSettings | null>(settings);
  const [binaryStatus, setBinaryStatus] = useState<BinaryStatus[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [downloadStates, setDownloadStates] = useState<Record<DownloadableToolName, ToolDownloadState>>({
    'yt-dlp': { isDownloading: false, progress: null },
    deno: { isDownloading: false, progress: null },
    'ffmpeg-bundle': { isDownloading: false, progress: null },
  });

  const [cookieTestResult, setCookieTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const unsubProgressRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    unsubProgressRef.current = yoinkrClient.tools.onDownloadProgress((progress) => {
      setDownloadStates((prev) => ({
        ...prev,
        [progress.tool]: {
          isDownloading: progress.phase !== 'complete' && progress.phase !== 'error',
          progress,
        },
      }));
    });

    return () => {
      unsubProgressRef.current?.();
    };
  }, []);

  useEffect(() => {
    const loadSupportPanels = async () => {
      try {
        const [statuses, diagnosticsInfo] = await Promise.all([
          yoinkrClient.tools.getBinaryStatus(),
          yoinkrClient.diagnostics.getAppInfo(),
        ]);
        setBinaryStatus(statuses);
        setDiagnostics(diagnosticsInfo);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load support panels.');
      }
    };

    void loadSupportPanels();
  }, []);

  const refreshBinaryStatus = useCallback(async () => {
    try {
      const statuses = await yoinkrClient.tools.getBinaryStatus();
      setBinaryStatus(statuses);
      const refreshedSettings = await yoinkrClient.settings.get();
      applySettings(refreshedSettings);
      setDraft(refreshedSettings);
    } catch {
      // non-critical refresh
    }
  }, [applySettings]);

  const updateField = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void => {
    if (
      key === 'ytDlpCookieMode'
      || key === 'ytDlpBrowserProfile'
      || key === 'ytDlpCookiesFilePath'
      || key === 'ytDlpCookiesPastedText'
      || key === 'preferredBrowser'
    ) {
      setCookieTestResult(null);
    }
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const pickDirectory = async (
    field: 'downloadDirectory' | 'exportDirectory' | 'tempDirectory',
    title: string,
  ): Promise<void> => {
    const selectedPath = await yoinkrClient.settings.pickDirectory(title);
    if (selectedPath) {
      updateField(field, selectedPath);
    }
  };

  const pickCookiesFile = async (): Promise<void> => {
    const selectedPath = await yoinkrClient.settings.pickCookiesFile();
    if (selectedPath) {
      updateField('ytDlpCookiesFilePath', selectedPath);
      setCookieTestResult(null);
    }
  };

  const testYtDlpCookies = async (): Promise<void> => {
    if (!draft) {
      return;
    }
    setCookieTestResult(null);
    setError(null);
    try {
      const authPatch = {
        ytDlpCookieMode: draft.ytDlpCookieMode,
        ytDlpBrowserProfile: draft.ytDlpBrowserProfile,
        ytDlpCookiesFilePath: draft.ytDlpCookiesFilePath,
        ytDlpCookiesPastedText: draft.ytDlpCookiesPastedText,
        preferredBrowser: draft.preferredBrowser,
      } as const;
      const saved = await yoinkrClient.settings.update(authPatch);
      applySettings(saved);
      setDraft(saved);
      const result = await yoinkrClient.settings.testYtDlpCookies(authPatch);
      setCookieTestResult(result);
    } catch (testError) {
      setCookieTestResult({
        ok: false,
        message: testError instanceof Error ? testError.message : 'Cookie test failed.',
      });
    }
  };

  const chooseBinaryPath = async (toolName: BinaryStatus['toolName']): Promise<void> => {
    const selectedPath = await yoinkrClient.tools.selectBinaryPath(toolName);
    if (!selectedPath) {
      return;
    }

    if (toolName === 'yt-dlp') {
      updateField('ytDlpPath', selectedPath);
      updateField('ytDlpMode', 'custom');
      return;
    }

    if (toolName === 'deno') {
      updateField('denoPath', selectedPath);
      updateField('denoMode', 'custom');
      return;
    }

    if (toolName === 'ffmpeg') {
      updateField('ffmpegPath', selectedPath);
      updateField('ffmpegMode', 'custom');
      return;
    }

    updateField('ffprobePath', selectedPath);
    updateField('ffmpegMode', 'custom');
  };

  const downloadTool = useCallback(async (tool: DownloadableToolName): Promise<void> => {
    setDownloadStates((prev) => ({
      ...prev,
      [tool]: { isDownloading: true, progress: { tool, phase: 'resolving', percent: 0, message: 'Starting...' } },
    }));
    setError(null);

    try {
      const result = await yoinkrClient.tools.downloadTool(tool);
      if (!result.success) {
        setError(result.error ?? 'Download failed.');
      }
      await refreshBinaryStatus();
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Download failed.');
      setDownloadStates((prev) => ({
        ...prev,
        [tool]: { isDownloading: false, progress: null },
      }));
    }
  }, [refreshBinaryStatus]);

  const save = async (): Promise<void> => {
    if (!draft) {
      return;
    }

    try {
      setIsSaving(true);
      setError(null);
      const saved = await yoinkrClient.settings.update(draft);
      applySettings(saved);
      setDraft(saved);
      setBinaryStatus(await yoinkrClient.tools.getBinaryStatus());
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save settings.');
    } finally {
      setIsSaving(false);
    }
  };

  const reset = async (): Promise<void> => {
    try {
      setError(null);
      const resetSettings = await yoinkrClient.settings.reset();
      applySettings(resetSettings);
      setDraft(resetSettings);
      setBinaryStatus(await yoinkrClient.tools.getBinaryStatus());
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Unable to reset settings.');
    }
  };

  return {
    draft,
    binaryStatus,
    diagnostics,
    error,
    isSaving,
    downloadStates,
    cookieTestResult,
    updateField,
    pickDirectory,
    pickCookiesFile,
    testYtDlpCookies,
    chooseBinaryPath,
    downloadTool,
    save,
    reset,
  };
};
