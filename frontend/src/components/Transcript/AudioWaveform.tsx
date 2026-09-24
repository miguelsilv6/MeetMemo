import { useRef, useEffect, useCallback } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { drawPeakBars } from '../../utils/waveformCanvas';
import type { WaveformPeak } from '../../types/api';

interface AudioWaveformProps {
  peaks: WaveformPeak[];
  duration: number;
  currentTime: number;
  onSeek: (time: number) => void;
}

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 48;
const UNPLAYED_COLOR = 'rgba(148, 163, 184, 0.5)';
const PLAYED_COLOR = '#2563eb';
const PLAYHEAD_COLOR = '#1e40af';

/**
 * Waveform replacement for the plain progress bar: shows the audio's actual
 * shape, with the played portion highlighted, and supports click/drag to
 * seek like the bar it replaces.
 */
export default function AudioWaveform({
  peaks,
  duration,
  currentTime,
  onSeek,
}: AudioWaveformProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);

  const playedRatio = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = UNPLAYED_COLOR;
    drawPeakBars(ctx, peaks, CANVAS_WIDTH, CANVAS_HEIGHT);

    const playedX = playedRatio * CANVAS_WIDTH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, playedX, CANVAS_HEIGHT);
    ctx.clip();
    ctx.fillStyle = PLAYED_COLOR;
    drawPeakBars(ctx, peaks, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.restore();

    ctx.strokeStyle = PLAYHEAD_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playedX, 0);
    ctx.lineTo(playedX, CANVAS_HEIGHT);
    ctx.stroke();
  }, [peaks, playedRatio]);

  const ratioFromClientX = useCallback((clientX: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return null;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  const seekToClientX = (clientX: number) => {
    const ratio = ratioFromClientX(clientX);
    if (ratio !== null && duration > 0) onSeek(ratio * duration);
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    seekToClientX(e.clientX);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) return;
    seekToClientX(e.clientX);
  };

  const handlePointerUp = () => {
    draggingRef.current = false;
  };

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      className="audio-waveform"
      role="slider"
      aria-label={t('audioPlayer.progress')}
      aria-valuenow={Math.round(playedRatio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    />
  );
}
