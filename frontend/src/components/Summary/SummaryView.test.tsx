import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SummaryView from './SummaryView';

vi.mock('../../services/api');

function renderView(overrides: Partial<ComponentProps<typeof SummaryView>> = {}) {
  const props = {
    summary: { summary: 'The team discussed the roadmap.' },
    transcript: { segments: [{ speaker: 'SPEAKER_00', start: 0, end: 2, text: 'Hello' }] },
    selectedFile: { name: 'meeting.mp3' },
    jobId: 'job1',
    handleEditSummary: vi.fn(),
    handleStartNewMeeting: vi.fn(),
    setCurrentStep: vi.fn(),
    ...overrides,
  };
  return { ...render(<SummaryView {...props} />), props };
}

describe('SummaryView', () => {
  it('navigates back to the transcript step', () => {
    const setCurrentStep = vi.fn();
    renderView({ setCurrentStep });

    fireEvent.click(screen.getByText('Back to Transcript'));

    expect(setCurrentStep).toHaveBeenCalledWith('transcript');
  });

  it('opens the edit modal via the handler', () => {
    const handleEditSummary = vi.fn();
    renderView({ handleEditSummary });

    fireEvent.click(screen.getByText('Edit'));

    expect(handleEditSummary).toHaveBeenCalled();
  });

  it('disables editing when there is no summary yet', () => {
    renderView({ summary: null });
    expect(screen.getByText('Edit').closest('button')).toBeDisabled();
  });

  it('offers a new summary only when given the handler (the administrator)', () => {
    renderView();
    expect(screen.queryByText('New summary')).not.toBeInTheDocument();
  });

  it('asks before replacing the summary, and starts it once confirmed', () => {
    const handleRegenerateSummary = vi.fn();
    renderView({ handleRegenerateSummary });

    fireEvent.click(screen.getByText('New summary'));
    expect(screen.getByText(/including any changes made by hand/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(handleRegenerateSummary).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('New summary'));
    fireEvent.click(screen.getByText('Generate new summary'));
    expect(handleRegenerateSummary).toHaveBeenCalledTimes(1);
  });

  it('shows a new summary being made, and why it failed', () => {
    const { rerender, props } = renderView({
      handleRegenerateSummary: vi.fn(),
      generatingSummary: true,
    });
    expect(screen.getByText('Generating...').closest('button')).toBeDisabled();
    expect(screen.getByText('Edit').closest('button')).toBeDisabled();

    rerender(<SummaryView {...props} generatingSummary={false} summaryError="LLM down" />);
    expect(screen.getByRole('alert')).toHaveTextContent('LLM down');
  });
});
