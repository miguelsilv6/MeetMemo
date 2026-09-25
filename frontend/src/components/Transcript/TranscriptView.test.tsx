import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import TranscriptView from './TranscriptView';
import type { TranscriptSegment as TranscriptSegmentType } from '../../types/api';

const segments: TranscriptSegmentType[] = [
  { speaker: 'SPEAKER_00', start: 0, end: 2, text: 'Hello everyone' },
  { speaker: 'SPEAKER_01', start: 2, end: 4, text: 'Hi there' },
  { speaker: 'SPEAKER_00', start: 4, end: 6, text: 'How are you' },
];

function renderView(overrides: Partial<ComponentProps<typeof TranscriptView>> = {}) {
  const props = {
    transcript: { segments },
    selectedFile: { name: 'meeting.mp3' },
    jobId: 'job1',
    handleEditSpeakers: vi.fn(),
    handleEditText: vi.fn(),
    handleMoveSegmentSpeaker: vi.fn(),
    handleBulkMoveSegments: vi.fn(),
    handleDeleteSegments: vi.fn(),
    handleInsertSegmentAfter: vi.fn(),
    handleRequestSplitSegment: vi.fn(),
    handleGenerateSummary: vi.fn(),
    generatingSummary: false,
    summary: null,
    identifyingSpeakers: false,
    translatedSegments: null,
    translating: false,
    showTranslation: false,
    handleToggleTranslation: vi.fn(),
    canUndo: false,
    handleUndo: vi.fn(),
    ...overrides,
  };
  return { ...render(<TranscriptView {...props} />), props };
}

describe('TranscriptView', () => {
  it('shows "Generate AI Summary" before a summary has been generated', () => {
    renderView({ summary: null });
    expect(screen.getByText('Generate AI Summary')).toBeInTheDocument();
  });

  it('shows "View Summary" once a summary already exists', () => {
    renderView({ summary: { summary: 'The team discussed the roadmap.' } });
    expect(screen.getByText('View Summary')).toBeInTheDocument();
    expect(screen.queryByText('Generate AI Summary')).not.toBeInTheDocument();
  });

  it('disables the undo button when there is nothing to undo', () => {
    renderView({ canUndo: false });
    expect(screen.getByTitle('Undo last change')).toBeDisabled();
  });

  it('calls handleUndo when the undo button is enabled and clicked', () => {
    const handleUndo = vi.fn();
    renderView({ canUndo: true, handleUndo });
    const undoButton = screen.getByTitle('Undo last change');
    expect(undoButton).not.toBeDisabled();
    fireEvent.click(undoButton);
    expect(handleUndo).toHaveBeenCalled();
  });

  it('enters select mode and shows checkboxes for every segment', () => {
    renderView();
    fireEvent.click(screen.getByTitle('Select multiple segments'));
    expect(screen.getAllByRole('checkbox')).toHaveLength(segments.length);
    expect(screen.getByText('0 segments selected')).toBeInTheDocument();
  });

  it('bulk-moves the selected segments to the chosen speaker and exits select mode', () => {
    const handleBulkMoveSegments = vi.fn();
    renderView({ handleBulkMoveSegments });

    fireEvent.click(screen.getByTitle('Select multiple segments'));
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[2]);
    expect(screen.getByText('2 segments selected')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Move to speaker...'), {
      target: { value: 'SPEAKER_01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));

    expect(handleBulkMoveSegments).toHaveBeenCalledWith([0, 2], 'SPEAKER_01');
    // Select mode is exited afterwards.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('asks for confirmation before bulk-deleting, then deletes on confirm', () => {
    const handleDeleteSegments = vi.fn();
    renderView({ handleDeleteSegments });

    fireEvent.click(screen.getByTitle('Select multiple segments'));
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete selected segments')).toBeInTheDocument();
    expect(handleDeleteSegments).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(handleDeleteSegments).toHaveBeenCalledWith([1]);
  });

  it('cancels selection without calling any bulk handler', () => {
    const handleDeleteSegments = vi.fn();
    const handleBulkMoveSegments = vi.fn();
    renderView({ handleDeleteSegments, handleBulkMoveSegments });

    fireEvent.click(screen.getByTitle('Select multiple segments'));
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(handleDeleteSegments).not.toHaveBeenCalled();
    expect(handleBulkMoveSegments).not.toHaveBeenCalled();
  });

  describe('translation button', () => {
    it('offers a translation for a transcript in another language', () => {
      const handleToggleTranslation = vi.fn();
      renderView({ transcript: { segments, language: 'en' }, handleToggleTranslation });

      fireEvent.click(screen.getByRole('button', { name: /translate to portuguese/i }));
      expect(handleToggleTranslation).toHaveBeenCalledWith(segments);
    });

    it('offers a translation when the language is unknown', () => {
      renderView({ transcript: { segments } });
      expect(screen.getByRole('button', { name: /translate to portuguese/i })).toBeInTheDocument();
    });

    it('shows block progress while translating', () => {
      renderView({
        transcript: { segments, language: 'en' },
        translating: true,
        translationProgress: { done: 15, total: 40 },
      });
      expect(screen.getByRole('button', { name: /translating… 15\/40/i })).toBeDisabled();
    });

    it('hides the translation for a transcript that is already in Portuguese', () => {
      renderView({ transcript: { segments, language: 'pt' } });
      expect(
        screen.queryByRole('button', { name: /translate to portuguese/i })
      ).not.toBeInTheDocument();
    });
  });

  describe('deleting a single segment', () => {
    const deleteButtonFor = (text: string) => {
      const row = screen.getByText(text).closest('.transcript-segment') as HTMLElement;
      return within(row).getByTitle('Delete this segment');
    };

    it('asks for confirmation, showing the segment, before deleting it', () => {
      const handleDeleteSegments = vi.fn();
      renderView({ handleDeleteSegments });

      fireEvent.click(deleteButtonFor('Hi there'));

      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('Delete segment?')).toBeInTheDocument();
      expect(within(dialog).getByText(/SPEAKER_01 · 0:02 - 0:04/)).toBeInTheDocument();
      expect(within(dialog).getByText('Hi there')).toBeInTheDocument();
      expect(handleDeleteSegments).not.toHaveBeenCalled();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
      expect(handleDeleteSegments).toHaveBeenCalledWith([1]);
    });

    it('keeps the segment when the confirmation is cancelled', () => {
      const handleDeleteSegments = vi.fn();
      renderView({ handleDeleteSegments });

      fireEvent.click(deleteButtonFor('How are you'));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

      expect(handleDeleteSegments).not.toHaveBeenCalled();
    });
  });
});
