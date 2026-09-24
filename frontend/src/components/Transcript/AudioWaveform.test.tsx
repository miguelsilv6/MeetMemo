import type { ComponentProps } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AudioWaveform from './AudioWaveform';

const peaks = Array.from({ length: 20 }, (_, i) => ({ min: -0.1 * i, max: 0.1 * i }));

function renderWaveform(overrides: Partial<ComponentProps<typeof AudioWaveform>> = {}) {
  const props = {
    peaks,
    duration: 100,
    currentTime: 0,
    onSeek: vi.fn(),
    ...overrides,
  };
  return { ...render(<AudioWaveform {...props} />), props };
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 800,
    height: 48,
    left: 0,
    top: 0,
    right: 800,
    bottom: 48,
    x: 0,
    y: 0,
    toJSON: () => {},
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AudioWaveform', () => {
  it('reflects currentTime/duration as the slider value', () => {
    renderWaveform({ currentTime: 25, duration: 100 });
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '25');
  });

  it('seeks to the clicked position, scaled by duration', () => {
    const onSeek = vi.fn();
    renderWaveform({ onSeek, duration: 100 });

    fireEvent.pointerDown(screen.getByRole('slider'), { clientX: 400, pointerId: 1 });

    expect(onSeek).toHaveBeenCalledWith(50);
  });

  it('keeps seeking while dragging, and stops once the pointer is released', () => {
    const onSeek = vi.fn();
    renderWaveform({ onSeek, duration: 100 });

    const slider = screen.getByRole('slider');
    fireEvent.pointerDown(slider, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(slider, { clientX: 800 });
    expect(onSeek).toHaveBeenLastCalledWith(100);

    fireEvent.pointerUp(slider);
    onSeek.mockClear();
    fireEvent.pointerMove(slider, { clientX: 200 });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('does not seek when duration is not yet known', () => {
    const onSeek = vi.fn();
    renderWaveform({ onSeek, duration: 0 });

    fireEvent.pointerDown(screen.getByRole('slider'), { clientX: 400, pointerId: 1 });

    expect(onSeek).not.toHaveBeenCalled();
  });
});
