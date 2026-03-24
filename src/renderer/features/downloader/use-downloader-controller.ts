import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import type {
  AudioPreference,
  DownloadDraft,
  DownloadFormatOption,
  DownloadHistoryRecord,
  DownloadMediaType,
  DownloadMetadata,
  DownloadUrlValidation,
  ItemDownloadProgress,
} from '@shared/types/downloader';
import type { OutputFormat } from '@shared/types/settings';

import { yoinkrClient } from '@renderer/lib/api/yoinkr-client';

const mediaTypeToOutputFormat: Record<DownloadMediaType, OutputFormat[]> = {
  'video-audio': ['mp4', 'mkv', 'webm', 'original'],
  'video-only': ['mp4', 'mkv', 'webm', 'original'],
  'audio-only': ['mp3', 'm4a', 'wav', 'flac'],
};

const initialForm = {
  urlInput: '',
  mediaType: 'video-audio' as DownloadMediaType,
  fileType: 'mp4' as OutputFormat,
  qualityTarget: 'best' as DownloadDraft['qualityTarget'],
  audioOnly: false,
  audioPreference: 'aac' as AudioPreference,
  allowReencodeFallback: false,
};

export interface QueueCard {
  id: string;
  title: string;
  sourceUrl: string;
  thumbnailUrl: string;
  extractor: string;
  durationText: string;
  sizeText: string;
  status: 'queued' | 'staged' | 'downloading' | 'merging' | 'converting' | 'complete' | 'error';
  progressPercent: number;
  progressMessage: string;
  outputPath: string | null;
  mediaType: DownloadMediaType;
  fileType: OutputFormat;
  qualityTarget: DownloadDraft['qualityTarget'];
  audioOnly: boolean;
  audioPreference: AudioPreference;
  allowReencodeFallback: boolean;
}

interface DownloaderFormState {
  urlInput: string;
  mediaType: DownloadMediaType;
  fileType: OutputFormat;
  qualityTarget: DownloadDraft['qualityTarget'];
  audioOnly: boolean;
  audioPreference: AudioPreference;
  allowReencodeFallback: boolean;
}

const outputFormats: OutputFormat[] = ['original', 'mp4', 'mkv', 'webm', 'mp3', 'm4a', 'wav', 'flac'];

const resolveOutputFormat = (value: string | null | undefined, fallback: OutputFormat): OutputFormat =>
  outputFormats.includes((value ?? '') as OutputFormat) ? (value as OutputFormat) : fallback;

const resolveQualityTarget = (
  format: Pick<DownloadFormatOption, 'audioOnly' | 'height'>,
): DownloadDraft['qualityTarget'] => {
  if (format.audioOnly) {
    return 'audio-only';
  }

  if (!format.height) {
    return 'custom';
  }

  if (format.height >= 2160) {
    return '2160p';
  }

  if (format.height >= 1440) {
    return '1440p';
  }

  if (format.height >= 1080) {
    return '1080p';
  }

  if (format.height >= 720) {
    return '720p';
  }

  if (format.height >= 480) {
    return '480p';
  }

  return 'custom';
};

export interface DerivedResolution {
  label: string;
  qualityTarget: DownloadDraft['qualityTarget'];
  height: number;
  fps: number;
}

