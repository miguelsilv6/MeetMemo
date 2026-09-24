import type { WaveformPeak } from '../types/api';

/**
 * Draws a min/max peak-bar waveform into a 2D canvas context, using the
 * context's current fillStyle. Shared by the split-segment scrubber and the
 * main audio player's waveform, so both render peaks identically.
 */
export function drawPeakBars(
  ctx: CanvasRenderingContext2D,
  peaks: WaveformPeak[],
  width: number,
  height: number
): void {
  const barWidth = width / peaks.length;
  const midY = height / 2;

  peaks.forEach((peak, i) => {
    const x = i * barWidth;
    const topY = midY - peak.max * midY;
    const barHeight = Math.max(1, (peak.max - peak.min) * midY);
    ctx.fillRect(x, topY, Math.max(1, barWidth - 1), barHeight);
  });
}
