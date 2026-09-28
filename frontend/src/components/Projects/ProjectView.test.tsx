import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import ProjectView, { PROJECT_POLL_MS } from './ProjectView';
import * as projectsApi from '../../services/projectsApi';
import type { ProjectAudio, ProjectDetail } from '../../types/projects';

vi.mock('../../services/api', () => ({
  getPublicConfig: vi.fn().mockResolvedValue({ default_language: null, max_upload_mb: 1 }),
}));

vi.mock('../../services/projectsApi', () => ({
  getProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  uploadProjectAudios: vi.fn(),
  retryProjectAudio: vi.fn(),
  deleteProjectAudio: vi.fn(),
}));

function audio(uuid: string, status: ProjectAudio['status'], extra = {}): ProjectAudio {
  return {
    uuid,
    file_name: `${uuid}.wav`,
    status,
    workflow_state: status === 'completed' ? 'completed' : 'uploaded',
    progress: status === 'completed' ? 100 : 0,
    queue_position: null,
    error_message: null,
    language: null,
    created_at: '2026-09-27T10:00:00Z',
    ...extra,
  };
}

function project(audios: ProjectAudio[]): ProjectDetail {
  return {
    uuid: 'p1',
    name: 'Inquiry 12',
    reference: 'NUIPC 1/26',
    description: 'Calls seized on 26/09',
    created_at: '2026-09-27T10:00:00Z',
    expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000 - 60_000).toISOString(),
    audios,
  };
}