const deriveResolutions = (formats: DownloadFormatOption[]): DerivedResolution[] => {
  const byHeight = new Map<number, number>();

  for (const f of formats) {
    if (!f.hasVideo || !f.height) continue;
    const fps = f.fps ?? 30;
    const existing = byHeight.get(f.height);
    if (!existing || fps > existing) {
      byHeight.set(f.height, fps);
    }
  }

  return Array.from(byHeight.entries())
    .map(([height, fps]) => ({
      label: `${height}p${fps}`,
      qualityTarget: resolveQualityTarget({ audioOnly: false, height }),
      height,
      fps,
    }))
    .sort((a, b) => b.height - a.height || b.fps - a.fps);
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const estimateSize = (
  formats: DownloadFormatOption[],
  mediaType: DownloadMediaType,
  qualityTarget: DownloadDraft['qualityTarget'],
): string | null => {
  const heightMap: Record<string, number> = { '2160p': 2160, '1440p': 1440, '1080p': 1080, '720p': 720, '480p': 480 };
  const targetHeight = qualityTarget === 'best' ? Infinity : (heightMap[qualityTarget] ?? Infinity);

  if (mediaType === 'audio-only') {
    const best = formats
      .filter((f) => f.hasAudio && !f.hasVideo)
      .sort((a, b) => (b.filesizeBytes ?? b.filesizeApproxBytes ?? 0) - (a.filesizeBytes ?? a.filesizeApproxBytes ?? 0))[0];
    return best?.estimatedSizeText ?? null;
  }

  const videoFormats = formats.filter((f) => f.hasVideo && f.height);
  const matchedVideo =
    targetHeight === Infinity
      ? videoFormats.sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0]
      : videoFormats.filter((f) => (f.height ?? 0) <= targetHeight).sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0]
        ?? videoFormats[videoFormats.length - 1];

  if (!matchedVideo) return null;
  const videoBytes = matchedVideo.filesizeBytes ?? matchedVideo.filesizeApproxBytes ?? 0;

  if (mediaType === 'video-only') {
    return videoBytes > 0 ? formatBytes(videoBytes) : matchedVideo.estimatedSizeText;
  }

  const bestAudio = formats
    .filter((f) => f.hasAudio && !f.hasVideo)
    .sort((a, b) => (b.filesizeBytes ?? b.filesizeApproxBytes ?? 0) - (a.filesizeBytes ?? a.filesizeApproxBytes ?? 0))[0];
  const audioBytes = bestAudio?.filesizeBytes ?? bestAudio?.filesizeApproxBytes ?? 0;
  const total = videoBytes + audioBytes;

  return total > 0 ? formatBytes(total) : matchedVideo.estimatedSizeText;
};

const getActiveValidation = (
  validation: DownloadUrlValidation[],
  activeValidationUrl: string | null,
): DownloadUrlValidation | null =>
  validation.find((entry) => entry.isValid && entry.normalizedUrl === activeValidationUrl)
  ?? validation.find((entry) => entry.isValid)
  ?? null;

const POST_DOWNLOAD_ACTIVITY_MS = 15_000;

