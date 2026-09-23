import type { ComponentProps } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WaveformScrubber from './WaveformScrubber';

const peaks = Array.from({ length: 20 }, (_, i) => ({ min: -0.1 * i, max: 0.1 * i }));

function renderScrubber(overrides: Partial<ComponentProps<typeof WaveformScrubber>> = {}) {
  const props = {
    peaks,
    loading: false,
    error: null,
    splitRatio: 0.5,
    onSplitRatioChange: vi.fn(),
    ...overrides,
  };
  return { ...render(<WaveformScrubber {...props} />), props };
}

beforeEach(() => {
  // jsdom lays out nothing, so getBoundingClientRect defaults to all zeros;
  // stub a real width/left so pointer-position-to-ratio math is testable.
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 600,
    height: 64,
    left: 0,
    top: 0,
    right: 600,
    bottom: 64,
    x: 0,
    y: 0,
    toJSON: () => {},
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WaveformScrubber', () => {
  it('shows a loading message while peaks are being fetched', () => {
    renderScrubber({ loading: true, peaks: null });
    expect(screen.getByText('Loading waveform…')).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('renders nothing when there was an error', () => {
    const { container } = renderScrubber({ error: 'network down', peaks: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there are no peaks', () => {
    const { container } = renderScrubber({ peaks: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a slider reflecting splitRatio when peaks are available', () => {
    renderScrubber({ splitRatio: 0.25 });
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('aria-valuenow', '25');
  });

  it('updates the ratio when clicking/dragging at a given position', () => {
    const onSplitRatioChange = vi.fn();
    renderScrubber({ onSplitRatioChange });

    const slider = screen.getByRole('slider');
    fireEvent.pointerDown(slider, { clientX: 300, pointerId: 1 });

    expect(onSplitRatioChange).toHaveBeenCalledWith(0.5);
  });

  it('clamps the ratio away from the very edges', () => {
    const onSplitRatioChange = vi.fn();
    renderScrubber({ onSplitRatioChange });

    const slider = screen.getByRole('slider');
    fireEvent.pointerDown(slider, { clientX: 0, pointerId: 1 });
    expect(onSplitRatioChange).toHaveBeenCalledWith(0.02);

    fireEvent.pointerDown(slider, { clientX: 600, pointerId: 1 });
    expect(onSplitRatioChange).toHaveBeenCalledWith(0.98);
  });

  it('only updates on move while the pointer is down', () => {
    const onSplitRatioChange = vi.fn();
    renderScrubber({ onSplitRatioChange });

    const slider = screen.getByRole('slider');
    fireEvent.pointerMove(slider, { clientX: 300 });
    expect(onSplitRatioChange).not.toHaveBeenCalled();

    fireEvent.pointerDown(slider, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(slider, { clientX: 450 });
    expect(onSplitRatioChange).toHaveBeenLastCalledWith(0.75);

    fireEvent.pointerUp(slider);
    onSplitRatioChange.mockClear();
    fireEvent.pointerMove(slider, { clientX: 100 });
    expect(onSplitRatioChange).not.toHaveBeenCalled();
  });

  it('adjusts the ratio with arrow keys', () => {
    const onSplitRatioChange = vi.fn();
    renderScrubber({ onSplitRatioChange, splitRatio: 0.5 });

    const slider = screen.getByRole('slider');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onSplitRatioChange).toHaveBeenCalledWith(0.52);

    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(onSplitRatioChange).toHaveBeenCalledWith(0.48);
  });
});
