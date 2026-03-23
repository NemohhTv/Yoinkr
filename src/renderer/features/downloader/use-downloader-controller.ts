import { useMemo, useState } from 'react';

import type {
  DownloadDraft,
  DownloadFormatOption,
  DownloadMediaType,
  DownloadMetadata,
  DownloadUrlValidation,
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
  remuxIfPossible: true,
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
  status: 'queued' | 'staged' | 'processing';
  progressLabel: string;
  mediaType: DownloadMediaType;
  fileType: OutputFormat;
  qualityTarget: DownloadDraft['qualityTarget'];
  audioOnly: boolean;
}

interface DownloaderFormState {
  urlInput: string;
  mediaType: DownloadMediaType;
  fileType: OutputFormat;
  qualityTarget: DownloadDraft['qualityTarget'];
  audioOnly: boolean;
  remuxIfPossible: boolean;
  allowReencodeFallback: boolean;
}

export interface MediaLibraryCard {
  id: string;
  title: string;
  sourceUrl: string;
  state: 'downloaded' | 'edited' | 'imported';
  format: string;
  resolution: string;
  durationText: string;
  sizeText: string;
  locationLabel: string;
  updatedAt: string;
  thumbnailUrl: string;
}

const initialHistoryItems: MediaLibraryCard[] = [
  {
    id: 'history-1',
    title: 'City B-Roll Assembly',
    sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    state: 'downloaded',
    format: 'MP4',
    resolution: '1080p',
    durationText: '08:42',
    sizeText: '412 MB',
    locationLabel: 'Downloads',
    updatedAt: 'Today · 2:14 PM',
    thumbnailUrl: 'https://placehold.co/320x180/111827/FFFFFF?text=City+B-Roll',
  },
  {
    id: 'history-2',
    title: 'Interview Sync Pull',
    sourceUrl: 'https://www.youtube.com/watch?v=LXb3EKWsInQ',
    state: 'edited',
    format: 'MKV',
    resolution: '2160p',
    durationText: '19:06',
    sizeText: '1.8 GB',
    locationLabel: 'Exports',
    updatedAt: 'Yesterday · 9:27 PM',
    thumbnailUrl: 'https://placehold.co/320x180/1f2937/FFFFFF?text=Interview+Sync',
  },
  {
    id: 'history-3',
    title: 'Local Screen Capture',
    sourceUrl: '',
    state: 'imported',
    format: 'MP4',
    resolution: '1440p',
    durationText: '05:18',
    sizeText: '223 MB',
    locationLabel: 'Projects',
    updatedAt: 'Mar 21 · 4:03 PM',
    thumbnailUrl: 'https://placehold.co/320x180/172554/FFFFFF?text=Screen+Capture',
  },
];

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

const getActiveValidation = (
  validation: DownloadUrlValidation[],
  activeValidationUrl: string | null,
): DownloadUrlValidation | null =>
  validation.find((entry) => entry.isValid && entry.normalizedUrl === activeValidationUrl)
  ?? validation.find((entry) => entry.isValid)
  ?? null;

export const useDownloaderController = () => {
  const [form, setForm] = useState<DownloaderFormState>(initialForm);
  const [validation, setValidation] = useState<DownloadUrlValidation[]>([]);
  const [activeValidationUrl, setActiveValidationUrl] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<DownloadMetadata | null>(null);
  const [queueItems, setQueueItems] = useState<QueueCard[]>([]);
  const [historyItems] = useState<MediaLibraryCard[]>(initialHistoryItems);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activityMessage, setActivityMessage] = useState<string | null>(null);

  const activeValidation = useMemo(
    () => getActiveValidation(validation, activeValidationUrl),
    [validation, activeValidationUrl],
  );

  const queueSummary = useMemo(
    () => ({
      total: queueItems.length,
      staged: queueItems.filter((item) => item.status === 'staged').length,
      processing: queueItems.filter((item) => item.status === 'processing').length,
    }),
    [queueItems],
  );

  const activeMetadataFormats = useMemo(
    () => metadata?.availableFormats ?? [],
    [metadata],
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

  const inspectUrl = async (preferredUrl?: string): Promise<DownloadMetadata | null> => {
    const nextValidation = validation.length > 0 ? validation : await validateUrls();
    const nextActive = getActiveValidation(nextValidation, preferredUrl ?? activeValidationUrl);

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
    const nextValidation = validation.length > 0 ? validation : await validateUrls();
    const nextActive = getActiveValidation(nextValidation, activeValidationUrl);

    if (!nextActive) {
      setError('Validate at least one URL before saving a draft.');
      return;
    }

    const nextMetadata = metadata?.normalizedUrl === nextActive.normalizedUrl
      ? metadata
      : await inspectUrl(nextActive.normalizedUrl);

    try {
      setError(null);
      const draft = await yoinkrClient.downloader.enqueueDraft({
        sourceUrl: nextActive.input,
        normalizedUrl: nextActive.normalizedUrl,
        qualityTarget: form.mediaType === 'audio-only' ? 'audio-only' : form.qualityTarget,
        outputFormat: form.fileType,
        audioOnly: form.mediaType === 'audio-only' || form.audioOnly,
        remuxIfPossible: form.remuxIfPossible,
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
          progressLabel: 'Staged for Phase 2 execution',
          mediaType: form.mediaType,
          fileType: draft.outputFormat,
          qualityTarget: draft.qualityTarget,
          audioOnly: draft.audioOnly,
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
    patch: Partial<Pick<QueueCard, 'mediaType' | 'fileType' | 'qualityTarget' | 'audioOnly'>>,
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
    setQueueItems((current) => current.filter((item) => item.id !== id));
    setActivityMessage('Removed staged item from the downloader queue preview.');
  };

  const triggerPlaceholderAction = (message: string): void => {
    setActivityMessage(message);
  };

  return {
    form,
    validation,
    activeValidation,
    metadata,
    activeMetadataFormats,
    availableFileTypes,
    queueItems,
    queueSummary,
    historyItems,
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
    triggerPlaceholderAction,
  };
};
