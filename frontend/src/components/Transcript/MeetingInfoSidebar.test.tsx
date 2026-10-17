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

describe('MeetingInfoSidebar language detection details', () => {
  const detected = {
    language: 'pt',
    probability: 0.86,
    candidates: [
      ['pt', 0.86],
      ['es', 0.09],
      ['gl', 0.004],
    ] as [string, number][],
    windows: [],
    agreement: 1,
    flags: [],
  };

  it('lists the other candidate languages', () => {
    renderSidebar({
      transcript: {
        segments: [],
        language: 'pt',
        language_probability: 0.86,
        language_detection: detected,
      },
    });
    // Below 1% is noise and left out.
    expect(screen.getByTestId('language-candidates')).toHaveTextContent(
      'Other candidates: Spanish 9%'
    );
  });

  it('warns about each flag and offers to transcribe again, suggesting the runner-up', async () => {
    renderSidebar({
      transcript: {
        segments: [],
        language: 'pt',
        language_probability: 0.86,
        language_detection: { ...detected, flags: ['mixed_languages', 'possibly_unsupported'] },
      },
      onRetranscribe: vi.fn(),
      retranscribeLanguage: 'en',
    });

    expect(screen.getByTestId('language-flag-mixed_languages')).toHaveTextContent(
      /seems to change during the recording/
    );
    expect(screen.getByTestId('language-flag-possibly_unsupported')).toHaveTextContent(/creole/);
    // Offered despite 86%: the flags say the detection deserves a second look.
    fireEvent.click(
      screen.getByRole('button', { name: /choose the language and transcribe again/i })
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Language of the communication')).toHaveValue('es');
  });

  it('says when the language was set rather than detected', () => {
    renderSidebar({
      transcript: {
        segments: [],
        language: 'ro',
        language_probability: null,
        language_detection: { forced: true },
      },
      onRetranscribe: vi.fn(),
    });
    expect(screen.getByText('Language set (not detected).')).toBeInTheDocument();
    expect(screen.queryByText('Detected Language')).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('low-confidence')).not.toBeInTheDocument();
  });
});

describe('MeetingInfoSidebar calls transcribed per channel', () => {
  const channelTranscript = {
    segments: [],
    language: 'pt',
    language_probability: 0.96,
    language_detection: {
      language: 'pt',
      probability: 0.96,
      candidates: [['pt', 0.96]] as [string, number][],
      flags: [],
      channels: [
        {
          channel: 0,
          speaker: 'SPEAKER_00',
          language: 'pt',
          probability: 0.96,
          flags: [],
          forced: false,
          speech_seconds: 40,
        },
        {
          channel: 1,
          speaker: 'SPEAKER_01',
          language: 'ro',
          probability: 0.55,
          flags: ['uncertain' as const],
          forced: false,
          speech_seconds: 20,
        },
      ],
    },
  };

  it("shows each side's language and the doubts about either", async () => {
    renderSidebar({ transcript: channelTranscript, onRetranscribe: vi.fn() });

    const list = screen.getByTestId('channel-languages');
    expect(list).toHaveTextContent('Left channel (SPEAKER_00)Portuguese96%');
    expect(list).toHaveTextContent('Right channel (SPEAKER_01)Romanian55%');
    // The right side's doubt is shown and offers a new transcription…
    expect(screen.getByTestId('language-flag-uncertain')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: /choose the language and transcribe again/i })
    );
    // …warning that the choice applies to both sides.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('channels-differ')).toHaveTextContent(/both channels/);
  });
});
