import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TranscriptSegment from './TranscriptSegment';
import type { TranscriptSegment as TranscriptSegmentType } from '../../types/api';

const segment: TranscriptSegmentType = {
  speaker: 'SPEAKER_00',
  start: 65,
  end: 70,
  text: 'Welcome everyone',
};

function renderSegment(overrides: Partial<ComponentProps<typeof TranscriptSegment>> = {}) {
  const props = {
    segment,
    index: 0,
    handleEditText: vi.fn(),
    isActive: false,
    onSeekToSegment: vi.fn(),
    onInsertSegmentAfter: vi.fn(),
    onSplitSegment: vi.fn(),
    ...overrides,
  };
  return { ...render(<TranscriptSegment {...props} />), props };
}

describe('TranscriptSegment', () => {
  it('renders the speaker, text, and formatted timestamps', () => {
    renderSegment();
    expect(screen.getByText('SPEAKER_00')).toBeInTheDocument();
    expect(screen.getByText('Welcome everyone')).toBeInTheDocument();
    expect(screen.getByText('1:05 - 1:10')).toBeInTheDocument();
  });

  it('seeks to the segment start when clicked', () => {
    const onSeekToSegment = vi.fn();
    renderSegment({ onSeekToSegment });
    fireEvent.click(screen.getByText('Welcome everyone'));
    expect(onSeekToSegment).toHaveBeenCalledWith(65);
  });

  it('renders displayText instead of the original text when provided', () => {
    renderSegment({ displayText: 'Bem-vindos a todos' });
    expect(screen.getByText('Bem-vindos a todos')).toBeInTheDocument();
    expect(screen.queryByText('Welcome everyone')).not.toBeInTheDocument();
  });

  it('hands the original segment to the edit modal even while displayText is shown', () => {
    const handleEditText = vi.fn();
    renderSegment({ displayText: 'Bem-vindos a todos', handleEditText });
    fireEvent.click(screen.getByTitle('Edit this segment'));
    expect(handleEditText).toHaveBeenCalledWith(segment, 0);
  });

  it('opens the edit modal without also seeking', () => {
    const handleEditText = vi.fn();
    const onSeekToSegment = vi.fn();
    renderSegment({ index: 3, handleEditText, onSeekToSegment });
    fireEvent.click(screen.getByTitle('Edit this segment'));
    expect(handleEditText).toHaveBeenCalledWith(segment, 3);
    expect(onSeekToSegment).not.toHaveBeenCalled();
  });

  it('opens the edit modal on double-click', () => {
    const handleEditText = vi.fn();
    renderSegment({ index: 2, handleEditText });
    fireEvent.doubleClick(screen.getByText('Welcome everyone'));
    expect(handleEditText).toHaveBeenCalledWith(segment, 2);
  });

  it('requests inserting a segment after this one', () => {
    const onInsertSegmentAfter = vi.fn();
    renderSegment({ index: 4, onInsertSegmentAfter });
    fireEvent.click(screen.getByTitle('Insert segment after this one'));
    expect(onInsertSegmentAfter).toHaveBeenCalledWith(4);
  });

  it('requests splitting this segment', () => {
    const onSplitSegment = vi.fn();
    renderSegment({ index: 1, onSplitSegment });
    fireEvent.click(screen.getByTitle('Split into two speakers'));
    expect(onSplitSegment).toHaveBeenCalledWith(segment, 1);
  });

  it('shows a checkbox and hides the action buttons in select mode', () => {
    renderSegment({ selectMode: true });
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
    expect(screen.queryByTitle('Edit this segment')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Insert segment after this one')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Split into two speakers')).not.toBeInTheDocument();
  });

  it('toggles selection when clicked in select mode, instead of seeking', () => {
    const onToggleSelect = vi.fn();
    const onSeekToSegment = vi.fn();
    renderSegment({ selectMode: true, index: 2, onToggleSelect, onSeekToSegment });

    fireEvent.click(screen.getByText('Welcome everyone'));

    expect(onToggleSelect).toHaveBeenCalledWith(2);
    expect(onSeekToSegment).not.toHaveBeenCalled();
  });

  it('toggles selection via the checkbox itself', () => {
    const onToggleSelect = vi.fn();
    renderSegment({ selectMode: true, index: 5, onToggleSelect });

    fireEvent.click(screen.getByRole('checkbox'));

    expect(onToggleSelect).toHaveBeenCalledWith(5);
  });

  it('reflects the isSelected prop on the checkbox', () => {
    renderSegment({ selectMode: true, isSelected: true });
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('does not open the edit modal on double-click while in select mode', () => {
    const handleEditText = vi.fn();
    renderSegment({ selectMode: true, handleEditText });
    fireEvent.doubleClick(screen.getByText('Welcome everyone'));
    expect(handleEditText).not.toHaveBeenCalled();
  });

  it('flags a low-confidence segment for review', () => {
    renderSegment({ segment: { ...segment, low_confidence: true } });
    expect(screen.getByText('Review')).toHaveAttribute(
      'title',
      'Low confidence: check this line against the audio'
    );
  });

  it('shows no review flag for a normal segment', () => {
    renderSegment();
    expect(screen.queryByText('Review')).not.toBeInTheDocument();
  });
});
