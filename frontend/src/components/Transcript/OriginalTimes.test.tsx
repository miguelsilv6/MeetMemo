import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OriginalTimes from './OriginalTimes';

describe('OriginalTimes', () => {
  it('shows nothing for a line never moved or merged into', () => {
    const { container } = render(
      <OriginalTimes
        segment={{ speaker: 'A', start: 0, end: 2, text: 'hi' }}
        onSeekToSegment={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows where each merged line was spoken, and plays it from there', () => {
    const onSeekToSegment = vi.fn();
    render(
      <OriginalTimes
        segment={{
          speaker: 'A',
          start: 0,
          end: 5,
          text: 'hi there',
          original: { speaker: 'B', start: 20, end: 22 },
          merged: [{ speaker: 'B', start: 50, end: 54, text: 'there' }],
        }}
        onSeekToSegment={onSeekToSegment}
      />
    );
    expect(screen.getByText('original 0:20 – 0:22')).toBeInTheDocument();
    fireEvent.click(screen.getByText('merged from 0:50 – 0:54'));
    expect(onSeekToSegment).toHaveBeenCalledWith(50);
  });
});
