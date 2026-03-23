import { useCallback, useRef, useState } from 'react';
import type { useEditorController } from '../use-editor-controller';

type EditorController = ReturnType<typeof useEditorController>;

const SEGMENT_COLORS = [
  'rgba(59, 130, 246, 0.6)',
  'rgba(16, 185, 129, 0.6)',
  'rgba(245, 158, 11, 0.6)',
  'rgba(239, 68, 68, 0.6)',
  'rgba(139, 92, 246, 0.6)',
  'rgba(236, 72, 153, 0.6)',
];

type DragState = {
  segmentId: string;
  mode: 'start' | 'end' | 'move';
  offsetSeconds: number;
};

export const EditorTimelinePanel = ({ controller }: { controller: EditorController }): JSX.Element => {
  const {
    sourceDuration,
    currentTime,
    segments,
    selection,
    seekTo,
    updateSegmentBoundary,
    moveSegmentOnTimeline,
    removeSegment,
  } = controller;

  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; segmentId: string } | null>(null);

  const secondsFromMouseX = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track || sourceDuration <= 0) { return 0; }
    const rect = track.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return fraction * sourceDuration;
  }, [sourceDuration]);

  const onTrackClick = useCallback((event: React.MouseEvent) => {
    setContextMenu(null);
    if (dragRef.current) { return; }
    seekTo(secondsFromMouseX(event.clientX));
  }, [seekTo, secondsFromMouseX]);

  const onHandlePointerDown = useCallback((event: React.PointerEvent, segmentId: string, field: 'start' | 'end') => {
    event.stopPropagation();
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = { segmentId, mode: field, offsetSeconds: 0 };
  }, []);

  const onSegmentPointerDown = useCallback((event: React.PointerEvent, segmentId: string) => {
    if ((event.target as HTMLElement).classList.contains('editor-timeline-handle')
      || (event.target as HTMLElement).classList.contains('editor-timeline-handle-left')
      || (event.target as HTMLElement).classList.contains('editor-timeline-handle-right')) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const seconds = secondsFromMouseX(event.clientX);
    const segment = segments.find((s) => s.id === segmentId);
    const offset = segment ? seconds - segment.requestedStartSeconds : 0;
    dragRef.current = { segmentId, mode: 'move', offsetSeconds: offset };
  }, [secondsFromMouseX, segments]);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) { return; }
    const seconds = secondsFromMouseX(event.clientX);
    if (drag.mode === 'move') {
      moveSegmentOnTimeline(drag.segmentId, seconds - drag.offsetSeconds);
    } else {
      updateSegmentBoundary(drag.segmentId, drag.mode, seconds);
    }
  }, [secondsFromMouseX, updateSegmentBoundary, moveSegmentOnTimeline]);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const onSegmentContextMenu = useCallback((event: React.MouseEvent, segmentId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY, segmentId });
  }, []);

  const handleContextDelete = useCallback(() => {
    if (contextMenu) {
      removeSegment(contextMenu.segmentId);
      setContextMenu(null);
    }
  }, [contextMenu, removeSegment]);

  const playheadPercent = sourceDuration > 0 ? (currentTime / sourceDuration) * 100 : 0;
  const selectionLeftPercent = sourceDuration > 0 ? (selection.inPointSeconds / sourceDuration) * 100 : 0;
  const selectionWidthPercent = sourceDuration > 0
    ? ((selection.outPointSeconds - selection.inPointSeconds) / sourceDuration) * 100
    : 0;

  return (
    <>
      <div
        className="editor-timeline-track"
        ref={trackRef}
        onClick={onTrackClick}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {selectionWidthPercent > 0.05 && (
          <div
            className="editor-timeline-selection"
            style={{ left: `${selectionLeftPercent}%`, width: `${Math.max(0.2, selectionWidthPercent)}%` }}
          />
        )}

        {segments.map((segment, index) => {
          const left = sourceDuration > 0 ? (segment.requestedStartSeconds / sourceDuration) * 100 : 0;
          const width = sourceDuration > 0 ? ((segment.requestedEndSeconds - segment.requestedStartSeconds) / sourceDuration) * 100 : 0;
          const color = SEGMENT_COLORS[index % SEGMENT_COLORS.length];

          return (
            <div
              key={segment.id}
              className="editor-timeline-segment"
              style={{ left: `${left}%`, width: `${Math.max(0.3, width)}%`, backgroundColor: color }}
              onPointerDown={(event) => onSegmentPointerDown(event, segment.id)}
              onContextMenu={(event) => onSegmentContextMenu(event, segment.id)}
            >
              <div
                className="editor-timeline-handle editor-timeline-handle-left"
                onPointerDown={(event) => onHandlePointerDown(event, segment.id, 'start')}
              />
              <span className="editor-timeline-segment-label">{index + 1}</span>
              <div
                className="editor-timeline-handle editor-timeline-handle-right"
                onPointerDown={(event) => onHandlePointerDown(event, segment.id, 'end')}
              />
            </div>
          );
        })}

        <div className="editor-timeline-playhead" style={{ left: `${playheadPercent}%` }} />
      </div>

      {contextMenu && (
        <div
          className="editor-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button className="editor-context-menu-item" onClick={handleContextDelete}>
            Delete segment
          </button>
        </div>
      )}

      {contextMenu && (
        <div className="editor-context-backdrop" onClick={() => setContextMenu(null)} />
      )}
    </>
  );
};