function renderView(overrides = {}) {
  const props = { projectUuid: 'p1', onBack: vi.fn(), onOpenAudio: vi.fn(), ...overrides };
  render(<ProjectView {...props} />);
  return props;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ProjectView', () => {
  it('shows the details, the automatic deletion date and each audio status', async () => {
    vi.mocked(projectsApi.getProject).mockResolvedValue(
      project([
        audio('done', 'completed'),
        audio('running', 'processing', { progress: 45 }),
        audio('waiting', 'queued', { queue_position: 2 }),
        audio('broken', 'error', { error_message: 'Transcription failed: bad file' }),
      ])
    );
    renderView();

    expect(await screen.findByText('Inquiry 12')).toBeInTheDocument();
    expect(screen.getByText('Reference: NUIPC 1/26')).toBeInTheDocument();
    expect(screen.getByText('Calls seized on 26/09')).toBeInTheDocument();
    expect(
      screen.getByText(/will be deleted automatically on .* \(in 7 days\)/)
    ).toBeInTheDocument();
    expect(screen.getByText('4 audios')).toBeInTheDocument();

    const row = (name: string) =>
      screen.getByText(`${name}.wav`).closest('[data-status]') as HTMLElement;
    expect(within(row('done')).getByText('Completed')).toBeInTheDocument();
    expect(within(row('running')).getByText('Processing · 45%')).toBeInTheDocument();
    expect(within(row('waiting')).getByText('Queued (no. 2)')).toBeInTheDocument();
    expect(within(row('broken')).getByText('Transcription failed: bad file')).toBeInTheDocument();
  });

  it('refreshes while audios are waiting and stops once all are done', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(projectsApi.getProject)
      .mockResolvedValueOnce(project([audio('a', 'queued', { queue_position: 1 })]))
      .mockResolvedValueOnce(project([audio('a', 'processing', { progress: 50 })]))
      .mockResolvedValue(project([audio('a', 'completed')]));
    renderView();

    expect(await screen.findByText('Queued (no. 1)')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROJECT_POLL_MS);
    });
    expect(await screen.findByText('Processing · 50%')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROJECT_POLL_MS);
    });
    expect(await screen.findByText('Completed')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROJECT_POLL_MS * 3);
    });
    expect(projectsApi.getProject).toHaveBeenCalledTimes(3);
  });

  it('refreshes the token balance when an audio fails (its token comes back)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(projectsApi.getProject)
      .mockResolvedValueOnce(project([audio('a', 'processing', { progress: 10 })]))
      .mockResolvedValue(project([audio('a', 'error', { error_message: 'boom' })]));
    const onBalanceChange = vi.fn();
    renderView({ onBalanceChange });

    expect(await screen.findByText('Processing · 10%')).toBeInTheDocument();
    expect(onBalanceChange).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROJECT_POLL_MS);
    });
    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(onBalanceChange).toHaveBeenCalledTimes(1);
  });

  it('uploads several files one by one and reports each result', async () => {
    vi.mocked(projectsApi.getProject).mockResolvedValue(project([]));
    vi.mocked(projectsApi.uploadProjectAudios)
      .mockResolvedValueOnce([{ file_name: 'one.wav', status: 'queued', uuid: 'j1' }])
      .mockResolvedValueOnce([
        { file_name: 'two.mp3', status: 'duplicate', uuid: 'j1', detail: 'one.wav' },
      ]);
    renderView();
    await screen.findByText('No audios in this project yet.');

    const files = [
      new File(['1'], 'one.wav', { type: 'audio/wav' }),
      new File(['2'], 'two.mp3', { type: 'audio/mpeg' }),
      new File(['n'], 'notes.txt', { type: 'text/plain' }),
    ];
    fireEvent.change(screen.getByLabelText('Choose one or more files'), { target: { files } });

    expect(await screen.findByText(/unsupported format/)).toBeInTheDocument();
    expect(screen.getByText(/queued for processing/)).toBeInTheDocument();
    expect(
      screen.getByText(/already in this project \(as one\.wav\), skipped/)
    ).toBeInTheDocument();
    expect(projectsApi.uploadProjectAudios).toHaveBeenCalledTimes(2);
    expect(vi.mocked(projectsApi.uploadProjectAudios).mock.calls[0][1]).toEqual([files[0]]);
    // The list is refreshed after each stored file.
    expect(projectsApi.getProject).toHaveBeenCalledTimes(3);
  });

  it('skips files over the upload limit without sending them', async () => {
    vi.mocked(projectsApi.getProject).mockResolvedValue(project([]));
    renderView();
    expect(await screen.findByText(/\(max 1 MB\)/)).toBeInTheDocument();

    const big = new File(['x'], 'long.wav', { type: 'audio/wav' });
    Object.defineProperty(big, 'size', { value: 2 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText('Choose one or more files'), {
      target: { files: [big] },
    });

    expect(await screen.findByText(/over the 1 MB limit per file/)).toBeInTheDocument();
    expect(projectsApi.uploadProjectAudios).not.toHaveBeenCalled();
  });

  it('blocks uploads without tokens and stops sending once they run out', async () => {
    vi.mocked(projectsApi.getProject).mockResolvedValue(project([]));
    vi.mocked(projectsApi.uploadProjectAudios)
      .mockResolvedValueOnce([{ file_name: 'one.wav', status: 'queued', uuid: 'j1' }])
      .mockResolvedValueOnce([{ file_name: 'two.wav', status: 'no_tokens' }]);
    const onBalanceChange = vi.fn();
    renderView({ tokenBalance: 2, onBalanceChange });
    await screen.findByText('No audios in this project yet.');

    const files = ['one.wav', 'two.wav', 'three.wav'].map(
      (name) => new File(['x'], name, { type: 'audio/wav' })
    );
    fireEvent.change(screen.getByLabelText('Choose one or more files'), { target: { files } });

    expect(await screen.findAllByText(/not uploaded: you have no tokens left/)).toHaveLength(2);
    // The third file was never sent: the second showed the tokens had run out.
    expect(projectsApi.uploadProjectAudios).toHaveBeenCalledTimes(2);
    expect(onBalanceChange).toHaveBeenCalled();
  });

  it('explains that uploading needs tokens when the balance is zero', async () => {
    vi.mocked(projectsApi.getProject).mockResolvedValue(project([]));
    renderView({ tokenBalance: 0 });
    expect(await screen.findByText(/You have no tokens left/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /choose one or more files/i })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  it('opens completed audios and retries failed ones', async () => {
    const done = audio('done', 'completed');
    vi.mocked(projectsApi.getProject).mockResolvedValue(project([done, audio('broken', 'error')]));
    vi.mocked(projectsApi.retryProjectAudio).mockResolvedValue(undefined);
    const props = renderView();
    await screen.findByText('Inquiry 12');

    fireEvent.click(screen.getByRole('button', { name: /open transcript/i }));
    expect(props.onOpenAudio).toHaveBeenCalledWith(expect.objectContaining({ uuid: 'p1' }), done);

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(projectsApi.retryProjectAudio).toHaveBeenCalledWith('p1', 'broken'));
  });

  it('deletes an audio or the whole project only after confirmation', async () => {
    vi.mocked(projectsApi.getProject).mockResolvedValue(project([audio('a', 'completed')]));
    vi.mocked(projectsApi.deleteProjectAudio).mockResolvedValue(undefined);
    vi.mocked(projectsApi.deleteProject).mockResolvedValue(undefined);
    const props = renderView();
    await screen.findByText('Inquiry 12');

    fireEvent.click(screen.getByRole('button', { name: 'Delete a.wav' }));
    expect(screen.getByText(/Delete “a\.wav” from this project/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(projectsApi.deleteProjectAudio).toHaveBeenCalledWith('p1', 'a'));

    fireEvent.click(screen.getByRole('button', { name: /delete project/i }));
    expect(
      await screen.findByText(/Delete the project “Inquiry 12” and its audio/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(props.onBack).toHaveBeenCalled());
    expect(projectsApi.deleteProject).toHaveBeenCalledWith('p1');
  });

  it('explains that an expired project is gone', async () => {
    vi.mocked(projectsApi.getProject).mockRejectedValue(
      Object.assign(new Error('Project not found'), { status: 404 })
    );
    renderView();
    expect(await screen.findByText(/does not exist or has already expired/)).toBeInTheDocument();
  });
});
