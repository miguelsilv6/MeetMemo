import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import MeetingInfoSidebar from './MeetingInfoSidebar';
import ProcessingInfoModal from './ProcessingInfoModal';
import * as adminApi from '../../services/adminApi';
import type { JobProcessingInfo } from '../../types/admin';

vi.mock('../../services/adminApi', () => ({
  getJobProcessing: vi.fn(),
  extendJobExpiry: vi.fn(),
}));
vi.mock('../../services/api', () => ({
  getJobStatus: vi.fn().mockResolvedValue({ expires_at: null }),
}));

const INFO: JobProcessingInfo = {
  file_name: 'call.wav',
  duration_seconds: 125.4,
  whisper_model: 'large-v3',
  language: { code: 'pt', probability: 0.93, forced: false },
  channel_mode: 'mono',
  num_speakers: 2,
  diarization_model: 'nvidia/Nemotron-3-Diarization',
  diarization_by_channels: false,
  settings: {
    beam_size: 7,
    temperature_fallback: true,
    vad_filter: false,
    vad_onset: 0.35,
    hallucination_silence_threshold: null,
    stereo_mode: 'auto',
    default_language: null,
    hallucination_phrases_count: 24,
  },
};

function renderModal() {
  return render(<ProcessingInfoModal show onHide={vi.fn()} jobId="job1" />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProcessingInfoModal', () => {
  it('shows the models, the language and the settings the audio was processed with', async () => {
    vi.mocked(adminApi.getJobProcessing).mockResolvedValue(INFO);
    renderModal();

    const body = await screen.findByTestId('processing-info');
    expect(await within(body).findByText('large-v3')).toBeInTheDocument();
    expect(adminApi.getJobProcessing).toHaveBeenCalledWith('job1');
    expect(within(body).getByText('nvidia/Nemotron-3-Diarization')).toBeInTheDocument();
    expect(within(body).getByText('Portuguese (93% confidence)')).toBeInTheDocument();
    expect(within(body).getByText('Mono (or channels mixed)')).toBeInTheDocument();
    expect(within(body).getByText('2:05')).toBeInTheDocument();
    // The settings, with the admin panel's labels.
    const row = (label: string) => within(body).getByText(label).closest('tr') as HTMLElement;
    expect(within(row('Beam size')).getByText('7')).toBeInTheDocument();
    expect(within(row('Voice activity detection (VAD)')).getByText('No')).toBeInTheDocument();
    expect(within(row('Temperature fallback')).getByText('Yes')).toBeInTheDocument();
    expect(within(row('Silence to skip (seconds)')).getByText('Off')).toBeInTheDocument();
    expect(
      within(row('Default transcription language')).getByText('Automatic')
    ).toBeInTheDocument();
    expect(within(body).getByText('24 phrases removed as hallucination')).toBeInTheDocument();
  });

  it('says so when the speakers came from the channels, and when the language was given', async () => {
    vi.mocked(adminApi.getJobProcessing).mockResolvedValue({
      ...INFO,
      channel_mode: 'split',
      diarization_model: 'channels',
      diarization_by_channels: true,
      language: { code: 'en', probability: null, forced: true },
      num_speakers: null,
    });
    renderModal();

    expect(
      await screen.findByText('Channels (one speaker per channel, no diarization model)')
    ).toBeInTheDocument();
    expect(screen.getByText('Stereo, transcribed per channel')).toBeInTheDocument();
    expect(screen.getByText('English (given, not detected)')).toBeInTheDocument();
    const given = screen.getByText('Speakers given').closest('tr') as HTMLElement;
    expect(within(given).getByText('Automatic')).toBeInTheDocument(); // none given
  });

  it('shows what it has for an audio processed before its settings were kept', async () => {
    vi.mocked(adminApi.getJobProcessing).mockResolvedValue({
      ...INFO,
      settings: null,
      diarization_model: null,
      channel_mode: null,
      language: null,
    });
    renderModal();

    expect(
      await screen.findByText('This audio was processed before its settings were kept with it.')
    ).toBeInTheDocument();
    expect(screen.getByText('Not identified yet')).toBeInTheDocument();
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);
    expect(screen.queryByText('Beam size')).not.toBeInTheDocument();
  });

  it('says when the information could not be had', async () => {
    vi.mocked(adminApi.getJobProcessing).mockRejectedValue(new Error('boom'));
    renderModal();

    expect(
      await screen.findByText('Could not get the processing information.')
    ).toBeInTheDocument();
  });

  it('asks again each time it opens', async () => {
    vi.mocked(adminApi.getJobProcessing).mockResolvedValue(INFO);
    const { rerender } = render(<ProcessingInfoModal show onHide={vi.fn()} jobId="job1" />);
    await screen.findByText('large-v3');

    rerender(<ProcessingInfoModal show={false} onHide={vi.fn()} jobId="job1" />);
    rerender(<ProcessingInfoModal show onHide={vi.fn()} jobId="job1" />);

    await screen.findByText('large-v3');
    expect(adminApi.getJobProcessing).toHaveBeenCalledTimes(2);
  });
});

describe('MeetingInfoSidebar processing information', () => {
  const sidebar = (isAdmin: boolean) =>
    render(
      <MeetingInfoSidebar
        selectedFile={{ name: 'call.wav' }}
        transcript={null}
        handleGenerateSummary={vi.fn()}
        generatingSummary={false}
        summary={null}
        jobId="job1"
        isAdmin={isAdmin}
      />
    );

  it('is offered to the administrator, who opens it', async () => {
    vi.mocked(adminApi.getJobProcessing).mockResolvedValue(INFO);
    sidebar(true);

    expect(adminApi.getJobProcessing).not.toHaveBeenCalled(); // nothing asked until opened
    fireEvent.click(screen.getByRole('button', { name: 'Processing information' }));

    expect(await screen.findByText('How this audio was processed')).toBeInTheDocument();
    expect(await screen.findByText('large-v3')).toBeInTheDocument();
  });

  it('is not offered to anyone else', () => {
    sidebar(false);

    expect(screen.queryByRole('button', { name: 'Processing information' })).toBeNull();
    expect(adminApi.getJobProcessing).not.toHaveBeenCalled();
  });
});
