import { useRef, useEffect, useCallback } from 'react';
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { drawPeakBars } from '../../utils/waveformCanvas';
import type { WaveformPeak } from '../../types/api';

interface WaveformScrubberProps {
  peaks: WaveformPeak[] | null;
  loading: boolean;
  error: string | null;
  /** Position of the split marker, as a fraction (0-1) of the segment's time range. */
  splitRatio: number;
  onSplitRatioChange: (ratio: number) => void;
}

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 64;
const MIN_RATIO = 0.02;
const MAX_RATIO = 0.98;
const KEYBOARD_STEP = 0.02;

const clampRatio = (ratio: number) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));

/**
 * A waveform scrubber for visually picking the audio split point when
 * dividing a transcript segment into two speakers. Renders nothing (rather
 * than an empty/broken canvas) while peaks are loading or unavailable, so
 * the split modal still works from the text-based default when the waveform
 * can't be shown.
 */
export default function WaveformScrubber({
  peaks,
  loading,
  error,
  splitRatio,
  onSplitRatioChange,
}: WaveformScrubberProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || peaks.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = '#2563eb';
    drawPeakBars(ctx, peaks, CANVAS_WIDTH, CANVAS_HEIGHT);

    const markerX = splitRatio * CANVAS_WIDTH;
    ctx.strokeStyle = '#dc3545';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(markerX, 0);
    ctx.lineTo(markerX, CANVAS_HEIGHT);
    ctx.stroke();
  }, [peaks, splitRatio]);

  const ratioFromClientX = useCallback((clientX: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return null;
    return clampRatio((clientX - rect.left) / rect.width);
  }, []);

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const ratio = ratioFromClientX(e.clientX);
    if (ratio !== null) onSplitRatioChange(ratio);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) return;
    const ratio = ratioFromClientX(e.clientX);
    if (ratio !== null) onSplitRatioChange(ratio);
  };

  const handlePointerUp = () => {
    draggingRef.current = false;
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onSplitRatioChange(clampRatio(splitRatio - KEYBOARD_STEP));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onSplitRatioChange(clampRatio(splitRatio + KEYBOARD_STEP));
    }
  };

  if (loading) {
    return (
      <div className="waveform-scrubber-status text-muted small mb-3">
        {t('modals.splitSegment.loadingWaveform')}
      </div>
    );
  }

  if (error || !peaks || peaks.length === 0) {
    return null;
  }

  return (
    <div className="mb-3">
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="waveform-scrubber"
        role="slider"
        aria-label={t('modals.splitSegment.waveformLabel')}
        aria-valuenow={Math.round(splitRatio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onKeyDown={handleKeyDown}
      />
      <div className="text-muted small mt-1">{t('modals.splitSegment.waveformHint')}</div>
    </div>
  );
}
