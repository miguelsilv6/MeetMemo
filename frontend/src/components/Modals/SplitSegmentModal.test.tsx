import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SplitSegmentModal from './SplitSegmentModal';
import type { EditingSegment } from '../../hooks/useTranscript';

const segment: EditingSegment = {
  speaker: 'SPEAKER_00',
  start: 0,
  end: 10,
  text: 'hello there friend',
  index: 2,
};

describe('SplitSegmentModal', () => {
  it('defaults to splitting the text at the nearest word boundary to its midpoint', () => {
    render(
      <SplitSegmentModal
        show
        onHide={vi.fn()}
        segment={segment}
        speakers={['SPEAKER_00', 'SPEAKER_01']}
        editingSpeakers={{}}
        onSplit={vi.fn()}
      />
    );

    // "hello there friend" (19 chars) splits near the middle word boundary.
    expect(screen.getByDisplayValue('hello there')).toBeInTheDocument();
    expect(screen.getByDisplayValue('friend')).toBeInTheDocument();
  });

  it('defaults the second-part speaker to a different speaker than the original', () => {
    render(
      <SplitSegmentModal
        show
        onHide={vi.fn()}
        segment={segment}
        speakers={['SPEAKER_00', 'SPEAKER_01']}
        editingSpeakers={{}}
        onSplit={vi.fn()}
      />
    );

    expect(screen.getByRole('combobox')).toHaveValue('SPEAKER_01');
  });

  it('calls onSplit with the edited text halves and chosen speaker', () => {
    const onSplit = vi.fn();
    render(
      <SplitSegmentModal
        show
        onHide={vi.fn()}
        segment={segment}
        speakers={['SPEAKER_00', 'SPEAKER_01']}
        editingSpeakers={{}}
        onSplit={onSplit}
      />
    );

    fireEvent.change(screen.getByDisplayValue('hello there'), { target: { value: 'hello' } });
    fireEvent.change(screen.getByDisplayValue('friend'), {
      target: { value: 'there friend' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Split Segment' }));

    expect(onSplit).toHaveBeenCalledWith(2, 'hello', 'there friend', 'SPEAKER_01');
  });

  it('disables the confirm button when either half is emptied out', () => {
    render(
      <SplitSegmentModal
        show
        onHide={vi.fn()}
        segment={segment}
        speakers={['SPEAKER_00', 'SPEAKER_01']}
        editingSpeakers={{}}
        onSplit={vi.fn()}
      />
    );

    fireEvent.change(screen.getByDisplayValue('friend'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Split Segment' })).toBeDisabled();
  });

  it('prompts for a new speaker name when "+ Add New Speaker" is chosen', () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Moderator');
    render(
      <SplitSegmentModal
        show
        onHide={vi.fn()}
        segment={segment}
        speakers={['SPEAKER_00', 'SPEAKER_01']}
        editingSpeakers={{}}
        onSplit={vi.fn()}
      />
    );

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '__new__' } });
    expect(screen.getByRole('combobox')).toHaveValue('Moderator');

    promptSpy.mockRestore();
  });
});
