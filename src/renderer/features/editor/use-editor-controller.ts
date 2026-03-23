import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useLocation } from 'react-router-dom';

import type {
  EditorCutMode,
  EditorExportMode,
  EditorExportPreview,
  EditorOpenRequest,
  EditorOpenResult,
  EditorSegment,
  EditorTimelineAssets,
} from '@shared/types/editor';

import { yoinkrClient } from '@renderer/lib/api/yoinkr-client';

const formatTimecode = (seconds: number): string => {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${wholeSeconds
    .toString()
    .padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
};

const parseTimecodeInput = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const parts = trimmed.split(':');
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }

  const [hoursPart, minutesPart, secondsPart] =
    parts.length === 3 ? parts : ['0', parts[0] ?? '0', parts[1] ?? '0'];
  const hours = Number.parseInt(hoursPart, 10);
  const minutes = Number.parseInt(minutesPart, 10);
  const seconds = Number.parseFloat(secondsPart);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const findPreviousKeyframe = (keyframeTimes: number[], targetSeconds: number): number | null => {
  if (keyframeTimes.length === 0) {
    return null;
  }

  let candidate = keyframeTimes[0] ?? null;
  for (const keyframeTime of keyframeTimes) {
    if (keyframeTime > targetSeconds) {
      break;
    }
    candidate = keyframeTime;
  }
  return candidate;
};

const findNextKeyframe = (keyframeTimes: number[], targetSeconds: number): number | null => {
  for (const keyframeTime of keyframeTimes) {
    if (keyframeTime >= targetSeconds) {
      return keyframeTime;
    }
  }
  return keyframeTimes[keyframeTimes.length - 1] ?? null;
};

const createSegmentId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `segment-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const toFileUrl = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const prefixed = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return encodeURI(`file://${prefixed}`);
};

const buildMergedFileName = (sourcePath: string): string => {
  const separatorIndex = Math.max(sourcePath.lastIndexOf('/'), sourcePath.lastIndexOf('\\'));
  const fileName = separatorIndex >= 0 ? sourcePath.slice(separatorIndex + 1) : sourcePath;
  const extensionIndex = fileName.lastIndexOf('.');
  if (extensionIndex === -1) {
    return `${fileName}_merged`;
  }

  return `${fileName.slice(0, extensionIndex)}_merged${fileName.slice(extensionIndex)}`;
};

const buildSingleCutFileName = (sourcePath: string): string => {
  const separatorIndex = Math.max(sourcePath.lastIndexOf('/'), sourcePath.lastIndexOf('\\'));
  const fileName = separatorIndex >= 0 ? sourcePath.slice(separatorIndex + 1) : sourcePath;
  const extensionIndex = fileName.lastIndexOf('.');
  if (extensionIndex === -1) {
    return `${fileName}_cut`;
  }

  return `${fileName.slice(0, extensionIndex)}_cut${fileName.slice(extensionIndex)}`;
};

const isEditableElement = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }

  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.isContentEditable;
};

