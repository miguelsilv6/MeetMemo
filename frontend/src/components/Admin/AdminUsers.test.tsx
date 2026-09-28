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
    updateUser: vi.fn(),
    resetUserPassword: vi.fn(),
    deleteUser: vi.fn(),
    getUserContent: vi.fn(),
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
      expect(adminApi.createUser).toHaveBeenCalledWith('bruno', 'Bruno Costa', 'long enough pass')
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
});
