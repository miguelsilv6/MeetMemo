import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MeetingInfoSidebar from './MeetingInfoSidebar';

function renderSidebar(overrides: Partial<ComponentProps<typeof MeetingInfoSidebar>> = {}) {
  const props = {
    selectedFile: { name: 'meeting.mp3' },
    transcript: null,
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

describe('MeetingInfoSidebar re-transcription', () => {
  it('is not offered when the language was detected with high confidence', () => {
    renderSidebar({
      transcript: { segments: [], language: 'pt', language_probability: 0.8 },
      onRetranscribe: vi.fn(),
    });
    expect(screen.queryByTestId('low-confidence')).not.toBeInTheDocument();
  });

  it('is not offered without a way to start it', () => {
    renderSidebar({ transcript: { segments: [], language: 'en', language_probability: 0.3 } });
    expect(screen.queryByTestId('low-confidence')).not.toBeInTheDocument();
  });

  it('lets the user choose another language on low confidence and warns what is lost', async () => {
    const onRetranscribe = vi.fn().mockResolvedValue(undefined);
    renderSidebar({
      transcript: { segments: [], language: 'en', language_probability: 0.62 },
      onRetranscribe,
    });

    expect(screen.getByTestId('low-confidence')).toHaveTextContent(/low confidence/i);
    fireEvent.click(
      screen.getByRole('button', { name: /choose the language and transcribe again/i })
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Detected language: English/)).toBeInTheDocument();
    expect(within(dialog).getByText(/summary, translations and exports/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: /^transcribe again$/i });
    expect(confirm).toBeDisabled(); // no language chosen yet
    const select = within(dialog).getByLabelText('Language of the communication');
    // The detected language is not offered again.
    expect(within(select).queryByRole('option', { name: 'English (en)' })).toBeNull();
    fireEvent.change(select, { target: { value: 'pt' } });
    fireEvent.click(confirm);

    await waitFor(() => expect(onRetranscribe).toHaveBeenCalledWith('pt'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps the dialog open with the reason when it cannot start', async () => {
    const onRetranscribe = vi
      .fn()
      .mockRejectedValue(
        new Error('Only an audio whose processing has finished can be transcribed again.')
      );
    renderSidebar({
      transcript: { segments: [], language: 'en', language_probability: 0.2 },
      onRetranscribe,
      retranscribeLanguage: 'pt',
    });
    fireEvent.click(
      screen.getByRole('button', { name: /choose the language and transcribe again/i })
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Language of the communication')).toHaveValue('pt');
    fireEvent.click(within(dialog).getByRole('button', { name: /^transcribe again$/i }));

    expect(await within(dialog).findByText(/processing has finished/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
