import { useCallback, useRef, useState } from 'react';
import type { useEditorController } from '../use-editor-controller';

type EditorController = ReturnType<typeof useEditorController>;

const BADGE_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899',
];

export const EditorSegmentList = ({ controller }: { controller: EditorController }): JSX.Element => {
  const {
    formatTimecode,
    segments,
    selectedSegmentId,
    segmentsTotalDuration,
    loadSegment,
    removeSegment,
    reorderSegmentByDrag,
    playSegmentsInOrder,
  } = controller;

  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const dragIdx = useRef(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const onPointerDown = useCallback((event: React.PointerEvent, segmentId: string, index: number) => {
    if ((event.target as HTMLElement).closest('.editor-segment-remove')) { return; }
    startY.current = event.clientY;
    dragIdx.current = index;
    isDragging.current = false;
    setDragId(segmentId);
    setDragOffsetY(0);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    if (!dragId) { return; }
    const deltaY = event.clientY - startY.current;
    if (!isDragging.current && Math.abs(deltaY) < 5) { return; }
    isDragging.current = true;
    setDragOffsetY(deltaY);
  }, [dragId]);

  const onPointerUp = useCallback(() => {
    if (dragId && isDragging.current) {
      const list = listRef.current;
      if (list) {
        const cards = list.querySelectorAll('.editor-segment-item');
        const cardHeight = cards[0]?.getBoundingClientRect().height ?? 56;
        const gap = 4;
        const deltaRows = Math.round(dragOffsetY / (cardHeight + gap));
        const newIndex = Math.max(0, Math.min(segments.length - 1, dragIdx.current + deltaRows));
        if (newIndex !== dragIdx.current) {
          reorderSegmentByDrag(dragId, newIndex);
        }
      }
    }
    isDragging.current = false;
    setDragId(null);
    setDragOffsetY(0);
  }, [dragId, dragOffsetY, reorderSegmentByDrag, segments.length]);

  const onCardClick = useCallback((segmentId: string) => {
    if (isDragging.current) { return; }
    loadSegment(segmentId);
  }, [loadSegment]);

  return (
    <div className="editor-segments-panel">
      <div className="editor-segments-header">
        <span className="editor-segments-title">Segments to export</span>
        <span className="muted">{segments.length}</span>
      </div>

      {segments.length === 0 ? (
        <div className="editor-segments-body editor-segments-body--empty">
          <div className="editor-segments-empty-spacer" aria-hidden />
          <div className="editor-segments-empty-bottom">
            <div className="editor-segments-empty">Use "Set start" and "Set end" then "Add segment" to begin.</div>
            <div className="editor-segments-empty-actions">
              <button
                className="button secondary"
                type="button"
                disabled
                title="Add at least one segment first"
              >
                Play Segments
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="editor-segments-scroll" ref={listRef}>
            {segments.map((segment, index) => {
              const duration = segment.requestedEndSeconds - segment.requestedStartSeconds;
              const isActive = selectedSegmentId === segment.id;
              const isBeingDragged = dragId === segment.id && isDragging.current;
              const badgeColor = BADGE_COLORS[index % BADGE_COLORS.length];

              return (
                <div
                  key={segment.id}
                  className={`editor-segment-item${isActive ? ' active' : ''}${isBeingDragged ? ' dragging' : ''}`}
                  style={isBeingDragged ? { transform: `translateY(${dragOffsetY}px)`, zIndex: 10 } : undefined}
                  onPointerDown={(event) => onPointerDown(event, segment.id, index)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onClick={() => onCardClick(segment.id)}
                >
                  <span className="editor-segment-badge" style={{ backgroundColor: badgeColor }}>
                    {index + 1}
                  </span>
                  <div className="editor-segment-info">
                    {segment.label.trim() && (
                      <span className="editor-segment-label" title={segment.label}>
                        {segment.label}
                      </span>
                    )}
                    <span className="editor-segment-range">
                      {formatTimecode(segment.requestedStartSeconds)} – {formatTimecode(segment.requestedEndSeconds)}
                    </span>
                    <span className="editor-segment-duration">{duration.toFixed(1)}s</span>
                  </div>
                  <button
                    className="editor-segment-remove"
                    title="Remove segment"
                    onClick={(event) => { event.stopPropagation(); removeSegment(segment.id); }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          <div className="editor-segments-footer">
            <div className="editor-segments-footer-stack">
              <button
                className="button secondary"
                type="button"
                disabled={segments.length === 0}
                title="Play all segments from top to bottom"
                onClick={() => void playSegmentsInOrder()}
              >
                Play Segments
              </button>
              <span className="editor-segments-total muted">
                Total: {formatTimecode(segmentsTotalDuration)}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
