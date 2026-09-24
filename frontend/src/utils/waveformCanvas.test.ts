import { describe, it, expect, vi } from 'vitest';
import { drawPeakBars } from './waveformCanvas';
import type { WaveformPeak } from '../types/api';

function createFakeContext() {
  return { fillRect: vi.fn() } as unknown as CanvasRenderingContext2D;
}

describe('drawPeakBars', () => {
  it('draws one bar per peak, spanning the full width', () => {
    const ctx = createFakeContext();
    const peaks: WaveformPeak[] = [
      { min: -0.5, max: 0.5 },
      { min: -0.2, max: 0.8 },
      { min: -1, max: 1 },
      { min: 0, max: 0 },
    ];

    drawPeakBars(ctx, peaks, 400, 100);

    expect(ctx.fillRect).toHaveBeenCalledTimes(4);
    // Bar i is positioned at x = i * (width / peaks.length).
    expect(ctx.fillRect).toHaveBeenNthCalledWith(1, 0, expect.any(Number), 99, expect.any(Number));
    expect(ctx.fillRect).toHaveBeenNthCalledWith(
      2,
      100,
      expect.any(Number),
      99,
      expect.any(Number)
    );
    expect(ctx.fillRect).toHaveBeenNthCalledWith(
      3,
      200,
      expect.any(Number),
      99,
      expect.any(Number)
    );
    expect(ctx.fillRect).toHaveBeenNthCalledWith(
      4,
      300,
      expect.any(Number),
      99,
      expect.any(Number)
    );
  });

  it('centers taller bars around the vertical midpoint', () => {
    const ctx = createFakeContext();
    drawPeakBars(ctx, [{ min: -1, max: 1 }], 100, 100);

    // Full-amplitude peak spans the whole height, starting at y = 0.
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 99, 100);
  });

  it('reserves at least 1px of height for a silent (zero-amplitude) bar', () => {
    const ctx = createFakeContext();
    drawPeakBars(ctx, [{ min: 0, max: 0 }], 100, 100);

    const [, , , height] = (ctx.fillRect as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(height).toBe(1);
  });
});
