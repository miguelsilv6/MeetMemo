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

    // Column header badges carry a `title` matching the speaker.
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

  it('has no speaker select on bubbles: a line changes speaker only by being dragged', () => {
    renderKanban();

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    // Every bubble is a drag source (dnd-kit's draggable attributes).
    for (const bubble of document.querySelectorAll('.kanban-bubble')) {
      expect(bubble).toHaveAttribute('aria-roledescription', 'draggable');
    }
  });

  it('renders nothing when there are no segments', () => {
    const { container } = renderKanban({ segments: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('adds a new empty speaker column that bubbles can be dragged into', () => {
    renderKanban();

    fireEvent.click(screen.getByRole('button', { name: /add speaker/i }));
    fireEvent.change(screen.getByPlaceholderText('Speaker name'), {
      target: { value: 'Moderator' },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('Speaker name'), { key: 'Enter' });

    expect(screen.getByTitle('Moderator')).toBeInTheDocument();
    // The new, empty column is a drop target for dragged bubbles.
    expect(screen.getByText('Drop here')).toBeInTheDocument();
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

    it('puts the silence label on its own row between the lines it separates', () => {
      const gappySegments: TranscriptSegmentType[] = [
        { speaker: 'SPEAKER_00', start: 0, end: 2, text: 'Hello' },
        { speaker: 'SPEAKER_01', start: 62, end: 64, text: 'You still there?' },
      ];
      renderKanban({ segments: gappySegments });

      const rowOf = (el: Element | null) => (el as HTMLElement).style.gridRow;
      expect(rowOf(screen.getByText('Hello').closest('.kanban-cell'))).toBe('2');
      expect(rowOf(screen.getByText('1:00 of silence'))).toBe('3');
      expect(rowOf(screen.getByText('You still there?').closest('.kanban-cell'))).toBe('4');
    });
  });

  describe('chronological rows', () => {
    const interleaved: TranscriptSegmentType[] = [
      // Deliberately out of order, as can happen after editing/inserting.
      { speaker: 'SPEAKER_01', start: 5, end: 7, text: 'Second, from B' },
      { speaker: 'SPEAKER_00', start: 0, end: 4, text: 'First, from A' },
      { speaker: 'SPEAKER_00', start: 8, end: 9, text: 'Third, from A' },
      { speaker: 'SPEAKER_01', start: 8, end: 10, text: 'Fourth, from B' },
    ];

    const cellFor = (text: string) => screen.getByText(text).closest('.kanban-cell') as HTMLElement;

    it('gives every line its own row, in timestamp order regardless of speaker', () => {
      renderKanban({ segments: interleaved });

      expect(cellFor('First, from A').style.gridRow).toBe('2');
      expect(cellFor('Second, from B').style.gridRow).toBe('3');
      expect(cellFor('Third, from A').style.gridRow).toBe('4');
      // Same start time as the line above: still the next row, never side by side.
      expect(cellFor('Fourth, from B').style.gridRow).toBe('5');
    });

    it('places each line in its speaker column', () => {
      renderKanban({ segments: interleaved });

      expect(cellFor('First, from A').style.gridColumn).toBe('1');
      expect(cellFor('Second, from B').style.gridColumn).toBe('2');
      expect(cellFor('Third, from A').style.gridColumn).toBe('1');
      expect(cellFor('Fourth, from B').style.gridColumn).toBe('2');
    });

    it('renders bubbles in reading order for screen readers and keyboard focus', () => {
      const { container } = renderKanban({ segments: interleaved });

      const texts = [...container.querySelectorAll('.kanban-bubble-text')].map(
        (el) => el.textContent
      );
      expect(texts).toEqual(['First, from A', 'Second, from B', 'Third, from A', 'Fourth, from B']);
    });

    it('shows the time range under each bubble', () => {
      renderKanban({ segments: interleaved });

      const bubble = screen.getByText('Second, from B').closest('.kanban-bubble') as HTMLElement;
      expect(within(bubble).getByText('0:05 - 0:07')).toBeInTheDocument();
    });
  });

  it('requests deleting a bubble, leaving confirmation to the caller', () => {
    const onRequestDeleteSegment = vi.fn();
    const { props } = renderKanban({ onRequestDeleteSegment });

    const bubble = screen.getByText('Hi there').closest('.kanban-bubble') as HTMLElement;
    fireEvent.click(within(bubble).getByTitle('Delete this segment'));

    expect(onRequestDeleteSegment).toHaveBeenCalledWith(1);
    expect(props.onDeleteSegments).not.toHaveBeenCalled();
    expect(props.onSeekToSegment).not.toHaveBeenCalled();
  });

  it('hides the delete action in select mode', () => {
    renderKanban({ onRequestDeleteSegment: vi.fn(), selectMode: true });
    expect(screen.queryByTitle('Delete this segment')).not.toBeInTheDocument();
  });
});
