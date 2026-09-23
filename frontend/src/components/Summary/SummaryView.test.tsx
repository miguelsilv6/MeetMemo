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
});
