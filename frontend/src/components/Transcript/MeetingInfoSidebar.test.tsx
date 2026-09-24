import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import MeetingInfoSidebar from './MeetingInfoSidebar';

function renderSidebar(overrides: Partial<ComponentProps<typeof MeetingInfoSidebar>> = {}) {
  const props = {
    selectedFile: { name: 'meeting.mp3' },
    transcript: null,
    identifyingSpeakers: false,
    handleGenerateSummary: vi.fn(),
    generatingSummary: false,
    summary: null,
    jobId: 'job1',
    ...overrides,
  };
  return { ...render(<MeetingInfoSidebar {...props} />), props };
}

describe('MeetingInfoSidebar detected language', () => {
  it('renders nothing language-related when the transcript has no language', () => {
    renderSidebar({ transcript: { segments: [] } });
    expect(screen.queryByText('Detected Language')).not.toBeInTheDocument();
  });

  it('shows a green badge for high-confidence detection', () => {
    renderSidebar({
      transcript: { segments: [], language: 'pt', language_probability: 0.95 },
    });

    const badge = screen.getByText('95%');
    expect(badge).toHaveClass('bg-success');
    expect(screen.getByText('Portuguese')).toBeInTheDocument();
  });

  it('shows a yellow badge for medium-confidence detection', () => {
    renderSidebar({
      transcript: { segments: [], language: 'en', language_probability: 0.6 },
    });

    expect(screen.getByText('60%')).toHaveClass('bg-warning');
  });

  it('shows a red badge for low-confidence detection', () => {
    renderSidebar({
      transcript: { segments: [], language: 'en', language_probability: 0.2 },
    });

    expect(screen.getByText('20%')).toHaveClass('bg-danger');
  });

  it('omits the confidence badge when the probability is unknown', () => {
    renderSidebar({ transcript: { segments: [], language: 'pt' } });

    expect(screen.getByText('Portuguese')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