export const useEditorController = () => {
  const location = useLocation();
  const previewRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const lastHandledRouteKeyRef = useRef<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [openResult, setOpenResult] = useState<EditorOpenResult | null>(null);
  const [timelineAssets, setTimelineAssets] = useState<EditorTimelineAssets | null>(null);
  const [segments, setSegments] = useState<EditorSegment[]>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [segmentLabel, setSegmentLabel] = useState('');
  const [cutMode, setCutMode] = useState<EditorCutMode>('auto');
  const [exportMode, setExportMode] = useState<EditorExportMode>('single-cut');
  const [outputDirectory, setOutputDirectory] = useState<string | null>(null);
  const [outputFilePath, setOutputFilePath] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [previewDuration, setPreviewDuration] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [isLoadingSource, setIsLoadingSource] = useState(false);
  const [isLoadingTimelineAssets, setIsLoadingTimelineAssets] = useState(false);
  const [isPlanningExport, setIsPlanningExport] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [activityMessage, setActivityMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [selection, setSelection] = useState({ inPointSeconds: 0, outPointSeconds: 0 });
  const [selectionInputs, setSelectionInputs] = useState({ inPoint: '00:00:00.000', outPoint: '00:00:00.000' });
  const [exportPreview, setExportPreview] = useState<EditorExportPreview | null>(null);
  const [exportJob, setExportJob] = useState<{
    status: 'idle' | 'exporting' | 'complete' | 'error';
    message: string | null;
    outputPaths: string[];
  }>({
    status: 'idle',
    message: null,
    outputPaths: [],
  });

  const sourceDuration = openResult?.mediaInfo.durationSeconds ?? previewDuration ?? 0;
  const previewUrl = openResult ? toFileUrl(openResult.source.sourcePath) : null;
  const isAudioOnly = Boolean(openResult?.source.hasAudio && !openResult?.source.hasVideo);
  const keyframeTimes = useMemo(() => openResult?.mediaInfo.keyframeTimes ?? [], [openResult?.mediaInfo.keyframeTimes]);
  const keyframeMarkers = useMemo(
    () =>
      keyframeTimes.map((timeSeconds, index) => ({
        id: `keyframe-${index + 1}`,
        timeSeconds,
        percent: sourceDuration > 0 ? (timeSeconds / sourceDuration) * 100 : 0,
      })),
    [keyframeTimes, sourceDuration],
  );
  const timelineThumbnails = useMemo(
    () =>
      (timelineAssets?.thumbnails ?? []).map((thumbnail) => ({
        ...thumbnail,
        fileUrl: toFileUrl(thumbnail.imagePath),
      })),
    [timelineAssets],
  );
  const waveformUrl = timelineAssets?.waveformImagePath ? toFileUrl(timelineAssets.waveformImagePath) : null;

  const syncSelectionInputs = useCallback((inPointSeconds: number, outPointSeconds: number) => {
    setSelectionInputs({
      inPoint: formatTimecode(inPointSeconds),
      outPoint: formatTimecode(outPointSeconds),
    });
  }, []);

  const resetEditorState = useCallback((result: EditorOpenResult) => {
    const duration = result.mediaInfo.durationSeconds ?? 0;
    setOpenResult(result);
    setTimelineAssets(null);
    setSegments([]);
    setSelectedSegmentId(null);
    setSegmentLabel('');
    setCutMode('auto');
    setExportMode('single-cut');
    setOutputDirectory(null);
    setOutputFilePath(null);
    setCurrentTime(0);
    setIsPlaying(false);
    setTimelineZoom(1);
    setPreviewDuration(result.mediaInfo.durationSeconds);
    setPreviewError(null);
    setExportPreview(null);
    setExportJob({ status: 'idle', message: null, outputPaths: [] });
    setSelection({ inPointSeconds: 0, outPointSeconds: duration });
    syncSelectionInputs(0, duration);
  }, [syncSelectionInputs]);

  const openSource = useCallback(async (request: EditorOpenRequest) => {
    setIsLoadingSource(true);
    setError(null);
    setActivityMessage(null);

    try {
      const result = await yoinkrClient.editor.openSource(request);
      resetEditorState(result);
      setActivityMessage(`Loaded ${result.source.displayName} into the editor.`);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'Unable to open the selected file.');
    } finally {
      setIsLoadingSource(false);
    }
  }, [resetEditorState]);

  useEffect(() => {
    const routeState = location.state as EditorOpenRequest | null;
    if (!routeState?.sourcePath || lastHandledRouteKeyRef.current === location.key) {
      return;
    }

    lastHandledRouteKeyRef.current = location.key;
    void openSource(routeState);
  }, [location.key, location.state, openSource]);

  useEffect(() => {
    if (!openResult) {
      setTimelineAssets(null);
      return;
    }

    let cancelled = false;

    const loadTimelineAssets = async (): Promise<void> => {
      try {
        setIsLoadingTimelineAssets(true);
        const assets = await yoinkrClient.editor.getTimelineAssets(openResult.source.sourcePath);
        if (!cancelled) {
          setTimelineAssets(assets);
        }
      } catch {
        if (!cancelled) {
          setTimelineAssets({ thumbnails: [], waveformImagePath: null, warnings: ['Timeline assets could not be generated for this source.'] });
        }
      } finally {
        if (!cancelled) {
          setIsLoadingTimelineAssets(false);
        }
      }
    };

    void loadTimelineAssets();

    return () => {
      cancelled = true;
    };
  }, [openResult]);

  const pickSourceFile = useCallback(async (): Promise<void> => {
    try {
      const sourcePath = await yoinkrClient.editor.pickSourceFile();
      if (!sourcePath) {
        return;
      }

      await openSource({
        sourcePath,
        sourceKind: 'local',
        titleHint: null,
        sourceUrl: null,
        autoLoad: true,
      });
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : 'Unable to choose a source file.');
    }
  }, [openSource]);

  const onDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragActive(true);
  }, []);

  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragActive(false);
  }, []);

  const onDrop = useCallback(async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragActive(false);

    const file = Array.from(event.dataTransfer.files)[0] as (File & { path?: string }) | undefined;
    const droppedPath = file ? yoinkrClient.app.resolveFilePath(file)?.trim() || file.path?.trim() : '';
    if (!droppedPath) {
      setError('Could not read the dropped file path. Use the file picker instead.');
      return;
    }

    await openSource({
      sourcePath: droppedPath,
      sourceKind: 'local',
      titleHint: file.name,
      sourceUrl: null,
      autoLoad: true,
    });
  }, [openSource]);

  const seekTo = useCallback((nextSeconds: number) => {
    const element = previewRef.current;
    if (!element) {
      return;
    }

    const bounded = clamp(nextSeconds, 0, sourceDuration || nextSeconds);
    element.currentTime = bounded;
    setCurrentTime(bounded);
  }, [sourceDuration]);

  const togglePlayback = useCallback(async () => {
    const element = previewRef.current;
    if (!element) {
      return;
    }

    if (element.paused) {
      await element.play().catch(() => {});
      setIsPlaying(!element.paused);
      return;
    }

    element.pause();
    setIsPlaying(false);
  }, []);

  const stepBy = useCallback((deltaSeconds: number) => {
    seekTo(currentTime + deltaSeconds);
  }, [currentTime, seekTo]);

  const stepToPreviousKeyframe = useCallback(() => {
    const previousKeyframe = findPreviousKeyframe(keyframeTimes, Math.max(0, currentTime - 0.001));
    if (previousKeyframe !== null) {
      seekTo(previousKeyframe);
    }
  }, [currentTime, keyframeTimes, seekTo]);

  const stepToNextKeyframe = useCallback(() => {
    const nextKeyframe = findNextKeyframe(keyframeTimes, currentTime + 0.001);
    if (nextKeyframe !== null) {
      seekTo(nextKeyframe);
    }
  }, [currentTime, keyframeTimes, seekTo]);

  const setSelectionRange = useCallback((inPointSeconds: number, outPointSeconds: number) => {
    const boundedIn = clamp(inPointSeconds, 0, sourceDuration || inPointSeconds);
    const boundedOut = clamp(outPointSeconds, boundedIn, sourceDuration || outPointSeconds);
    setSelection({ inPointSeconds: boundedIn, outPointSeconds: boundedOut });
    syncSelectionInputs(boundedIn, boundedOut);
  }, [sourceDuration, syncSelectionInputs]);

  const setInToCurrent = useCallback(() => {
    setSelectionRange(currentTime, Math.max(currentTime, selection.outPointSeconds));
  }, [currentTime, selection.outPointSeconds, setSelectionRange]);

  const setOutToCurrent = useCallback(() => {
    setSelectionRange(Math.min(selection.inPointSeconds, currentTime), currentTime);
  }, [currentTime, selection.inPointSeconds, setSelectionRange]);

  const snapInToKeyframe = useCallback(() => {
    const snapped = findPreviousKeyframe(keyframeTimes, selection.inPointSeconds);
    if (snapped !== null) {
      setSelectionRange(snapped, selection.outPointSeconds);
      setActivityMessage(`Snapped in point to keyframe at ${formatTimecode(snapped)}.`);
    }
  }, [keyframeTimes, selection.inPointSeconds, selection.outPointSeconds, setSelectionRange]);

  const snapOutToKeyframe = useCallback(() => {
    const snapped = findNextKeyframe(keyframeTimes, selection.outPointSeconds);
    if (snapped !== null) {
      setSelectionRange(selection.inPointSeconds, snapped);
      setActivityMessage(`Snapped out point to keyframe at ${formatTimecode(snapped)}.`);
    }
  }, [keyframeTimes, selection.inPointSeconds, selection.outPointSeconds, setSelectionRange]);

  const jumpToInPoint = useCallback(() => {
    seekTo(selection.inPointSeconds);
  }, [seekTo, selection.inPointSeconds]);

  const jumpToOutPoint = useCallback(() => {
    seekTo(selection.outPointSeconds);
  }, [seekTo, selection.outPointSeconds]);

  const updateSelectionInput = useCallback((field: 'inPoint' | 'outPoint', value: string) => {
    setSelectionInputs((current) => ({ ...current, [field]: value }));
  }, []);

  const commitSelectionInput = useCallback((field: 'inPoint' | 'outPoint') => {
    const parsed = parseTimecodeInput(selectionInputs[field]);
    if (parsed === null) {
      syncSelectionInputs(selection.inPointSeconds, selection.outPointSeconds);
      return;
    }

    if (field === 'inPoint') {
      setSelectionRange(parsed, selection.outPointSeconds);
      return;
    }

    setSelectionRange(selection.inPointSeconds, parsed);
  }, [selection.inPointSeconds, selection.outPointSeconds, selectionInputs, setSelectionRange, syncSelectionInputs]);

  const addSegment = useCallback(() => {
    const { inPointSeconds, outPointSeconds } = selection;
    if (outPointSeconds <= inPointSeconds) {
      setError('Out point must be after the in point before you create a segment.');
      return;
    }

    const nextSegment: EditorSegment = {
      id: createSegmentId(),
      label: segmentLabel.trim() || `Clip ${segments.length + 1}`,
      requestedStartSeconds: inPointSeconds,
      requestedEndSeconds: outPointSeconds,
      selected: true,
      exportStatus: 'planned',
    };

    setSegments((current) => [...current, nextSegment]);
    setSelectedSegmentId(nextSegment.id);
    setSegmentLabel(nextSegment.label);
    setError(null);
    setActivityMessage(`Added segment ${nextSegment.label}.`);
  }, [segmentLabel, segments.length, selection]);

  const loadSegment = useCallback((segmentId: string) => {
    const segment = segments.find((item) => item.id === segmentId);
    if (!segment) {
      return;
    }

    setSelectedSegmentId(segmentId);
    setSegmentLabel(segment.label);
    setSelectionRange(segment.requestedStartSeconds, segment.requestedEndSeconds);
    seekTo(segment.requestedStartSeconds);
  }, [segments, seekTo, setSelectionRange]);

  const updateSelectedSegment = useCallback(() => {
    if (!selectedSegmentId) {
      setError('Select a segment before applying changes.');
      return;
    }

    setSegments((current) =>
      current.map((segment) =>
        segment.id === selectedSegmentId
          ? {
            ...segment,
            label: segmentLabel.trim() || segment.label,
            requestedStartSeconds: selection.inPointSeconds,
            requestedEndSeconds: selection.outPointSeconds,
          }
          : segment,
      ),
    );
    setActivityMessage('Updated the selected segment.');
    setError(null);
  }, [selectedSegmentId, segmentLabel, selection.inPointSeconds, selection.outPointSeconds]);

  const removeSegment = useCallback((segmentId: string) => {
    setSegments((current) => current.filter((segment) => segment.id !== segmentId));
    if (selectedSegmentId === segmentId) {
      setSelectedSegmentId(null);
      setSegmentLabel('');
    }
  }, [selectedSegmentId]);

  const moveSegment = useCallback((segmentId: string, direction: -1 | 1) => {
    setSegments((current) => {
      const index = current.findIndex((segment) => segment.id === segmentId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  }, []);

  const toggleSegmentSelected = useCallback((segmentId: string) => {
    setSegments((current) =>
      current.map((segment) =>
        segment.id === segmentId ? { ...segment, selected: !segment.selected } : segment,
      ),
    );
  }, []);

  const duplicateSegment = useCallback((segmentId: string) => {
    setSegments((current) => {
      const index = current.findIndex((segment) => segment.id === segmentId);
      const segment = current[index];
      if (!segment) {
        return current;
      }

      const duplicate: EditorSegment = {
        ...segment,
        id: createSegmentId(),
        label: `${segment.label} Copy`,
      };

      const next = [...current];
      next.splice(index + 1, 0, duplicate);
      return next;
    });
  }, []);

  const pickExportDirectory = useCallback(async (): Promise<void> => {
    try {
      const nextDirectory = await yoinkrClient.editor.pickExportDirectory();
      if (nextDirectory) {
        setOutputDirectory(nextDirectory);
      }
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : 'Unable to choose an export folder.');
    }
  }, []);

  const pickExportFile = useCallback(async (): Promise<void> => {
    if (!openResult) {
      return;
    }

    try {
      const nextFile = await yoinkrClient.editor.pickExportFile(buildMergedFileName(openResult.source.fileName));
      if (nextFile) {
        setOutputFilePath(nextFile);
      }
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : 'Unable to choose an export destination.');
    }
  }, [openResult]);

  const workingSegments = useMemo<EditorSegment[]>(() => {
    const selectedSegments = segments.filter((segment) => segment.selected);
    if (selectedSegments.length > 0) {
      return selectedSegments;
    }

    if (selection.outPointSeconds <= selection.inPointSeconds) {
      return [];
    }

    return [
      {
        id: 'selection-preview',
        label: segmentLabel.trim() || 'Current selection',
        requestedStartSeconds: selection.inPointSeconds,
        requestedEndSeconds: selection.outPointSeconds,
        selected: true,
        exportStatus: 'planned',
      },
    ];
  }, [segmentLabel, segments, selection.inPointSeconds, selection.outPointSeconds]);

  const refreshExportPreview = useCallback(async (): Promise<void> => {
    if (!openResult || workingSegments.length === 0) {
      setExportPreview(null);
      return;
    }

    try {
      setIsPlanningExport(true);
      const preview = await yoinkrClient.editor.previewExport({
        sourcePath: openResult.source.sourcePath,
        sourceKind: openResult.source.sourceKind,
        segments: workingSegments,
        exportMode,
        cutMode,
        outputDirectory,
        outputFilePath,
        baseName: openResult.source.displayName,
        preserveOriginal: true,
      });
      setExportPreview(preview);
    } catch (previewError) {
      setExportPreview(null);
      setError(previewError instanceof Error ? previewError.message : 'Unable to preview the export.');
    } finally {
      setIsPlanningExport(false);
    }
  }, [cutMode, exportMode, openResult, outputDirectory, outputFilePath, workingSegments]);

  useEffect(() => {
    void refreshExportPreview();
  }, [refreshExportPreview]);

  const exportMedia = useCallback(async (): Promise<void> => {
    if (!openResult) {
      setError('Open a source file before exporting.');
      return;
    }
    if (workingSegments.length === 0) {
      setError('Create at least one valid segment or selection before exporting.');
      return;
    }

    setIsExporting(true);
    setError(null);
    setActivityMessage(null);
    setExportJob({ status: 'exporting', message: 'Exporting...', outputPaths: [] });

    try {
      let nextOutputDirectory = outputDirectory;
      let nextOutputFilePath = outputFilePath;

      if ((exportMode === 'separate-files' || exportMode === 'merge-and-separate') && !nextOutputDirectory) {
        nextOutputDirectory = await yoinkrClient.editor.pickExportDirectory();
        setOutputDirectory(nextOutputDirectory);
        if (!nextOutputDirectory) {
          return;
        }
      }
      if ((exportMode === 'single-cut' || exportMode === 'merge-cuts' || exportMode === 'merge-and-separate') && !nextOutputFilePath) {
        const suggestedName = exportMode === 'single-cut'
          ? buildSingleCutFileName(openResult.source.fileName)
          : buildMergedFileName(openResult.source.fileName);
        nextOutputFilePath = await yoinkrClient.editor.pickExportFile(suggestedName);
        setOutputFilePath(nextOutputFilePath);
        if (!nextOutputFilePath) {
          return;
        }
      }

      const preview = await yoinkrClient.editor.previewExport({
        sourcePath: openResult.source.sourcePath,
        sourceKind: openResult.source.sourceKind,
        segments: workingSegments,
        exportMode,
        cutMode,
        outputDirectory: nextOutputDirectory,
        outputFilePath: nextOutputFilePath,
        baseName: openResult.source.displayName,
        preserveOriginal: true,
      });
      setExportPreview(preview);

      const result = await yoinkrClient.editor.exportMedia({
        sourcePath: openResult.source.sourcePath,
        sourceKind: openResult.source.sourceKind,
        segments: workingSegments,
        exportMode,
        cutMode,
        outputDirectory: nextOutputDirectory,
        outputFilePath: nextOutputFilePath,
        baseName: openResult.source.displayName,
        preserveOriginal: true,
      });

      setExportPreview(result.preview);
      setExportJob({
        status: 'complete',
        message: result.message,
        outputPaths: result.outputPaths,
      });
      setActivityMessage(result.message);
    } catch (exportError) {
      const message = exportError instanceof Error ? exportError.message : 'Export failed.';
      setError(message);
      setExportJob({
        status: 'error',
        message,
        outputPaths: [],
      });
    } finally {
      setIsExporting(false);
    }
  }, [cutMode, exportMode, openResult, outputDirectory, outputFilePath, workingSegments]);

  const revealOutputPath = useCallback(async (targetPath: string): Promise<void> => {
    try {
      await yoinkrClient.app.revealPath(targetPath);
    } catch {
      setError('Could not reveal that path.');
    }
  }, []);

  const previewWarnings = useMemo(() => {
    if (!openResult) {
      return [];
    }

    const warnings = [...openResult.mediaInfo.warnings];
    warnings.push(...(timelineAssets?.warnings ?? []));
    if (!openResult.source.previewSupported) {
      warnings.push('Preview playback depends on Chromium codec support. Probe/export can still work even when preview does not.');
    }
    if ((exportMode === 'merge-cuts' || exportMode === 'merge-and-separate') && !openResult.mediaInfo.mergeCutsSupported) {
      warnings.push('Merged stream-copy export is not supported for this source container in the current slice.');
    }
    if (openResult.mediaInfo.hasVideo) {
      if (openResult.mediaInfo.keyframeAnalysisStatus === 'available') {
        warnings.push('Lossless export snaps segment boundaries to surrounding keyframes so clip points stay deterministic.');
      } else {
        warnings.push(openResult.mediaInfo.keyframeAnalysisMessage ?? 'Keyframe-safe boundaries could not be verified for this source.');
      }
    } else {
      warnings.push('Audio-only exports can stay exact because they do not depend on video keyframes.');
    }
    return warnings;
  }, [exportMode, openResult, timelineAssets?.warnings]);

  useEffect(() => {
    if (!openResult) {
      return;
    }

    const handleKeyDown = async (event: KeyboardEvent): Promise<void> => {
      if (isEditableElement(event.target)) {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        await togglePlayback();
        return;
      }

      if (event.key.toLowerCase() === 'i') {
        event.preventDefault();
        setInToCurrent();
        return;
      }

      if (event.key.toLowerCase() === 'o') {
        event.preventDefault();
        setOutToCurrent();
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (event.shiftKey) {
          stepToPreviousKeyframe();
        } else {
          stepBy(-1 / 30);
        }
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (event.shiftKey) {
          stepToNextKeyframe();
        } else {
          stepBy(1 / 30);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openResult, setInToCurrent, setOutToCurrent, stepBy, stepToNextKeyframe, stepToPreviousKeyframe, togglePlayback]);

  const timelineWindow = useMemo(() => {
    const visibleDuration = sourceDuration > 0 ? Math.max(4, sourceDuration / Math.max(1, timelineZoom)) : 0;
    const half = visibleDuration / 2;
    const startSeconds = Math.max(0, currentTime - half);
    const endSeconds = Math.min(sourceDuration, startSeconds + visibleDuration);
    return {
      zoom: timelineZoom,
      startSeconds,
      endSeconds: Math.max(endSeconds, startSeconds),
      visibleDuration: Math.max(visibleDuration, 0),
    };
  }, [currentTime, sourceDuration, timelineZoom]);

  return {
    previewRef,
    isDragActive,
    openResult,
    timelineAssets,
    segments,
    workingSegments,
    selectedSegmentId,
    segmentLabel,
    cutMode,
    exportMode,
    exportPreview,
    exportJob,
    outputDirectory,
    outputFilePath,
    currentTime,
    sourceDuration,
    previewUrl,
    isAudioOnly,
    selection,
    selectionInputs,
    isPlaying,
    timelineZoom,
    timelineWindow,
    isLoadingSource,
    isLoadingTimelineAssets,
    isPlanningExport,
    isExporting,
    activityMessage,
    error,
    previewError,
    previewWarnings,
    keyframeTimes,
    keyframeMarkers,
    timelineThumbnails,
    waveformUrl,
    setSegmentLabel,
    setCutMode,
    setExportMode,
    setTimelineZoom,
    onDragEnter,
    onDragLeave,
    onDrop,
    pickSourceFile,
    pickExportDirectory,
    pickExportFile,
    seekTo,
    stepBy,
    stepToPreviousKeyframe,
    stepToNextKeyframe,
    togglePlayback,
    setInToCurrent,
    setOutToCurrent,
    snapInToKeyframe,
    snapOutToKeyframe,
    jumpToInPoint,
    jumpToOutPoint,
    setSelectionRange,
    updateSelectionInput,
    commitSelectionInput,
    addSegment,
    loadSegment,
    updateSelectedSegment,
    removeSegment,
    moveSegment,
    toggleSegmentSelected,
    duplicateSegment,
    refreshExportPreview,
    exportMedia,
    revealOutputPath,
    setCurrentTime,
    setPreviewDuration,
    setPreviewError,
    setIsPlaying,
  };
};
