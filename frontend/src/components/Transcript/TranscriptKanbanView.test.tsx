import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TranscriptKanbanView from './TranscriptKanbanView';
import type { TranscriptSegment as TranscriptSegmentType } from '../../types/api';

const segments: TranscriptSegmentType[] = [
  { speaker: 'SPEAKER_00', start: 0, end: 2, text: 'Hello everyone' },
  { speaker: 'SPEAKER_01', start: 2, end: 4, text: 'Hi there' },
  { speaker: 'SPEAKER_00', start: 4, end: 6, text: 'How are you' },
];

describe('TranscriptKanbanView', () => {
  it('groups segments into one column per speaker, ordered by timestamp', () => {
    render(
      <TranscriptKanbanView
        segments={segments}
        activeSegmentIndex={-1}
        handleEditText={vi.fn()}
        onSeekToSegment={vi.fn()}
        onMoveSegmentSpeaker={vi.fn()}
      />
    );

    // Column header badges carry a `title` matching the speaker, which
    // disambiguates them from the speaker name also appearing as an
    // <option> inside each bubble's "move to speaker" select.
    expect(screen.getByTitle('SPEAKER_00')).toBeInTheDocument();
    expect(screen.getByTitle('SPEAKER_01')).toBeInTheDocument();
    expect(screen.getByText('Hello everyone')).toBeInTheDocument();
    expect(screen.getByText('Hi there')).toBeInTheDocument();
    expect(screen.getByText('How are you')).toBeInTheDocument();
  });

  it('renders translated text in place of the original when provided', () => {
    render(
      <TranscriptKanbanView
        segments={segments}
        displayTextByIndex={['Ola a todos', undefined as unknown as string, 'Como estas']}
        activeSegmentIndex={-1}
        handleEditText={vi.fn()}
        onSeekToSegment={vi.fn()}
        onMoveSegmentSpeaker={vi.fn()}
      />
    );

    expect(screen.getByText('Ola a todos')).toBeInTheDocument();
    expect(screen.getByText('Hi there')).toBeInTheDocument();
    expect(screen.getByText('Como estas')).toBeInTheDocument();
    expect(screen.queryByText('Hello everyone')).not.toBeInTheDocument();
  });

  it('seeks to a bubble start time when clicked, and edits with the original segment', () => {
    const onSeekToSegment = vi.fn();
    const handleEditText = vi.fn();
    render(
      <TranscriptKanbanView
        segments={segments}
        displayTextByIndex={[
          'Ola a todos',
          undefined as unknown as string,
          undefined as unknown as string,
        ]}
        activeSegmentIndex={-1}
        handleEditText={handleEditText}
        onSeekToSegment={onSeekToSegment}
        onMoveSegmentSpeaker={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Ola a todos'));
    expect(onSeekToSegment).toHaveBeenCalledWith(0);

    fireEvent.click(screen.getAllByTitle('Edit this segment')[0]);
    expect(handleEditText).toHaveBeenCalledWith(segments[0], 0);
  });

  it('reassigns a segment via the keyboard-accessible speaker select, without triggering seek', () => {
    const onSeekToSegment = vi.fn();
    const onMoveSegmentSpeaker = vi.fn();
    render(
      <TranscriptKanbanView
        segments={segments}
        activeSegmentIndex={-1}
        handleEditText={vi.fn()}
        onSeekToSegment={onSeekToSegment}
        onMoveSegmentSpeaker={onMoveSegmentSpeaker}
      />
    );

    const selects = screen.getAllByLabelText('Move to speaker');
    expect(selects[0]).toHaveValue('SPEAKER_00');

    fireEvent.change(selects[0], { target: { value: 'SPEAKER_01' } });

    expect(onMoveSegmentSpeaker).toHaveBeenCalledWith(0, 'SPEAKER_01');
    expect(onSeekToSegment).not.toHaveBeenCalled();
  });

  it('omits the speaker select when there is only one speaker', () => {
    const singleSpeakerSegments: TranscriptSegmentType[] = [
      { speaker: 'SPEAKER_00', start: 0, end: 2, text: 'Hello everyone' },
    ];
    render(
      <TranscriptKanbanView
        segments={singleSpeakerSegments}
        activeSegmentIndex={-1}
        handleEditText={vi.fn()}
        onSeekToSegment={vi.fn()}
        onMoveSegmentSpeaker={vi.fn()}
      />
    );

    expect(screen.queryByLabelText('Move to speaker')).not.toBeInTheDocument();
  });

  it('renders nothing when there are no segments', () => {
    const { container } = render(
      <TranscriptKanbanView
        segments={[]}
        activeSegmentIndex={-1}
        handleEditText={vi.fn()}
        onSeekToSegment={vi.fn()}
        onMoveSegmentSpeaker={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
