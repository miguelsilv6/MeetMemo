import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AdminUsers from './AdminUsers';
import * as adminApi from '../../services/adminApi';
import type { AdminUser } from '../../types/admin';

vi.mock('../../services/adminApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/adminApi')>();
  return {
    ...actual,
    listUsers: vi.fn(),
    createUser: vi.fn(),
    changeUserTokens: vi.fn(),
    getUserTokens: vi.fn(),
    updateUser: vi.fn(),
    resetUserPassword: vi.fn(),
    deleteUser: vi.fn(),
    getUserContent: vi.fn(),
    setUserDailyQuota: vi.fn(),
    setUserUnlimitedTokens: vi.fn(),
  };
});

const ana: AdminUser = {
  uuid: 'u-ana',
  username: 'ana',
  display_name: 'Ana Silva',
  is_active: true,
  must_change_password: true,
  created_at: '2026-09-28T10:00:00Z',
  last_login_at: null,
  project_count: 2,
  audio_count: 5,
  token_balance: 3,
  unlimited_tokens: false,
  daily_token_quota: null,
  daily_quota: 0,
  daily_used: 0,
};

function renderUsers() {
  const props = { onChanged: vi.fn(), onUnauthorized: vi.fn() };
  render(<AdminUsers {...props} />);
  return props;
}

const row = () => screen.getByText('Ana Silva').closest('tr') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(adminApi.listUsers).mockResolvedValue([ana]);
});

