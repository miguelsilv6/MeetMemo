import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SplitSegmentModal from './SplitSegmentModal';
import useWaveformPeaks from '../../hooks/useWaveformPeaks';
import type { EditingSegment } from '../../hooks/useTranscript';

vi.mock('../../hooks/useWaveformPeaks');

const segment: EditingSegment = {
  speaker: 'SPEAKER_00',
  start: 0,
  end: 10,
  text: 'hello there friend',
  index: 2,
};

// "hello there friend" (18 chars) splits at "hello there" (11 chars) /
// "friend" — the default splitRatio handed to onSplit until the user
// actually drags the waveform.
const DEFAULT_RATIO = 11 / 18;

beforeEach(() => {
  vi.mocked(useWaveformPeaks).mockReturnValue({
    peaks: null,
    channelPeaks: null,
    channels: null,
    range: null,
    loading: false,
    error: null,
  });
});

describe('SplitSegmentModal', () => {
  it('defaults to splitting the text at the nearest word boundary to its midpoint', () => {
    render(
      <SplitSegmentModal
        show
        onHide={vi.fn()}
        segment={segment}
        jobId={null}
        speakers={['SPEAKER_00', 'SPEAKER_01']}
        editingSpeakers={{}}
        onSplit={vi.fn()}
      />
    );

    expect(screen.getByDisplayValue('hello there')).toBeInTheDocument();
    expect(screen.getByDisplayValue('friend')).toBeInTheDocument();
  });

  it('defaults the second-part speaker to a different speaker than the original', () => {
    render(
      <SplitSegmentModal
        show
        onHide={vi.fn()}
        segment={segment}
        jobId={null}
        speakers={['SPEAKER_00', 'SPEAKER_01']}
        editingSpeakers={{}}
        onSplit={vi.fn()}
      />
    );

    expect(screen.getByRole('combobox')).toHaveValue('SPEAKER_01');
  });

  it('calls onSplit with the edited text halves, chosen speaker, and the default split ratio', () => {
    const onSplit = vi.fn();
    render(
      <SplitSegmentModal
        show
        onHide={vi.fn()}
        segment={segment}
        jobId={null}
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

    expect(onSplit).toHaveBeenCalledWith(
      2,
      'hello',
      'there friend',
      'SPEAKER_01',
      expect.closeTo(DEFAULT_RATIO, 5)
    );
  });

  it('disables the confirm button when either half is emptied out', () => {
    render(
      <SplitSegmentModal
        show
        onHide={vi.fn()}
        segment={segment}
        jobId={null}
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
        jobId={null}
        speakers={['SPEAKER_00', 'SPEAKER_01']}
        editingSpeakers={{}}
        onSplit={vi.fn()}
      />
    );

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '__new__' } });
    expect(screen.getByRole('combobox')).toHaveValue('Moderator');

    promptSpy.mockRestore();
  });

  it('requests waveform peaks for the segment currently being split', () => {
    render(
      <SplitSegmentModal
        show
        onHide={vi.fn()}
        segment={segment}
        jobId="job1"
        speakers={['SPEAKER_00', 'SPEAKER_01']}
        editingSpeakers={{}}
        onSplit={vi.fn()}
      />
    );

    expect(useWaveformPeaks).toHaveBeenCalledWith('job1', 0, 10);
  });

  it('passes the waveform-picked ratio to onSplit once the user drags the marker', () => {
    vi.mocked(useWaveformPeaks).mockReturnValue({
      peaks: [
        { min: -0.2, max: 0.2 },
        { min: -0.4, max: 0.4 },
      ],
      channelPeaks: null,
      channels: 1,
      range: { start: 0, end: 1 },
      loading: false,
      error: null,
    });
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
    const onSplit = vi.fn();

    render(
      <SplitSegmentModal
        show
        onHide={vi.fn()}
        segment={segment}
        jobId="job1"
        speakers={['SPEAKER_00', 'SPEAKER_01']}
        editingSpeakers={{}}
        onSplit={onSplit}
      />
    );

    fireEvent.pointerDown(screen.getByRole('slider'), { clientX: 150, pointerId: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Split Segment' }));

    expect(onSplit).toHaveBeenCalledWith(2, 'hello there', 'friend', 'SPEAKER_01', 0.25);
  });
});
