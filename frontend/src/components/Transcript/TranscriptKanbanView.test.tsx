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
});