describe('AdminUsers', () => {
  it('lists accounts with their state and what they own', async () => {
    renderUsers();
    expect(await screen.findByText('Ana Silva')).toBeInTheDocument();
    expect(within(row()).getByText('Active')).toBeInTheDocument();
    expect(within(row()).getByText('Temporary password')).toBeInTheDocument();
    expect(row()).toHaveTextContent('2 projects, 5 audios');
  });

  it('creates an account with a temporary password of at least 12 characters', async () => {
    vi.mocked(adminApi.createUser).mockResolvedValue({
      ...ana,
      uuid: 'u-bruno',
      username: 'bruno',
    });
    const props = renderUsers();
    await screen.findByText('Ana Silva');

    const submit = screen.getByRole('button', { name: /create user/i });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'bruno' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bruno Costa' } });
    fireEvent.change(screen.getByLabelText('Temporary password'), { target: { value: 'short' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Temporary password'), {
      target: { value: 'long enough pass' },
    });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(adminApi.createUser).toHaveBeenCalledWith(
        'bruno',
        'Bruno Costa',
        'long enough pass',
        0,
        null
      )
    );
    expect(await screen.findByText('User bruno created.')).toBeInTheDocument();
    expect(props.onChanged).toHaveBeenCalled();
  });

  it('deletes an account only after its username is typed', async () => {
    vi.mocked(adminApi.deleteUser).mockResolvedValue(undefined);
    renderUsers();
    await screen.findByText('Ana Silva');

    fireEvent.click(screen.getByRole('button', { name: 'Delete ana' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Delete' });
    expect(within(dialog).getByText(/2 projects, 5 audios/)).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('To confirm, type ana'), {
      target: { value: 'ana' },
    });
    fireEvent.click(confirm);

    await waitFor(() => expect(adminApi.deleteUser).toHaveBeenCalledWith('u-ana'));
  });

  it('deactivates an account and resets its password', async () => {
    vi.mocked(adminApi.updateUser).mockResolvedValue({ ...ana, is_active: false });
    vi.mocked(adminApi.resetUserPassword).mockResolvedValue(undefined);
    renderUsers();
    await screen.findByText('Ana Silva');

    fireEvent.click(within(row()).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() =>
      expect(adminApi.updateUser).toHaveBeenCalledWith('u-ana', { is_active: false })
    );

    fireEvent.click(screen.getByRole('button', { name: "Reset ana's password" }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Temporary password'), {
      target: { value: 'another temp pass' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset password' }));
    await waitFor(() =>
      expect(adminApi.resetUserPassword).toHaveBeenCalledWith('u-ana', 'another temp pass')
    );
  });

  it("links to the user's projects and audios", async () => {
    vi.mocked(adminApi.getUserContent).mockResolvedValue({
      projects: [
        {
          uuid: 'p1',
          name: 'Caso 12',
          reference: 'NUIPC 1/26',
          created_at: '2026-09-28T10:00:00Z',
          expires_at: '2026-10-05T10:00:00Z',
          audio_count: 3,
        },
      ],
      audios: [
        {
          uuid: 'j1',
          file_name: 'call.wav',
          workflow_state: 'completed',
          created_at: '2026-09-28T10:00:00Z',
        },
      ],
    });
    renderUsers();
    await screen.findByText('Ana Silva');

    fireEvent.click(screen.getByRole('button', { name: /view content/i }));
    expect(await screen.findByRole('link', { name: 'Caso 12' })).toHaveAttribute(
      'href',
      '/#/projects/p1'
    );
    expect(screen.getByRole('link', { name: 'call.wav' })).toHaveAttribute('href', '/#/jobs/j1');
  });

  it('gives and takes tokens and shows their history', async () => {
    vi.mocked(adminApi.getUserTokens).mockResolvedValue({
      token_balance: 3,
      unlimited_tokens: false,
      daily_quota: 0,
      daily_used: 0,
      daily_token_quota: null,
      transactions: [
        {
          id: 2,
          created_at: '2026-09-28T11:00:00Z',
          delta: -1,
          balance_after: 3,
          reason: 'charge',
          job_uuid: 'j1',
          file_name: 'call.wav',
          actor: 'ana',
          note: null,
          pool: 'balance',
          quota_day: null,
        },
        {
          id: 1,
          created_at: '2026-09-28T10:00:00Z',
          delta: 4,
          balance_after: 4,
          reason: 'grant',
          job_uuid: null,
          file_name: null,
          actor: 'admin',
          note: 'Initial tokens',
          pool: 'balance',
          quota_day: null,
        },
      ],
    });
    vi.mocked(adminApi.changeUserTokens).mockResolvedValue({
      token_balance: 8,
      unlimited_tokens: false,
      daily_quota: 0,
      daily_used: 0,
    });
    renderUsers();
    await screen.findByText('Ana Silva');

    fireEvent.click(screen.getByRole('button', { name: "Manage ana's tokens" }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Extra balance: 3 tokens.')).toBeInTheDocument();
    expect(within(dialog).getByText('call.wav · ana')).toBeInTheDocument();
    expect(within(dialog).getByText('+4')).toBeInTheDocument();

    const remove = within(dialog).getByRole('button', { name: 'Remove' });
    fireEvent.change(within(dialog).getByLabelText('Amount'), { target: { value: '5' } });
    expect(remove).toBeDisabled(); // more than the balance
    fireEvent.change(within(dialog).getByLabelText('Reason (optional)'), {
      target: { value: 'Monthly top-up' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(adminApi.changeUserTokens).toHaveBeenCalledWith('u-ana', 5, 'Monthly top-up')
    );
    expect(await screen.findByText('5 tokens added to ana.')).toBeInTheDocument();
  });

  it('creates an account with its own daily quota', async () => {
    vi.mocked(adminApi.createUser).mockResolvedValue({ ...ana, uuid: 'u-rui', username: 'rui' });
    renderUsers();
    await screen.findByText('Ana Silva');

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'rui' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rui' } });
    fireEvent.change(screen.getByLabelText('Temporary password'), {
      target: { value: 'long enough pass' },
    });
    const daily = screen.getByLabelText('Daily quota');
    fireEvent.change(daily, { target: { value: '-1' } });
    expect(screen.getByRole('button', { name: /create user/i })).toBeDisabled();
    fireEvent.change(daily, { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: /create user/i }));

    await waitFor(() =>
      expect(adminApi.createUser).toHaveBeenCalledWith('rui', 'Rui', 'long enough pass', 0, 4)
    );
  });

  it("shows today's quota and sets or clears an account's own quota", async () => {
    const withQuota = { ...ana, daily_token_quota: 5, daily_quota: 5, daily_used: 2 };
    vi.mocked(adminApi.listUsers).mockResolvedValue([withQuota]);
    vi.mocked(adminApi.getUserTokens).mockResolvedValue({
      token_balance: 3,
      unlimited_tokens: false,
      daily_quota: 5,
      daily_used: 2,
      daily_token_quota: 5,
      transactions: [
        {
          id: 1,
          created_at: '2026-09-28T11:00:00Z',
          delta: -1,
          balance_after: 3,
          reason: 'charge',
          job_uuid: 'j1',
          file_name: 'call.wav',
          actor: 'ana',
          note: null,
          pool: 'daily',
          quota_day: '2026-09-28',
        },
      ],
    });
    vi.mocked(adminApi.setUserDailyQuota).mockResolvedValue({
      token_balance: 3,
      unlimited_tokens: false,
      daily_quota: 0,
      daily_used: 2,
      daily_token_quota: null,
    });
    renderUsers();

    const cell = await screen.findByRole('button', { name: "Manage ana's tokens" });
    expect(cell).toHaveTextContent('3/5 today · +3');
    fireEvent.click(cell);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Today: 2 of 5 used.')).toBeInTheDocument();
    expect(within(dialog).getByText('(own value)')).toBeInTheDocument();
    expect(within(dialog).getByText('daily quota')).toBeInTheDocument(); // the charge's pool

    const perDay = within(dialog).getByLabelText('Tokens per day');
    expect(perDay).toHaveValue(5);
    const save = within(dialog).getByRole('button', { name: 'Save quota' });
    expect(save).toBeDisabled(); // unchanged
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use the default' }));
    expect(perDay).toHaveValue(null);
    fireEvent.click(save);

    await waitFor(() => expect(adminApi.setUserDailyQuota).toHaveBeenCalledWith('u-ana', null));
    expect(await screen.findByText('ana now follows the default daily quota.')).toBeInTheDocument();
  });

  it('shows no "+0" in the list when there is no extra balance', async () => {
    vi.mocked(adminApi.listUsers).mockResolvedValue([
      { ...ana, token_balance: 0, daily_token_quota: 5, daily_quota: 5, daily_used: 2 },
    ]);
    renderUsers();
    const cell = await screen.findByRole('button', { name: "Manage ana's tokens" });
    expect(cell).toHaveTextContent('3/5 today');
    expect(cell).not.toHaveTextContent('+');
  });

  it('gives an account unlimited tokens, shown as ∞', async () => {
    const tokens = {
      token_balance: 0,
      daily_quota: 0,
      daily_used: 0,
      daily_token_quota: null,
      transactions: [],
    };
    vi.mocked(adminApi.getUserTokens)
      .mockResolvedValueOnce({ ...tokens, unlimited_tokens: false })
      .mockResolvedValue({ ...tokens, unlimited_tokens: true });
    vi.mocked(adminApi.setUserUnlimitedTokens).mockResolvedValue({
      token_balance: 0,
      unlimited_tokens: true,
      daily_quota: 0,
      daily_used: 0,
    });
    renderUsers();

    const cell = await screen.findByRole('button', { name: "Manage ana's tokens" });
    fireEvent.click(cell);
    const dialog = await screen.findByRole('dialog');
    const toggle = await within(dialog).findByLabelText('Unlimited tokens');
    expect(toggle).not.toBeChecked();
    expect(within(dialog).queryByText(/are not being used/)).toBeNull();

    vi.mocked(adminApi.listUsers).mockResolvedValue([{ ...ana, unlimited_tokens: true }]);
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(adminApi.setUserUnlimitedTokens).toHaveBeenCalledWith('u-ana', true)
    );
    expect(await screen.findByText('ana now has unlimited tokens.')).toBeInTheDocument();
    expect(await within(dialog).findByText(/are not being used/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Unlimited tokens')).toBeChecked();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: "Manage ana's tokens" })).toHaveTextContent('∞')
    );
  });
});
