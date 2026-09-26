import { useRef, useEffect, useCallback } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { drawPeakBars } from '../../utils/waveformCanvas';
import { slicePeaks } from '../../utils/playerView';
import type { WaveformPeak } from '../../types/api';

/** Peaks computed for exactly one time range (a zoomed view). */
export interface RangePeaks {
  start: number;
  end: number;
  peaks: WaveformPeak[];
  /** One envelope per channel for the same range, when available. */
  channelPeaks?: WaveformPeak[][] | null;
}

interface AudioWaveformProps {
  /** Peaks for the whole track (downmixed). */
  peaks: WaveformPeak[];
  /** Peaks for the whole track, one envelope per channel (left first). */
  channelPeaks?: WaveformPeak[][] | null;
  /** Draw the downmixed envelope, or one lane per channel. */
  layout?: 'combined' | 'split';
  /** Channels drawn faded because they are not being heard. */
  mutedChannels?: number[];
  duration: number;
  currentTime: number;
  onSeek: (time: number) => void;
  /** Visible time range; defaults to the whole track. */
  viewStart?: number;
  viewEnd?: number;
  /** Detailed peaks for a zoomed view, drawn when they match the visible range. */
  detailPeaks?: RangePeaks | null;
  /** Ctrl + wheel: zoom in (1) or out (-1) around `anchor` seconds. */
  onZoom?: (direction: 1 | -1, anchor: number) => void;
  /** Shift + wheel (or a horizontal wheel): move the view by `seconds`. */
  onPan?: (seconds: number) => void;
  /** Height of one lane, in canvas pixels. */
  laneHeight?: number;
  className?: string;
}

const CANVAS_WIDTH = 800;
const DEFAULT_LANE_HEIGHT = 48;
const SPLIT_LANE_HEIGHT = 40;
const LANE_GAP = 6;
const UNPLAYED_COLOR = 'rgba(148, 163, 184, 0.5)';
const PLAYED_COLOR = '#2563eb';
const PLAYHEAD_COLOR = '#1e40af';
const MUTED_ALPHA = 0.25;
/** Fraction of the visible range one wheel notch pans. */
const PAN_STEP_RATIO = 0.1;

/** Lane labels: E/D (L/R) for stereo, channel numbers beyond that. */
function laneLabel(index: number, count: number, left: string, right: string): string {
  if (count === 2) return index === 0 ? left : right;
  return String(index + 1);
}

/**
 * Waveform replacement for the plain progress bar: shows the audio's actual
 * shape, with the played portion highlighted, and supports click/drag to
 * seek like the bar it replaces. It can show a zoomed-in part of the track
 * (`viewStart`..`viewEnd`), using detailed peaks for that range once loaded
 * and a slice of the whole-track peaks until then, and can draw each
 * channel in its own lane.
 */
