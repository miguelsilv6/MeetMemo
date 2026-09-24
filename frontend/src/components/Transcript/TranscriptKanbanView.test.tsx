import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import TranscriptKanbanView from './TranscriptKanbanView';
import type { TranscriptSegment as TranscriptSegmentType } from '../../types/api';

const segments: TranscriptSegmentType[] = [
  { speaker: 'SPEAKER_00', start: 0, end: 2, text: 'Hello everyone' },
  { speaker: 'SPEAKER_01', start: 2, end: 4, text: 'Hi there' },
  { speaker: 'SPEAKER_00', start: 4, end: 6, text: 'How are you' },
];

function renderKanban(overrides: Partial<ComponentProps<typeof TranscriptKanbanView>> = {}) {
  const props = {
    segments,
    activeSegmentIndex: -1,
    handleEditText: vi.fn(),
    onSeekToSegment: vi.fn(),
    onMoveSegmentSpeaker: vi.fn(),
    onBulkMoveSegments: vi.fn(),
    onDeleteSegments: vi.fn(),
    onInsertSegmentAfter: vi.fn(),
    onSplitSegment: vi.fn(),
    ...overrides,
  };
  return { ...render(<TranscriptKanbanView {...props} />), props };
}

describe('TranscriptKanbanView', () => {
  it('groups segments into one column per speaker, ordered by timestamp', () => {
    renderKanban();

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
    renderKanban({
      displayTextByIndex: ['Ola a todos', undefined as unknown as string, 'Como estas'],
    });

    expect(screen.getByText('Ola a todos')).toBeInTheDocument();
    expect(screen.getByText('Hi there')).toBeInTheDocument();
    expect(screen.getByText('Como estas')).toBeInTheDocument();
    expect(screen.queryByText('Hello everyone')).not.toBeInTheDocument();
  });

  it('seeks to a bubble start time when clicked, and edits with the original segment', () => {
    const onSeekToSegment = vi.fn();
    const handleEditText = vi.fn();
    renderKanban({
      displayTextByIndex: [
        'Ola a todos',
        undefined as unknown as string,
        undefined as unknown as string,
      ],
      handleEditText,
      onSeekToSegment,
    });

    fireEvent.click(screen.getByText('Ola a todos'));
    expect(onSeekToSegment).toHaveBeenCalledWith(0);

    fireEvent.click(screen.getAllByTitle('Edit this segment')[0]);
    expect(handleEditText).toHaveBeenCalledWith(segments[0], 0);
  });

  it('reassigns a segment via the keyboard-accessible speaker select, without triggering seek', () => {
    const onSeekToSegment = vi.fn();
    const onMoveSegmentSpeaker = vi.fn();
    renderKanban({ onSeekToSegment, onMoveSegmentSpeaker });

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
    renderKanban({ segments: singleSpeakerSegments });

    expect(screen.queryByLabelText('Move to speaker')).not.toBeInTheDocument();
  });

  it('renders nothing when there are no segments', () => {
    const { container } = renderKanban({ segments: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('adds a new empty speaker column that segments can be reassigned into', () => {
    renderKanban();

    fireEvent.click(screen.getByRole('button', { name: /add speaker/i }));
    fireEvent.change(screen.getByPlaceholderText('Speaker name'), {
      target: { value: 'Moderator' },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('Speaker name'), { key: 'Enter' });

    expect(screen.getByTitle('Moderator')).toBeInTheDocument();
    // The new column's select options include the newly added speaker.
    const selects = screen.getAllByLabelText('Move to speaker');
    expect(selects[0]).toContainHTML('Moderator');
  });

  it('does not add a duplicate speaker (case-insensitive)', () => {
    renderKanban();

    fireEvent.click(screen.getByRole('button', { name: /add speaker/i }));
    fireEvent.change(screen.getByPlaceholderText('Speaker name'), {
      target: { value: 'speaker_00' },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('Speaker name'), { key: 'Enter' });

    expect(screen.getAllByTitle('SPEAKER_00')).toHaveLength(1);
  });

  it('removes an empty speaker column immediately, without a confirmation modal', () => {
    renderKanban();

    fireEvent.click(screen.getByRole('button', { name: /add speaker/i }));
    fireEvent.change(screen.getByPlaceholderText('Speaker name'), {
      target: { value: 'Moderator' },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('Speaker name'), { key: 'Enter' });
    expect(screen.getByTitle('Moderator')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Remove Moderator'));

    expect(screen.queryByTitle('Moderator')).not.toBeInTheDocument();
    expect(screen.queryByText(/remove speaker/i)).not.toBeInTheDocument();
  });

  it('prompts to move or delete when removing a speaker that has segments', () => {
    const onBulkMoveSegments = vi.fn();
    renderKanban({ onBulkMoveSegments });

    fireEvent.click(screen.getByTitle('Remove SPEAKER_00'));

    expect(screen.getByText(/has 2 segments/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Move Segments' }));

    expect(onBulkMoveSegments).toHaveBeenCalledWith([0, 2], 'SPEAKER_01');
  });

  it('deletes a speaker and its segments when that option is chosen', () => {
    const onDeleteSegments = vi.fn();
    renderKanban({ onDeleteSegments });

    fireEvent.click(screen.getByTitle('Remove SPEAKER_00'));
    fireEvent.click(screen.getByLabelText(/delete these segments permanently/i));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Segments' }));

    expect(onDeleteSegments).toHaveBeenCalledWith([0, 2]);
  });

  it('opens the edit modal on double-click', () => {
    const handleEditText = vi.fn();
    renderKanban({ handleEditText });

    fireEvent.doubleClick(screen.getByText('Hi there'));
    expect(handleEditText).toHaveBeenCalledWith(segments[1], 1);
  });

  it('requests inserting a segment after a bubble', () => {
    const onInsertSegmentAfter = vi.fn();
    renderKanban({ onInsertSegmentAfter });

    const bubble = screen.getByText('Hi there').closest('.kanban-bubble') as HTMLElement;
    fireEvent.click(within(bubble).getByTitle('Insert segment after this one'));
    expect(onInsertSegmentAfter).toHaveBeenCalledWith(1);
  });

  it('requests splitting a bubble', () => {
    const onSplitSegment = vi.fn();
    renderKanban({ onSplitSegment });

    const bubble = screen.getByText('Hi there').closest('.kanban-bubble') as HTMLElement;
    fireEvent.click(within(bubble).getByTitle('Split into two speakers'));
    expect(onSplitSegment).toHaveBeenCalledWith(segments[1], 1);
  });

  it('shows checkboxes and hides bubble actions and the add-speaker column in select mode', () => {
    renderKanban({ selectMode: true });

    expect(screen.getAllByRole('checkbox')).toHaveLength(segments.length);
    expect(screen.queryByTitle('Edit this segment')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Insert segment after this one')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add speaker/i })).not.toBeInTheDocument();
  });

  it('toggles selection when a bubble is clicked in select mode, instead of seeking', () => {
    const onToggleSelect = vi.fn();
    const onSeekToSegment = vi.fn();
    renderKanban({ selectMode: true, onToggleSelect, onSeekToSegment });

    fireEvent.click(screen.getByText('Hi there'));

    expect(onToggleSelect).toHaveBeenCalledWith(1);
    expect(onSeekToSegment).not.toHaveBeenCalled();
  });

  it('marks only low-confidence bubbles for review', () => {
    renderKanban({
      segments: [{ ...segments[0], low_confidence: true }, segments[1], segments[2]],
    });

    const flags = screen.getAllByLabelText('Low confidence: check this line against the audio');
    expect(flags).toHaveLength(1);
    const flaggedBubble = flags[0].closest('.kanban-bubble') as HTMLElement;
    expect(within(flaggedBubble).getByText('Hello everyone')).toBeInTheDocument();
  });

  it('reflects selectedIndices on the matching bubble checkbox', () => {
    renderKanban({ selectMode: true, selectedIndices: new Set([1]) });

    const bubble = screen.getByText('Hi there').closest('.kanban-bubble') as HTMLElement;
    expect(within(bubble).getByRole('checkbox')).toBeChecked();
  });

  describe('timeline spacing', () => {
    it('does not show a silence label for a short gap between bubbles', () => {
      renderKanban();
      expect(screen.queryByText(/of silence/)).not.toBeInTheDocument();
    });

    it('shows a silence label for a long gap between two bubbles in the same column', () => {
      const gappySegments: TranscriptSegmentType[] = [
        { speaker: 'SPEAKER_00', start: 0, end: 2, text: 'Hello' },
        { speaker: 'SPEAKER_00', start: 62, end: 64, text: 'You still there?' },
      ];
      renderKanban({ segments: gappySegments });

      // 62 - 2 = 60s gap.
      expect(screen.getByText('1:00 of silence')).toBeInTheDocument();
    });

    it('shows a silence label sized from the last real speech, not from the conversation start', () => {
      // SPEAKER_00 talks 0-2s, SPEAKER_01 doesn't start until 45s: the real
      // silence is 43s (measured from when speech actually stopped), shared
      // by both columns since it's on the timeline both are drawn from.
      const lateStartSegments: TranscriptSegmentType[] = [
        { speaker: 'SPEAKER_00', start: 0, end: 2, text: 'Hello' },
        { speaker: 'SPEAKER_01', start: 45, end: 47, text: 'Sorry, joining now' },
      ];
      renderKanban({ segments: lateStartSegments });

      expect(screen.getAllByText('0:43 of silence').length).toBeGreaterThan(0);
    });

    it('positions bubbles for the same timestamp at the same offset in every column', () => {
      // Both speakers' first (and only) bubble starts at t=10: they must
      // land at the same absolute pixel offset within their own column's
      // body, regardless of which column/speaker they belong to.
      const simultaneousSegments: TranscriptSegmentType[] = [
        { speaker: 'SPEAKER_00', start: 10, end: 12, text: 'Same time A' },
        { speaker: 'SPEAKER_01', start: 10, end: 11, text: 'Same time B' },
      ];
      renderKanban({ segments: simultaneousSegments });

      const wrapperA = screen.getByText('Same time A').closest('.kanban-bubble')
        ?.parentElement as HTMLElement;
      const wrapperB = screen.getByText('Same time B').closest('.kanban-bubble')
        ?.parentElement as HTMLElement;
      expect(wrapperA.style.top).not.toBe('');
      expect(wrapperA.style.top).toBe(wrapperB.style.top);
    });
  });
});
