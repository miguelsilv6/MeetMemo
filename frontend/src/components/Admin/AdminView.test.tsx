import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AdminView from './AdminView';
import * as adminApi from '../../services/adminApi';
import type { AdminSettingsResponse, RuntimeSettings } from '../../types/admin';

vi.mock('../../services/adminApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/adminApi')>();
  return {
    ...actual,
    getAdminStatus: vi.fn(),
    getAdminSession: vi.fn(),
    adminLogin: vi.fn(),
    adminLogout: vi.fn(),
    getAdminSettings: vi.fn(),
    saveAdminSettings: vi.fn(),
    getAdminAudit: vi.fn(),
    listUsers: vi.fn(),
    changeAdminPassword: vi.fn(),
  };
});

const settings: RuntimeSettings = {
  whisper_model_name: 'large-v3',
  beam_size: 5,
  temperature_fallback: true,
  vad_filter: true,
  vad_onset: 0.35,
  vad_offset: 0.2,
  vad_min_silence_ms: 1000,
  vad_speech_pad_ms: 400,
  hallucination_silence_threshold: 2,
  low_confidence_avg_logprob: -1,
  low_confidence_no_speech_prob: 0.6,
  low_confidence_compression_ratio: 2.4,
  hallucination_phrases: ['Obrigado por assistir'],
  audio_highpass: true,
  audio_loudnorm: true,
  default_language: null,
  job_retention_hours: 12,
  project_retention_days: 7,
  max_upload_mb: 100,
  llm_summary_system_prompt: 'Default system prompt.',
  llm_summary_request: 'Default request.',
  llm_language_rule: 'Default language rule.',
  llm_language_reminder: 'Default reminder.',
  llm_translation_instructions: 'Default translation instructions.',
};

const settingsResponse: AdminSettingsResponse = {
  settings,
  defaults: settings,
  allowed_models: ['large-v3', 'turbo'],
  languages: ['en', 'pt'],
  restart_only: {
    hardware_profile: 'cpu',
    device: 'cpu',
    compute_type: 'int8',
    diarization_model: 'pyannote/speaker-diarization-3.1',
  },
  fixed_prompts: {
    translation_output_contract: 'Return ONLY a JSON array.',
    qwen3_no_think: '/no_think',
  },
};

const unauthorized = () => new adminApi.AdminApiError(401, 'Not authenticated');

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  vi.mocked(adminApi.getAdminStatus).mockResolvedValue({ configured: true });
  vi.mocked(adminApi.getAdminSession).mockResolvedValue({ username: 'admin' });
  vi.mocked(adminApi.getAdminSettings).mockResolvedValue(settingsResponse);
  vi.mocked(adminApi.getAdminAudit).mockResolvedValue([]);
  vi.mocked(adminApi.listUsers).mockResolvedValue([]);
});

const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(`^${name}`) });

async function renderSignedIn() {
  const view = render(<AdminView onExit={vi.fn()} />);
  await screen.findByRole('tablist');
  return view;
}

function openTab(name: string) {
  fireEvent.click(tab(name));
}

