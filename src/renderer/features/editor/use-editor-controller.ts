import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useLocation } from 'react-router-dom';

import type {
  EditorCutMode,
  EditorExportMode,
  EditorExportPreview,
  EditorExportProgressPayload,
  EditorOpenRequest,
  EditorOpenResult,
  EditorSegment,
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

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const createSegmentId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `segment-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** Packaged app (file:// UI): same as 0.1.0 — local video often decodes better (e.g. some HEVC paths). */
const toFileUrl = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const prefixed = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return encodeURI(`file://${prefixed}`);
};

/**
 * Custom protocol registered in main — avoids file:// blocked from http://localhost (dev) with webSecurity.
 */
const toPreviewMediaUrl = (filePath: string): string =>
  `yoinkr-media://preview/?path=${encodeURIComponent(filePath)}`;

const toEditorPreviewUrl = (absolutePath: string): string => {
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    return toFileUrl(absolutePath);
  }
  return toPreviewMediaUrl(absolutePath);
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

/** Split a full output filename into editable stem + preserved extension (includes leading dot). */
const splitOutputFileName = (full: string): { stem: string; ext: string } => {
  const t = full.trim();
  if (!t) {
    return { stem: '', ext: '' };
  }
  const i = t.lastIndexOf('.');
  if (i <= 0 || i === t.length - 1) {
    return { stem: t, ext: '' };
  }
  return { stem: t.slice(0, i), ext: t.slice(i) };
};

const composeOutputFileName = (stem: string, ext: string): string => {
  const s = stem.trim();
  if (!s) {
    return '';
  }
  return s + ext;
};

const isEditableElement = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.isContentEditable;
};

const findPreviousKeyframe = (keyframeTimes: number[], targetSeconds: number): number | null => {
  if (keyframeTimes.length === 0) { return null; }
  let candidate = keyframeTimes[0] ?? null;
  for (const kf of keyframeTimes) {
    if (kf > targetSeconds + 0.001) { break; }
    candidate = kf;
  }
  return candidate;
};

const findNextKeyframe = (keyframeTimes: number[], targetSeconds: number): number | null => {
  for (const kf of keyframeTimes) {
    if (kf >= targetSeconds - 0.001) { return kf; }
  }
  return keyframeTimes[keyframeTimes.length - 1] ?? null;
};

export { formatTimecode };

const formatExportProgressBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const formatExportDurationShort = (sec: number): string => {
  if (!Number.isFinite(sec) || sec < 0) {
    return '0:00';
  }
  const whole = Math.floor(sec);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
};

const formatExportProgressLine = (p: EditorExportProgressPayload): string => {
  if (p.phase === 'starting') {
    return p.stepLabel;
  }
  const parts: string[] = [`Step ${p.stepIndex}/${p.stepCount}: ${p.stepLabel}`];
  if (p.segmentDurationSeconds && p.segmentDurationSeconds > 0 && p.outTimeUs != null && p.outTimeUs >= 0) {
    const doneSec = p.outTimeUs / 1_000_000;
    const pct = Math.min(100, Math.round((doneSec / p.segmentDurationSeconds) * 100));
    parts.push(
      `Output ~${formatExportDurationShort(doneSec)} / ${formatExportDurationShort(p.segmentDurationSeconds)} (${pct}%)`,
    );
  }
  if (p.totalSizeBytes && p.totalSizeBytes > 1024) {
    parts.push(`${formatExportProgressBytes(p.totalSizeBytes)} written`);
  }
  if (p.speed) {
    parts.push(p.speed);
  }
  return parts.join(' · ');
};

