import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

type DragHandle = 'start' | 'end' | null;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function DownloadSectionTimeline({
  durationSec,
  startSec,
  endSec,
  disabled,
  onChange,
}: {
  durationSec: number;
  startSec: number;
  endSec: number;
  disabled?: boolean;
  onChange: (start: number, end: number) => void;
}): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [drag, setDrag] = useState<DragHandle>(null);
  const minGap = Math.max(0.25, Math.min(1, durationSec * 0.02));

  const timeFromClientX = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el || durationSec <= 0) return 0;
      const rect = el.getBoundingClientRect();
      const x = clamp(clientX - rect.left, 0, rect.width);
      return (x / rect.width) * durationSec;
    },
    [durationSec],
  );

  useEffect(() => {
    if (!drag) return;

    const onMove = (e: PointerEvent): void => {
      const t = timeFromClientX(e.clientX);
      if (drag === 'start') {
        onChangeRef.current(clamp(t, 0, endSec - minGap), endSec);
      } else {
        onChangeRef.current(startSec, clamp(t, startSec + minGap, durationSec));
      }
    };

    const onUp = (): void => {
      setDrag(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag, durationSec, endSec, minGap, startSec, timeFromClientX]);

  const onTrackPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    const t = timeFromClientX(e.clientX);
    const distStart = Math.abs(t - startSec);
    const distEnd = Math.abs(t - endSec);
    if (distStart <= distEnd) {
      onChangeRef.current(clamp(t, 0, endSec - minGap), endSec);
      setDrag('start');
    } else {
      onChangeRef.current(startSec, clamp(t, startSec + minGap, durationSec));
      setDrag('end');
    }
  };

  const onHandlePointerDown = (which: 'start' | 'end') => (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (disabled || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setDrag(which);
  };

  const leftPct = durationSec > 0 ? (startSec / durationSec) * 100 : 0;
  const widthPct = durationSec > 0 ? ((endSec - startSec) / durationSec) * 100 : 100;
  const len = Math.max(0, endSec - startSec);

  return (
    <div className="dl-section-timeline" aria-label="Download section">
      <div className="dl-section-timeline-meta">
        <span>
          {formatClock(startSec)} → {formatClock(endSec)}
        </span>
        <span className="dl-section-timeline-meta-sep">·</span>
        <span>{formatClock(len)} selected</span>
      </div>
      <div
        ref={trackRef}
        className={`dl-section-track ${disabled ? 'dl-section-track-disabled' : ''}`}
        onPointerDown={onTrackPointerDown}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={durationSec}
        aria-disabled={disabled}
      >
        <div className="dl-section-track-bg" />
        <div className="dl-section-range" style={{ left: `${leftPct}%`, width: `${widthPct}%` }} />
        <button
          type="button"
          className="dl-section-handle dl-section-handle-start"
          style={{ left: `${leftPct}%` }}
          disabled={disabled}
          onPointerDown={onHandlePointerDown('start')}
          aria-label="Section start"
        />
        <button
          type="button"
          className="dl-section-handle dl-section-handle-end"
          style={{ left: `${leftPct + widthPct}%` }}
          disabled={disabled}
          onPointerDown={onHandlePointerDown('end')}
          aria-label="Section end"
        />
      </div>
    </div>
  );
}