describe('AdminView', () => {
  it('explains how to enable the panel when no admin account exists', async () => {
    vi.mocked(adminApi.getAdminStatus).mockResolvedValue({ configured: false });
    render(<AdminView onExit={vi.fn()} />);
    expect(await screen.findByText('Admin panel not configured')).toBeInTheDocument();
    expect(adminApi.getAdminSession).not.toHaveBeenCalled();
  });

  it('asks to sign in, then shows the dashboard', async () => {
    vi.mocked(adminApi.getAdminSession).mockRejectedValue(unauthorized());
    vi.mocked(adminApi.adminLogin).mockResolvedValue({ username: 'admin' });
    render(<AdminView onExit={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('tablist')).toBeInTheDocument();
    expect(tab('Transcription')).toHaveAttribute('aria-selected', 'true');
    expect(adminApi.adminLogin).toHaveBeenCalledWith('admin', 'secret');
    expect(screen.getByText('Signed in as admin')).toBeInTheDocument();
  });

  it('shows a generic error for wrong credentials', async () => {
    vi.mocked(adminApi.getAdminSession).mockRejectedValue(unauthorized());
    vi.mocked(adminApi.adminLogin).mockRejectedValue(unauthorized());
    render(<AdminView onExit={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'y' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Invalid username or password.')).toBeInTheDocument();
  });

  it('saves edited settings and refreshes the change history', async () => {
    vi.mocked(adminApi.saveAdminSettings).mockResolvedValue({
      settings: { ...settings, beam_size: 3 },
      changed: ['beam_size'],
    });
    await renderSignedIn();

    fireEvent.change(screen.getByLabelText('Beam size'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('1 setting saved.')).toBeInTheDocument();
    expect(adminApi.saveAdminSettings).toHaveBeenCalledWith(
      expect.objectContaining({ beam_size: 3, whisper_model_name: 'large-v3' })
    );
    expect(adminApi.getAdminAudit).toHaveBeenCalledTimes(2);
  });

  it('sends phrases as trimmed lines', async () => {
    vi.mocked(adminApi.saveAdminSettings).mockResolvedValue({ settings, changed: [] });
    await renderSignedIn();

    fireEvent.change(screen.getByLabelText('Phrases removed as hallucinations'), {
      target: { value: 'Obrigado por assistir\n\n  Legendas   extra  \n' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(adminApi.saveAdminSettings).toHaveBeenCalled());
    expect(vi.mocked(adminApi.saveAdminSettings).mock.calls[0][0].hallucination_phrases).toEqual([
      'Obrigado por assistir',
      'Legendas extra',
    ]);
  });

  it('blocks saving while a field is invalid', async () => {
    await renderSignedIn();

    fireEvent.change(screen.getByLabelText('VAD silence threshold'), {
      target: { value: '0.5' },
    });
    expect(screen.getByText('Must be lower than the speech threshold.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(
      await screen.findByText('Fix the highlighted fields before saving.')
    ).toBeInTheDocument();
    expect(adminApi.saveAdminSettings).not.toHaveBeenCalled();
  });

  it('says there is nothing to save when nothing changed', async () => {
    await renderSignedIn();
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText('No changes to save.')).toBeInTheDocument();
    expect(adminApi.saveAdminSettings).not.toHaveBeenCalled();
  });

  it('returns to the sign-in form when the session expired during a save', async () => {
    vi.mocked(adminApi.saveAdminSettings).mockRejectedValue(unauthorized());
    await renderSignedIn();

    fireEvent.change(screen.getByLabelText('Beam size'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('Administrator sign-in')).toBeInTheDocument();
  });

  it('signs out', async () => {
    vi.mocked(adminApi.adminLogout).mockResolvedValue(undefined);
    await renderSignedIn();

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    expect(await screen.findByText('Administrator sign-in')).toBeInTheDocument();
    expect(adminApi.adminLogout).toHaveBeenCalled();
  });

  it('lists the change history with readable setting names', async () => {
    vi.mocked(adminApi.getAdminAudit).mockResolvedValue([
      {
        id: 2,
        changed_at: '2026-09-25T10:00:00Z',
        actor: 'admin',
        setting_key: 'beam_size',
        old_value: 5,
        new_value: 3,
      },
      {
        id: 1,
        changed_at: '2026-09-25T09:00:00Z',
        actor: 'admin',
        setting_key: 'admin_password',
        old_value: null,
        new_value: null,
      },
    ]);
    await renderSignedIn();
    openTab('History');

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]).getByText('Beam size')).toBeInTheDocument();
    expect(within(rows[1]).getByText('5')).toBeInTheDocument();
    expect(within(rows[1]).getByText('3')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Admin password changed')).toBeInTheDocument();
  });

  it('saves an edited prompt and resets a prompt to its default', async () => {
    vi.mocked(adminApi.saveAdminSettings).mockResolvedValue({
      settings: { ...settings, llm_summary_request: 'Resume em três pontos.' },
      changed: ['llm_summary_request'],
    });
    await renderSignedIn();
    openTab('Prompts');

    const request = screen.getByLabelText(/Summary: request/);
    fireEvent.change(request, { target: { value: '  Resume em três pontos.\r\n' } });
    expect(
      within(request.closest('.form-group, .mb-4') as HTMLElement).getByText('(edited)')
    ).toBeInTheDocument();

    // Reset another edited prompt back to its default.
    const reminder = screen.getByLabelText(/Final reminder/);
    fireEvent.change(reminder, { target: { value: 'Other reminder.' } });
    const resetButtons = screen.getAllByRole('button', { name: 'Reset to default' });
    fireEvent.click(resetButtons[4]);
    expect(reminder).toHaveValue('Default reminder.');

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(adminApi.saveAdminSettings).toHaveBeenCalled());
    const saved = vi.mocked(adminApi.saveAdminSettings).mock.calls[0][0];
    expect(saved.llm_summary_request).toBe('Resume em três pontos.');
    expect(saved.llm_language_reminder).toBe('Default reminder.');
  });

  it('treats an emptied prompt as its default', async () => {
    await renderSignedIn();
    openTab('Prompts');

    fireEvent.change(screen.getByLabelText(/Summary: system instructions/), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('No changes to save.')).toBeInTheDocument();
    expect(adminApi.saveAdminSettings).not.toHaveBeenCalled();
  });

  it('blocks saving an overlong prompt', async () => {
    await renderSignedIn();
    openTab('Prompts');

    fireEvent.change(screen.getByLabelText(/Final reminder/), {
      target: { value: 'x'.repeat(1001) },
    });

    expect(screen.getByText('At most 1000 characters.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(adminApi.saveAdminSettings).not.toHaveBeenCalled();
  });

  it('shows the fixed prompt parts read-only', async () => {
    await renderSignedIn();
    openTab('Prompts');
    expect(screen.getByText('Return ONLY a JSON array.')).toBeInTheDocument();
    expect(screen.getByText('/no_think')).toBeInTheDocument();
  });

  it('collapses long prompt changes in the history', async () => {
    const longPrompt = 'A '.repeat(100).trim();
    vi.mocked(adminApi.getAdminAudit).mockResolvedValue([
      {
        id: 3,
        changed_at: '2026-09-25T11:00:00Z',
        actor: 'admin',
        setting_key: 'llm_summary_system_prompt',
        old_value: longPrompt,
        new_value: 'Short.',
      },
    ]);
    await renderSignedIn();
    openTab('History');

    const row = within(screen.getByRole('table')).getAllByRole('row')[1];
    expect(within(row).getByText('Summary: system instructions')).toBeInTheDocument();
    expect(within(row).getByText(longPrompt)).toBeInTheDocument(); // full text, collapsed
    expect(row.querySelector('details summary')?.textContent?.endsWith('…')).toBe(true);
    expect(within(row).getByText('Short.')).toBeInTheDocument();
  });

  it('shows restart-only configuration read-only', async () => {
    await renderSignedIn();
    openTab('System');
    expect(screen.getByText('int8')).toBeInTheDocument();
    expect(screen.getByText('pyannote/speaker-diarization-3.1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
  });

  it('shows only the selected tab', async () => {
    await renderSignedIn();
    expect(screen.getByLabelText('Beam size')).toBeInTheDocument();
    expect(screen.queryByLabelText('Maximum size per file (MB)')).not.toBeInTheDocument();

    openTab('Uploads');
    expect(tab('Uploads')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Transcription')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByLabelText('Maximum size per file (MB)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Beam size')).not.toBeInTheDocument();

    openTab('Security');
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /change password/i })).toBeVisible();
  });

  it('keeps unsaved edits across tabs and marks the tab that has them', async () => {
    vi.mocked(adminApi.saveAdminSettings).mockResolvedValue({
      settings: { ...settings, beam_size: 3 },
      changed: ['beam_size'],
    });
    await renderSignedIn();

    fireEvent.change(screen.getByLabelText('Beam size'), { target: { value: '3' } });
    expect(tab('Transcription')).toHaveAccessibleName(/unsaved changes/);
    expect(tab('Uploads')).not.toHaveAccessibleName(/unsaved changes/);

    openTab('Users');
    openTab('Transcription');
    expect(screen.getByLabelText('Beam size')).toHaveValue(3);

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText('1 setting saved.')).toBeInTheDocument();
    expect(adminApi.saveAdminSettings).toHaveBeenCalledWith(
      expect.objectContaining({ beam_size: 3 })
    );
    expect(tab('Transcription')).not.toHaveAccessibleName(/unsaved changes/);
  });

  it('jumps to the tab with an invalid field when saving from another tab', async () => {
    await renderSignedIn();
    fireEvent.change(screen.getByLabelText('VAD silence threshold'), {
      target: { value: '0.5' },
    });
    expect(tab('Transcription')).toHaveAccessibleName(/has errors/);

    openTab('Uploads');
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(tab('Transcription')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Must be lower than the speech threshold.')).toBeInTheDocument();
    expect(screen.getByText('Fix the highlighted fields before saving.')).toBeInTheDocument();
    expect(adminApi.saveAdminSettings).not.toHaveBeenCalled();
  });

  it('refreshes the history when its tab is opened', async () => {
    await renderSignedIn();
    expect(adminApi.getAdminAudit).toHaveBeenCalledTimes(1);
    openTab('History');
    await waitFor(() => expect(adminApi.getAdminAudit).toHaveBeenCalledTimes(2));
    openTab('History');
    expect(adminApi.getAdminAudit).toHaveBeenCalledTimes(2);
  });

  it('moves between tabs with the arrow keys', async () => {
    await renderSignedIn();
    fireEvent.keyDown(tab('Transcription'), { key: 'ArrowRight' });
    expect(tab('Language & retention')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Language & retention')).toHaveFocus();
    fireEvent.keyDown(tab('Language & retention'), { key: 'End' });
    expect(tab('System')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tab('System'), { key: 'ArrowRight' });
    expect(tab('Transcription')).toHaveAttribute('aria-selected', 'true');
  });

  it('reopens on the last tab used', async () => {
    const view = await renderSignedIn();
    openTab('Users');
    view.unmount();

    await renderSignedIn();
    expect(tab('Users')).toHaveAttribute('aria-selected', 'true');
  });
});