export default function AudioWaveform({
  peaks,
  channelPeaks = null,
  layout = 'combined',
  mutedChannels = [],
  duration,
  currentTime,
  onSeek,
  viewStart = 0,
  viewEnd,
  detailPeaks = null,
  onZoom,
  onPan,
  laneHeight,
  className = '',
}: AudioWaveformProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);

  const end = viewEnd ?? duration;
  const span = end - viewStart;
  const isWholeTrack = viewStart <= 0 && end >= duration;
  const isSplit = layout === 'split' && !!channelPeaks && channelPeaks.length > 1;
  const laneCount = isSplit ? channelPeaks.length : 1;
  const laneSize = laneHeight ?? (isSplit ? SPLIT_LANE_HEIGHT : DEFAULT_LANE_HEIGHT);
  const canvasHeight = laneCount * laneSize + (laneCount - 1) * LANE_GAP;

  const playedRatio = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
  const viewRatio = span > 0 ? (currentTime - viewStart) / span : 0;
  const playheadVisible = viewRatio >= 0 && viewRatio <= 1;
  const leftLabel = t('audioPlayer.channelLeftShort');
  const rightLabel = t('audioPlayer.channelRightShort');
  const mutedKey = mutedChannels.join(',');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const hasDetail =
      detailPeaks !== null &&
      detailPeaks.start === viewStart &&
      detailPeaks.end === end &&
      detailPeaks.peaks.length > 0;

    // The envelope drawn in each lane for the visible range.
    const visibleEnvelope = (overview: WaveformPeak[], detail: WaveformPeak[] | undefined) => {
      if (isWholeTrack) return overview;
      if (hasDetail && detail && detail.length > 0) return detail;
      return slicePeaks(overview, duration, viewStart, end);
    };
    const lanes = isSplit
      ? channelPeaks.map((overview, i) => visibleEnvelope(overview, detailPeaks?.channelPeaks?.[i]))
      : [visibleEnvelope(peaks, detailPeaks?.peaks)];
    const muted = new Set(mutedKey ? mutedKey.split(',').map(Number) : []);

    ctx.clearRect(0, 0, CANVAS_WIDTH, canvasHeight);
    const playedX = Math.min(1, Math.max(0, viewRatio)) * CANVAS_WIDTH;

    lanes.forEach((lanePeaks, index) => {
      const top = index * (laneSize + LANE_GAP);
      ctx.save();
      ctx.translate(0, top);
      ctx.globalAlpha = isSplit && muted.has(index) ? MUTED_ALPHA : 1;

      ctx.fillStyle = UNPLAYED_COLOR;
      drawPeakBars(ctx, lanePeaks, CANVAS_WIDTH, laneSize);

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, playedX, laneSize);
      ctx.clip();
      ctx.fillStyle = PLAYED_COLOR;
      drawPeakBars(ctx, lanePeaks, CANVAS_WIDTH, laneSize);
      ctx.restore();

      ctx.restore();
    });

    if (playheadVisible) {
      ctx.strokeStyle = PLAYHEAD_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playedX, 0);
      ctx.lineTo(playedX, canvasHeight);
      ctx.stroke();
    }
  }, [
    peaks,
    channelPeaks,
    detailPeaks,
    duration,
    viewStart,
    end,
    isWholeTrack,
    isSplit,
    laneCount,
    laneSize,
    canvasHeight,
    viewRatio,
    playheadVisible,
    mutedKey,
  ]);

  const timeFromClientX = useCallback(
    (clientX: number): number | null => {
      const canvas = canvasRef.current;
      if (!canvas || duration <= 0) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0) return null;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return viewStart + ratio * span;
    },
    [duration, viewStart, span]
  );

  // Wheel gestures need a non-passive listener to stop the page from
  // scrolling or zooming, which React's onWheel cannot provide.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || (!onZoom && !onPan)) return;

    const handleWheel = (e: WheelEvent) => {
      if ((e.ctrlKey || e.metaKey) && onZoom) {
        e.preventDefault();
        const anchor = timeFromClientX(e.clientX) ?? currentTime;
        onZoom(e.deltaY < 0 ? 1 : -1, anchor);
        return;
      }
      const horizontal = e.shiftKey ? e.deltaY || e.deltaX : e.deltaX;
      if (horizontal !== 0 && onPan && !isWholeTrack) {
        e.preventDefault();
        onPan(Math.sign(horizontal) * span * PAN_STEP_RATIO);
      }
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [onZoom, onPan, timeFromClientX, currentTime, span, isWholeTrack]);

  const seekToClientX = (clientX: number) => {
    const time = timeFromClientX(clientX);
    if (time !== null) onSeek(time);
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

  const canvasElement = (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={canvasHeight}
      className={`audio-waveform ${isSplit ? 'audio-waveform-split' : ''} ${className}`.trim()}
      // One CSS pixel per canvas pixel vertically: lanes keep their height.
      style={{ height: `${canvasHeight}px` }}
      data-lanes={laneCount}
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

  if (!isSplit) return canvasElement;

  // Lane labels as HTML over the canvas, so they stay legible in any theme.
  return (
    <div className="audio-waveform-lanes">
      {canvasElement}
      {channelPeaks.map((_, index) => (
        <span
          key={index}
          className="audio-waveform-lane-label"
          style={{ top: index * (laneSize + LANE_GAP) }}
          aria-hidden="true"
        >
          {laneLabel(index, laneCount, leftLabel, rightLabel)}
        </span>
      ))}
    </div>
  );
}