export const useEditorController = () => {
  const location = useLocation();
  const previewRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const lastHandledRouteKeyRef = useRef<string | null>(null);
  const playSegmentsQueueRef = useRef<EditorSegment[] | null>(null);
  const playSegmentsIndexRef = useRef(0);

  const [isDragActive, setIsDragActive] = useState(false);
  const [openResult, setOpenResult] = useState<EditorOpenResult | null>(null);
  const [segments, setSegments] = useState<EditorSegment[]>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [segmentLabel, setSegmentLabel] = useState('');
  const [cutMode, setCutMode] = useState<EditorCutMode>('stream-copy');
  const [exportMode, setExportMode] = useState<EditorExportMode>('separate-files');
  const [outputDirectory, setOutputDirectory] = useState<string | null>(null);
  const [outputFilePath, setOutputFilePath] = useState<string | null>(null);
  const [exportName, setExportName] = useState<{ stem: string; ext: string }>({ stem: '', ext: '' });

  const exportFileName = useMemo(
    () => composeOutputFileName(exportName.stem, exportName.ext),
    [exportName.stem, exportName.ext],
  );
  const [currentTime, setCurrentTime] = useState(0);
  const [previewDuration, setPreviewDuration] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingSource, setIsLoadingSource] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [activityMessage, setActivityMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [selection, setSelection] = useState({ inPointSeconds: 0, outPointSeconds: 0 });
  const [exportPreview, setExportPreview] = useState<EditorExportPreview | null>(null);
  const [exportJob, setExportJob] = useState<{
    status: 'idle' | 'exporting' | 'complete' | 'error';
    message: string | null;
    strategyHeadline: string | null;
    strategyHint: string | null;
    outputPaths: string[];
  }>({ status: 'idle', message: null, strategyHeadline: null, strategyHint: null, outputPaths: [] });

  const exportProgressUnsubRef = useRef<(() => void) | null>(null);

  const sourceDuration = openResult?.mediaInfo.durationSeconds ?? previewDuration ?? 0;
  const previewUrl = openResult
    ? toEditorPreviewUrl(openResult.previewPlaybackPath ?? openResult.source.sourcePath)
    : null;
  const isAudioOnly = Boolean(openResult?.source.hasAudio && !openResult?.source.hasVideo);
  const keyframeTimes = useMemo(() => openResult?.mediaInfo.keyframeTimes ?? [], [openResult?.mediaInfo.keyframeTimes]);

  const resetEditorState = useCallback((result: EditorOpenResult) => {
    const duration = result.mediaInfo.durationSeconds ?? 0;
    setOpenResult(result);
    setSegments([]);
    setSelectedSegmentId(null);
    setSegmentLabel('');
    setCutMode('stream-copy');
    setExportMode('separate-files');
    setOutputDirectory(null);
    setOutputFilePath(null);
    setExportName(splitOutputFileName(buildSingleCutFileName(result.source.fileName)));
    setCurrentTime(0);
    setIsPlaying(false);
    setPreviewDuration(result.mediaInfo.durationSeconds);
    setPreviewError(null);
    setExportPreview(null);
    setExportJob({ status: 'idle', message: null, strategyHeadline: null, strategyHint: null, outputPaths: [] });
    setSelection({ inPointSeconds: 0, outPointSeconds: duration });
    playSegmentsQueueRef.current = null;
    playSegmentsIndexRef.current = 0;
  }, []);

  const openSource = useCallback(async (request: EditorOpenRequest) => {
    setIsLoadingSource(true);
    setError(null);
    setActivityMessage(null);

    try {
      const result = await yoinkrClient.editor.openSource(request);
      resetEditorState(result);
      setActivityMessage(
        result.previewPlaybackNote
          ? `Loaded ${result.source.displayName} — ${result.previewPlaybackNote}`
          : `Loaded ${result.source.displayName}`,
      );
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
    if (!openResult || outputDirectory) {
      return;
    }
    const loadDefault = async (): Promise<void> => {
      try {
        const settings = await yoinkrClient.settings.get();
        if (settings.exportDirectory) {
          setOutputDirectory(settings.exportDirectory);
        }
      } catch {
        // settings unavailable
      }
    };
    void loadDefault();
  }, [openResult, outputDirectory]);

  useEffect(() => {
    setOutputFilePath(null);
  }, [exportFileName, exportMode]);

  /** Fix [0,0] in/out when duration was unknown at open until <video> reports duration — enables Add segment + timeline scrub. */
  useEffect(() => {
    if (!openResult) {
      return;
    }
    const d = openResult.mediaInfo.durationSeconds ?? previewDuration ?? 0;
    if (d <= 0) {
      return;
    }
    setSelection((prev) => {
      let nextIn: number;
      let nextOut: number;
      if (prev.outPointSeconds <= prev.inPointSeconds) {
        nextIn = 0;
        nextOut = d;
      } else {
        nextIn = clamp(prev.inPointSeconds, 0, d);
        nextOut = clamp(prev.outPointSeconds, nextIn + 0.001, d);
      }
      if (prev.inPointSeconds === nextIn && prev.outPointSeconds === nextOut) {
        return prev;
      }
      return { inPointSeconds: nextIn, outPointSeconds: nextOut };
    });
  }, [openResult, previewDuration]);

  useEffect(() => {
    const unsub = yoinkrClient.editor.onPreviewProxyReady((payload) => {
      setOpenResult((prev) => {
        if (!prev || prev.source.sourcePath !== payload.sourcePath) {
          return prev;
        }
        return {
          ...prev,
          previewPlaybackPath: payload.playbackPath,
          previewPlaybackNote: null,
          source: { ...prev.source, previewSupported: true },
        };
      });
      setPreviewError(null);
      setActivityMessage('Preview encoding finished — video should play now.');
    });
    return unsub;
  }, []);

  const closeEdit = useCallback(() => {
    setOpenResult(null);
    setSegments([]);
    setSelectedSegmentId(null);
    setSegmentLabel('');
    setExportName({ stem: '', ext: '' });
    setOutputDirectory(null);
    setOutputFilePath(null);
    setCurrentTime(0);
    setIsPlaying(false);
    setPreviewDuration(null);
    setPreviewError(null);
    setExportPreview(null);
    setExportJob({ status: 'idle', message: null, strategyHeadline: null, strategyHint: null, outputPaths: [] });
    setSelection({ inPointSeconds: 0, outPointSeconds: 0 });
    setError(null);
    setActivityMessage(null);
    playSegmentsQueueRef.current = null;
    playSegmentsIndexRef.current = 0;
  }, []);

  const pickSourceFile = useCallback(async (): Promise<void> => {
    try {
      const sourcePath = await yoinkrClient.editor.pickSourceFile();
      if (!sourcePath) { return; }
      await openSource({ sourcePath, sourceKind: 'local', titleHint: null, sourceUrl: null, autoLoad: true });
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
    await openSource({ sourcePath: droppedPath, sourceKind: 'local', titleHint: file.name, sourceUrl: null, autoLoad: true });
  }, [openSource]);

  const seekTo = useCallback((nextSeconds: number) => {
    const element = previewRef.current;
    if (!element) { return; }
    const bounded = clamp(nextSeconds, 0, sourceDuration || nextSeconds);
    element.currentTime = bounded;
    setCurrentTime(bounded);
  }, [sourceDuration]);

  const togglePlayback = useCallback(async () => {
    const element = previewRef.current;
    if (!element) { return; }
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

  const setSelectionRange = useCallback((inPointSeconds: number, outPointSeconds: number) => {
    const boundedIn = clamp(inPointSeconds, 0, sourceDuration || inPointSeconds);
    const boundedOut = clamp(outPointSeconds, boundedIn, sourceDuration || outPointSeconds);
    setSelection({ inPointSeconds: boundedIn, outPointSeconds: boundedOut });
  }, [sourceDuration]);

  const setInToCurrent = useCallback(() => {
    const newOut = currentTime >= selection.outPointSeconds ? sourceDuration : selection.outPointSeconds;
    setSelectionRange(currentTime, newOut);
  }, [currentTime, selection.outPointSeconds, sourceDuration, setSelectionRange]);

  const setOutToCurrent = useCallback(() => {
    const newIn = currentTime <= selection.inPointSeconds ? 0 : selection.inPointSeconds;
    setSelectionRange(newIn, currentTime);
  }, [currentTime, selection.inPointSeconds, setSelectionRange]);

  const addSegment = useCallback(() => {
    const { inPointSeconds, outPointSeconds } = selection;
    if (outPointSeconds <= inPointSeconds) {
      setError('Set start and end points before adding a segment.');
      return;
    }

    let snapStart = inPointSeconds;
    let snapEnd = outPointSeconds;
    if (keyframeTimes.length > 0) {
      const prevKf = findPreviousKeyframe(keyframeTimes, inPointSeconds);
      const nextKf = findNextKeyframe(keyframeTimes, outPointSeconds);
      if (prevKf !== null) { snapStart = prevKf; }
      if (nextKf !== null) { snapEnd = nextKf; }
      if (snapEnd <= snapStart) { snapEnd = outPointSeconds; }
    }

    const nextSegment: EditorSegment = {
      id: createSegmentId(),
      label: segmentLabel.trim() || `Clip ${segments.length + 1}`,
      requestedStartSeconds: snapStart,
      requestedEndSeconds: snapEnd,
      selected: true,
      exportStatus: 'planned',
    };
    setSegments((current) => [...current, nextSegment]);
    setSelectedSegmentId(nextSegment.id);
    setSegmentLabel('');
    setError(null);

    const snapped = snapStart !== inPointSeconds || snapEnd !== outPointSeconds;
    const msg = snapped
      ? `Added ${nextSegment.label} (snapped to keyframes)`
      : `Added ${nextSegment.label}`;
    setActivityMessage(msg);
  }, [keyframeTimes, segmentLabel, segments.length, selection]);

  const loadSegment = useCallback((segmentId: string) => {
    const segment = segments.find((item) => item.id === segmentId);
    if (!segment) { return; }
    setSelectedSegmentId(segmentId);
    setSegmentLabel(segment.label);
    setSelectionRange(segment.requestedStartSeconds, segment.requestedEndSeconds);
    seekTo(segment.requestedStartSeconds);
  }, [segments, seekTo, setSelectionRange]);

  const removeSegment = useCallback((segmentId: string) => {
    setSegments((current) => current.filter((segment) => segment.id !== segmentId));
    if (selectedSegmentId === segmentId) {
      setSelectedSegmentId(null);
      setSegmentLabel('');
    }
  }, [selectedSegmentId]);

  const updateSegmentBoundary = useCallback((segmentId: string, field: 'start' | 'end', seconds: number) => {
    setSegments((current) =>
      current.map((segment) => {
        if (segment.id !== segmentId) { return segment; }
        if (field === 'start') {
          const bounded = clamp(seconds, 0, segment.requestedEndSeconds - 0.01);
          return { ...segment, requestedStartSeconds: bounded };
        }
        const bounded = clamp(seconds, segment.requestedStartSeconds + 0.01, sourceDuration || seconds);
        return { ...segment, requestedEndSeconds: bounded };
      }),
    );
  }, [sourceDuration]);

  const moveSegmentOnTimeline = useCallback((segmentId: string, newStartSeconds: number) => {
    setSegments((current) =>
      current.map((segment) => {
        if (segment.id !== segmentId) { return segment; }
        const duration = segment.requestedEndSeconds - segment.requestedStartSeconds;
        const boundedStart = clamp(newStartSeconds, 0, (sourceDuration || newStartSeconds) - duration);
        return {
          ...segment,
          requestedStartSeconds: boundedStart,
          requestedEndSeconds: boundedStart + duration,
        };
      }),
    );
  }, [sourceDuration]);

  const reorderSegmentByDrag = useCallback((segmentId: string, newIndex: number) => {
    setSegments((current) => {
      const index = current.findIndex((segment) => segment.id === segmentId);
      if (index < 0 || newIndex < 0 || newIndex >= current.length || index === newIndex) {
        return current;
      }
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(newIndex, 0, item);
      return next;
    });
  }, []);

  const playSegmentsInOrder = useCallback(async () => {
    if (segments.length === 0) { return; }
    playSegmentsQueueRef.current = [...segments];
    playSegmentsIndexRef.current = 0;
    const first = segments[0];
    seekTo(first.requestedStartSeconds);
    const element = previewRef.current;
    if (element) {
      await element.play().catch(() => {});
      setIsPlaying(!element.paused);
    }
  }, [segments, seekTo]);

  useEffect(() => {
    const queue = playSegmentsQueueRef.current;
    if (!queue || !isPlaying) { return; }
    const index = playSegmentsIndexRef.current;
    const currentSegment = queue[index];
    if (!currentSegment) {
      playSegmentsQueueRef.current = null;
      return;
    }
    if (currentTime >= currentSegment.requestedEndSeconds - 0.05) {
      const nextIndex = index + 1;
      if (nextIndex < queue.length) {
        playSegmentsIndexRef.current = nextIndex;
        seekTo(queue[nextIndex].requestedStartSeconds);
      } else {
        playSegmentsQueueRef.current = null;
        const element = previewRef.current;
        if (element) {
          element.pause();
          setIsPlaying(false);
        }
      }
    }
  }, [currentTime, isPlaying, seekTo]);

  const pickExportDirectory = useCallback(async (): Promise<void> => {
    try {
      const nextDirectory = await yoinkrClient.editor.pickExportDirectory();
      if (nextDirectory) { setOutputDirectory(nextDirectory); }
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : 'Unable to choose an export folder.');
    }
  }, []);

  const pickExportFile = useCallback(async (): Promise<void> => {
    if (!openResult) { return; }
    try {
      const nextFile = await yoinkrClient.editor.pickExportFile(buildMergedFileName(openResult.source.fileName));
      if (nextFile) { setOutputFilePath(nextFile); }
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : 'Unable to choose an export destination.');
    }
  }, [openResult]);

  const workingSegments = useMemo<EditorSegment[]>(() => {
    if (segments.length > 0) { return segments; }
    if (selection.outPointSeconds <= selection.inPointSeconds) { return []; }
    return [{
      id: 'selection-preview',
      label: segmentLabel.trim() || 'Current selection',
      requestedStartSeconds: selection.inPointSeconds,
      requestedEndSeconds: selection.outPointSeconds,
      selected: true,
      exportStatus: 'planned',
    }];
  }, [segmentLabel, segments, selection.inPointSeconds, selection.outPointSeconds]);

  const exportMedia = useCallback(async (): Promise<void> => {
    if (!openResult) {
      setError('Open a source file before exporting.');
      return;
    }
    if (workingSegments.length === 0) {
      setError('Create at least one segment before exporting.');
      return;
    }

    setIsExporting(true);
    setError(null);
    setActivityMessage(null);
    setExportJob({
      status: 'exporting',
      message: 'Starting export…',
      strategyHeadline: null,
      strategyHint: null,
      outputPaths: [],
    });

    exportProgressUnsubRef.current?.();
    exportProgressUnsubRef.current = yoinkrClient.editor.onExportProgress((payload) => {
      setExportJob((prev) => ({
        ...prev,
        strategyHeadline: payload.strategyLabel,
        strategyHint: payload.strategyExplanation,
        message: formatExportProgressLine(payload),
      }));
    });

    try {
      let nextOutputDirectory = outputDirectory;
      let nextOutputFilePath = outputFilePath;

      if (!nextOutputDirectory) {
        nextOutputDirectory = await yoinkrClient.editor.pickExportDirectory();
        setOutputDirectory(nextOutputDirectory);
        if (!nextOutputDirectory) { setIsExporting(false); return; }
      }

      const needsFilePath = exportMode === 'single-cut' || exportMode === 'merge-cuts' || exportMode === 'merge-and-separate';
      if (needsFilePath && !nextOutputFilePath) {
        const name = exportFileName.trim()
          || (exportMode === 'single-cut' ? buildSingleCutFileName(openResult.source.fileName) : buildMergedFileName(openResult.source.fileName));
        nextOutputFilePath = `${nextOutputDirectory}\\${name}`;
        setOutputFilePath(nextOutputFilePath);
      }

      const userBaseName = exportFileName.trim()
        ? exportName.stem.trim()
        : openResult.source.displayName;

      const result = await yoinkrClient.editor.exportMedia({
        sourcePath: openResult.source.sourcePath,
        sourceKind: openResult.source.sourceKind,
        segments: workingSegments,
        exportMode,
        cutMode,
        outputDirectory: nextOutputDirectory,
        outputFilePath: nextOutputFilePath,
        baseName: userBaseName,
        preserveOriginal: true,
      });

      setExportPreview(result.preview);
      setExportJob({
        status: 'complete',
        message: result.message,
        strategyHeadline: null,
        strategyHint: null,
        outputPaths: result.outputPaths,
      });
      setActivityMessage(result.message);
    } catch (exportError) {
      const message = exportError instanceof Error ? exportError.message : 'Export failed.';
      setError(message);
      setExportJob({
        status: 'error',
        message,
        strategyHeadline: null,
        strategyHint: null,
        outputPaths: [],
      });
    } finally {
      exportProgressUnsubRef.current?.();
      exportProgressUnsubRef.current = null;
      setIsExporting(false);
    }
  }, [cutMode, exportFileName, exportMode, exportName.stem, openResult, outputDirectory, outputFilePath, workingSegments]);

  const setExportFileName = useCallback((value: string | ((prev: string) => string)) => {
    setExportName((prev) => {
      const prevFull = composeOutputFileName(prev.stem, prev.ext);
      const nextFull = typeof value === 'function' ? (value as (prevFull: string) => string)(prevFull) : value;
      return splitOutputFileName(nextFull);
    });
  }, []);

  const setExportOutputStem = useCallback((stem: string) => {
    setExportName((prev) => ({ ...prev, stem }));
  }, []);

  const revealOutputPath = useCallback(async (targetPath: string): Promise<void> => {
    try {
      await yoinkrClient.app.revealPath(targetPath);
    } catch {
      setError('Could not reveal that path.');
    }
  }, []);

  useEffect(() => {
    if (!openResult) { return; }
    const handleKeyDown = async (event: KeyboardEvent): Promise<void> => {
      if (isEditableElement(event.target)) { return; }
      if (event.code === 'Space') { event.preventDefault(); await togglePlayback(); return; }
      if (event.key.toLowerCase() === 'i') { event.preventDefault(); setInToCurrent(); return; }
      if (event.key.toLowerCase() === 'o') { event.preventDefault(); setOutToCurrent(); return; }
      if (event.key === 'ArrowLeft') { event.preventDefault(); stepBy(-1 / 30); return; }
      if (event.key === 'ArrowRight') { event.preventDefault(); stepBy(1 / 30); return; }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => { window.removeEventListener('keydown', handleKeyDown); };
  }, [openResult, setInToCurrent, setOutToCurrent, stepBy, togglePlayback]);

  const segmentsTotalDuration = useMemo(
    () => segments.reduce((sum, segment) => sum + Math.max(0, segment.requestedEndSeconds - segment.requestedStartSeconds), 0),
    [segments],
  );

  return {
    formatTimecode,
    previewRef,
    isDragActive,
    openResult,
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
    exportFileName,
    exportOutputStem: exportName.stem,
    exportOutputExtension: exportName.ext,
    currentTime,
    sourceDuration,
    previewUrl,
    isAudioOnly,
    selection,
    isPlaying,
    isLoadingSource,
    isExporting,
    activityMessage,
    error,
    previewError,
    segmentsTotalDuration,
    keyframeTimes,
    setSegmentLabel,
    setExportFileName,
    setExportOutputStem,
    setCutMode,
    setExportMode,
    closeEdit,
    onDragEnter,
    onDragLeave,
    onDrop,
    pickSourceFile,
    pickExportDirectory,
    pickExportFile,
    seekTo,
    stepBy,
    togglePlayback,
    setInToCurrent,
    setOutToCurrent,
    setSelectionRange,
    addSegment,
    loadSegment,
    removeSegment,
    updateSegmentBoundary,
    moveSegmentOnTimeline,
    reorderSegmentByDrag,
    playSegmentsInOrder,
    exportMedia,
    revealOutputPath,
    setCurrentTime,
    setPreviewDuration,
    setPreviewError,
    setIsPlaying,
    setOutputDirectory,
    openSource,
  };
};