export const useDownloaderController = () => {
  const location = useLocation();
  const postDownloadActivityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueItemsRef = useRef<QueueCard[]>([]);

  const [form, setForm] = useState<DownloaderFormState>(initialForm);
  const [validation, setValidation] = useState<DownloadUrlValidation[]>([]);
  const [activeValidationUrl, setActiveValidationUrl] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<DownloadMetadata | null>(null);
  const [queueItems, setQueueItems] = useState<QueueCard[]>([]);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activityMessage, setActivityMessage] = useState<string | null>(null);

  useEffect(() => {
    queueItemsRef.current = queueItems;
  }, [queueItems]);

  const activeValidation = useMemo(
    () => getActiveValidation(validation, activeValidationUrl),
    [validation, activeValidationUrl],
  );

  const clearPostDownloadActivityTimer = useCallback((): void => {
    if (postDownloadActivityTimeoutRef.current) {
      clearTimeout(postDownloadActivityTimeoutRef.current);
      postDownloadActivityTimeoutRef.current = null;
    }
  }, []);

  /** Clears URL validation pills, live metadata preview, and toasts (queue items unchanged). */
  const clearTransientFetchUi = useCallback((): void => {
    setActivityMessage(null);
    setValidation([]);
    setActiveValidationUrl(null);
    setMetadata(null);
  }, []);

  useEffect(() => {
    if (location.pathname !== '/downloader') {
      clearPostDownloadActivityTimer();
      clearTransientFetchUi();
    }
  }, [location.pathname, clearPostDownloadActivityTimer, clearTransientFetchUi]);

  const queueSummary = useMemo(() => {
    const total = queueItems.length;
    const pending = queueItems.filter((i) => i.status === 'staged' || i.status === 'error').length;
    const active = queueItems.filter((i) => i.status === 'downloading' || i.status === 'merging' || i.status === 'converting').length;
    const complete = queueItems.filter((i) => i.status === 'complete').length;
    return { total, pending, active, complete };
  }, [queueItems]);

  const activeMetadataFormats = useMemo(
    () => metadata?.availableFormats ?? [],
    [metadata],
  );

  const derivedResolutions = useMemo(
    () => deriveResolutions(metadata?.availableFormats ?? []),
    [metadata],
  );

  const estimatedSizeText = useMemo(
    () => metadata ? estimateSize(metadata.availableFormats, form.mediaType, form.qualityTarget) : null,
    [metadata, form.mediaType, form.qualityTarget],
  );

  const updateField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]): void => {
    setForm((current) => {
      const next = { ...current, [key]: value };

      if (key === 'mediaType') {
        const nextMediaType = value as DownloadMediaType;
        next.audioOnly = nextMediaType === 'audio-only';
        next.qualityTarget = nextMediaType === 'audio-only' ? 'audio-only' : current.qualityTarget === 'audio-only' ? 'best' : current.qualityTarget;

        if (!mediaTypeToOutputFormat[nextMediaType].includes(next.fileType)) {
          next.fileType = mediaTypeToOutputFormat[nextMediaType][0];
        }
      }

      if (key === 'fileType') {
        next.audioOnly = ['mp3', 'm4a', 'wav', 'flac'].includes(value as OutputFormat);
        if (next.audioOnly) {
          next.mediaType = 'audio-only';
          next.qualityTarget = 'audio-only';
        }
      }

      return next;
    });
  };

  const validateUrls = async (): Promise<DownloadUrlValidation[]> => {
    try {
      setError(null);
      const nextValidation = await yoinkrClient.downloader.validateUrls(form.urlInput);
      setValidation(nextValidation);
      const nextActive = getActiveValidation(nextValidation, activeValidationUrl);
      setActiveValidationUrl(nextActive?.normalizedUrl ?? null);

      if (!nextActive) {
        setMetadata(null);
        setActivityMessage('No valid URLs are ready for inspection yet.');
      } else {
        const validCount = nextValidation.filter((entry) => entry.isValid).length;
        setActivityMessage(
          validCount > 1
            ? `${validCount} URLs are valid. Select one item to inspect.`
            : 'URL is ready for inspection.',
        );
      }

      return nextValidation;
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : 'Unable to validate URLs.');
      return [];
    }
  };

  /**
   * @param validationSnapshot - Pass the array returned from `validateUrls()` when enqueueing so we
   *   don't read stale `validation` state (React hasn't re-rendered yet → wrong video metadata).
   */
  const inspectUrl = async (
    preferredUrl?: string,
    validationSnapshot?: DownloadUrlValidation[],
  ): Promise<DownloadMetadata | null> => {
    let nextValidation =
      validationSnapshot ?? (validation.length > 0 ? validation : await validateUrls());
    let nextActive = getActiveValidation(nextValidation, preferredUrl ?? activeValidationUrl);

    // Belt-and-suspenders: if caller passed a URL but state/snapshot didn't contain it, refresh once.
    if (preferredUrl && nextActive?.normalizedUrl !== preferredUrl) {
      nextValidation = await validateUrls();
      nextActive = getActiveValidation(nextValidation, preferredUrl);
    }

    if (!nextActive) {
      setMetadata(null);
      setError('Enter at least one valid URL before inspecting metadata.');
      return null;
    }

    try {
      setIsLoadingMetadata(true);
      setError(null);
      setActiveValidationUrl(nextActive.normalizedUrl);
      const nextMetadata = await yoinkrClient.downloader.getMetadata(nextActive.normalizedUrl);
      setMetadata(nextMetadata);
      setActivityMessage(`Metadata preview ready for ${nextMetadata.extractor}.`);
      return nextMetadata;
    } catch (metadataError) {
      setError(metadataError instanceof Error ? metadataError.message : 'Unable to load metadata.');
      return null;
    } finally {
      setIsLoadingMetadata(false);
    }
  };

  const enqueueDraft = async (): Promise<void> => {
    const nextValidation = await validateUrls();
    const nextActive = getActiveValidation(nextValidation, null);

    if (!nextActive) {
      setError('Validate at least one URL before saving a draft.');
      return;
    }

    const nextMetadata = await inspectUrl(nextActive.normalizedUrl, nextValidation);

    try {
      setError(null);
      const draft = await yoinkrClient.downloader.enqueueDraft({
        sourceUrl: nextActive.input,
        normalizedUrl: nextActive.normalizedUrl,
        qualityTarget: form.mediaType === 'audio-only' ? 'audio-only' : form.qualityTarget,
        outputFormat: form.fileType,
        audioOnly: form.mediaType === 'audio-only' || form.audioOnly,
        remuxIfPossible: true,
        allowReencodeFallback: form.allowReencodeFallback,
      });
      setQueueItems((current) => [
        {
          id: draft.id,
          title: nextMetadata?.title ?? 'Queued download draft',
          sourceUrl: draft.normalizedUrl,
          thumbnailUrl: nextMetadata?.thumbnailUrl || 'https://placehold.co/320x180/111827/FFFFFF?text=Queued+Item',
          extractor: nextMetadata?.extractor ?? new URL(draft.normalizedUrl).hostname,
          durationText: nextMetadata?.durationText ?? 'Pending',
          sizeText: nextMetadata?.availableFormats[0]?.estimatedSizeText ?? 'Pending',
          status: 'staged',
          progressPercent: 0,
          progressMessage: '',
          outputPath: null,
          mediaType: form.mediaType,
          fileType: draft.outputFormat,
          qualityTarget: draft.qualityTarget,
          audioOnly: draft.audioOnly,
          audioPreference: form.audioPreference,
          allowReencodeFallback: form.allowReencodeFallback,
        },
        ...current,
      ]);
      setActivityMessage('Download draft added to the integrated queue.');
    } catch (draftError) {
      setError(draftError instanceof Error ? draftError.message : 'Unable to save draft.');
    }
  };

  const selectActiveValidation = (normalizedUrl: string): void => {
    setActiveValidationUrl(normalizedUrl);
    if (metadata?.normalizedUrl !== normalizedUrl) {
      setMetadata(null);
    }
  };

  const applyFormatSuggestion = (format: DownloadFormatOption): void => {
    const nextMediaType: DownloadMediaType = format.audioOnly
      ? 'audio-only'
      : format.videoOnly
        ? 'video-only'
        : 'video-audio';

    setForm((current) => {
      const nextFileType = resolveOutputFormat(format.ext, current.fileType);
      return {
        ...current,
        mediaType: nextMediaType,
        fileType: mediaTypeToOutputFormat[nextMediaType].includes(nextFileType)
          ? nextFileType
          : mediaTypeToOutputFormat[nextMediaType][0],
        qualityTarget: resolveQualityTarget(format),
        audioOnly: nextMediaType === 'audio-only',
      };
    });

    setActivityMessage(`Selected ${format.label} from the live metadata list.`);
  };

  const updateQueueItem = (
    id: string,
    patch: Partial<Pick<QueueCard, 'mediaType' | 'fileType' | 'qualityTarget' | 'audioOnly' | 'audioPreference' | 'allowReencodeFallback'>>,
  ): void => {
    setQueueItems((current) =>
      current.map((item) => {
        if (item.id !== id) {
          return item;
        }

        const next = { ...item, ...patch };

        if (patch.mediaType) {
          next.audioOnly = patch.mediaType === 'audio-only';
          next.qualityTarget = patch.mediaType === 'audio-only'
            ? 'audio-only'
            : next.qualityTarget === 'audio-only'
              ? 'best'
              : next.qualityTarget;

          if (!mediaTypeToOutputFormat[patch.mediaType].includes(next.fileType)) {
            next.fileType = mediaTypeToOutputFormat[patch.mediaType][0];
          }
        }

        if (patch.fileType) {
          next.audioOnly = ['mp3', 'm4a', 'wav', 'flac'].includes(patch.fileType);
          if (next.audioOnly) {
            next.mediaType = 'audio-only';
            next.qualityTarget = 'audio-only';
          }
        }

        return next;
      }),
    );
  };

  const availableFileTypes = useMemo(
    () => mediaTypeToOutputFormat[form.mediaType],
    [form.mediaType],
  );

  const removeQueueItem = (id: string): void => {
    const item = queueItems.find((q) => q.id === id);
    setQueueItems((current) => current.filter((q) => q.id !== id));
    if (item?.status === 'complete') {
      yoinkrClient.downloader.deleteHistory(id).catch(() => {});
    }
    setActivityMessage('Removed item from queue.');
  };

  useEffect(() => {
    yoinkrClient.downloader.getHistory().then((records) => {
      const historyCards: QueueCard[] = records.map((r) => ({
        id: r.id,
        title: r.title,
        sourceUrl: r.sourceUrl,
        thumbnailUrl: r.thumbnailUrl,
        extractor: r.extractor,
        durationText: r.durationText,
        sizeText: r.sizeText,
        status: 'complete' as const,
        progressPercent: 100,
        progressMessage: 'Download complete',
        outputPath: r.outputPath,
        mediaType: r.mediaType,
        fileType: r.fileType,
        qualityTarget: r.qualityTarget,
        audioOnly: r.mediaType === 'audio-only',
        audioPreference: 'aac' as AudioPreference,
        allowReencodeFallback: false,
      }));
      if (historyCards.length > 0) {
        setQueueItems((current) => {
          const existingIds = new Set(current.map((c) => c.id));
          const newCards = historyCards.filter((h) => !existingIds.has(h.id));
          return [...current, ...newCards];
        });
      }
    }).catch(() => {});
  }, []);

  const unsubItemProgressRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    unsubItemProgressRef.current = yoinkrClient.downloader.onItemProgress((progress: ItemDownloadProgress) => {
      setQueueItems((current) =>
        current.map((item) => {
          if (item.id !== progress.id) return item;
          return {
            ...item,
            status: progress.phase,
            progressPercent: progress.percent,
            progressMessage: progress.message,
          };
        }),
      );
    });

    return () => {
      unsubItemProgressRef.current?.();
    };
  }, []);

  const downloadItem = useCallback(async (id: string): Promise<void> => {
    const item = queueItemsRef.current.find((q) => q.id === id);
    if (!item || item.status === 'downloading' || item.status === 'merging' || item.status === 'converting') return;

    setQueueItems((current) =>
      current.map((q) =>
        q.id === id
          ? {
              ...q,
              status: 'downloading' as const,
              progressPercent: 0,
              progressMessage: 'Starting...',
              outputPath: null,
            }
          : q,
      ),
    );

    try {
      const result = await yoinkrClient.downloader.startItem({
        id: item.id,
        url: item.sourceUrl,
        mediaType: item.mediaType,
        qualityTarget: item.qualityTarget,
        outputFormat: item.fileType,
        audioOnly: item.audioOnly,
        audioPreference: item.audioPreference,
        allowReencodeFallback: item.allowReencodeFallback,
        title: item.title,
      });

      setQueueItems((current) =>
        current.map((q) => {
          if (q.id !== id) return q;
          return {
            ...q,
            status: result.success ? 'complete' : 'error',
            progressPercent: result.success ? 100 : 0,
            progressMessage: result.success ? 'Download complete!' : (result.error ?? 'Download failed.'),
            outputPath: result.outputPath ?? null,
          };
        }),
      );

      if (result.success) {
        setValidation([]);
        setActiveValidationUrl(null);
        setMetadata(null);
        setActivityMessage(`Downloaded: ${item.title}`);
        clearPostDownloadActivityTimer();
        postDownloadActivityTimeoutRef.current = setTimeout(() => {
          setActivityMessage(null);
          postDownloadActivityTimeoutRef.current = null;
        }, POST_DOWNLOAD_ACTIVITY_MS);
        const historyRecord: DownloadHistoryRecord = {
          id: item.id,
          title: item.title,
          sourceUrl: item.sourceUrl,
          thumbnailUrl: item.thumbnailUrl,
          extractor: item.extractor,
          durationText: item.durationText,
          sizeText: item.sizeText,
          mediaType: item.mediaType,
          fileType: item.fileType,
          qualityTarget: item.qualityTarget,
          outputPath: result.outputPath ?? null,
          completedAt: new Date().toISOString(),
        };
        yoinkrClient.downloader.saveHistory(historyRecord).catch(() => {});
      } else {
        setError(result.error ?? 'Download failed.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Download failed.';
      setError(message);
      setQueueItems((current) =>
        current.map((q) =>
          q.id === id ? { ...q, status: 'error' as const, progressPercent: 0, progressMessage: message } : q,
        ),
      );
    }
  }, [clearPostDownloadActivityTimer]);

  const cancelItem = useCallback(async (id: string): Promise<void> => {
    try {
      await yoinkrClient.downloader.cancelItem(id);
      setQueueItems((current) =>
        current.map((q) =>
          q.id === id ? { ...q, status: 'error' as const, progressPercent: 0, progressMessage: 'Cancelled' } : q,
        ),
      );
      setActivityMessage('Download cancelled.');
    } catch {
      setError('Could not cancel download.');
    }
  }, []);

  const revealFile = useCallback(async (outputPath: string): Promise<void> => {
    try {
      await yoinkrClient.app.revealPath(outputPath);
    } catch {
      setError('Could not open file location.');
    }
  }, []);

  const pasteFromClipboard = useCallback(async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setForm((current) => ({ ...current, urlInput: text.trim() }));
      }
    } catch {
      /* clipboard access denied — no-op */
    }
  }, []);

  const triggerPlaceholderAction = (message: string): void => {
    setActivityMessage(message);
  };

  return {
    form,
    validation,
    activeValidation,
    metadata,
    activeMetadataFormats,
    derivedResolutions,
    estimatedSizeText,
    availableFileTypes,
    queueItems,
    queueSummary,
    isLoadingMetadata,
    error,
    activityMessage,
    updateField,
    validateUrls,
    inspectUrl,
    enqueueDraft,
    selectActiveValidation,
    applyFormatSuggestion,
    updateQueueItem,
    removeQueueItem,
    downloadItem,
    cancelItem,
    revealFile,
    pasteFromClipboard,
    triggerPlaceholderAction,
  };
};
