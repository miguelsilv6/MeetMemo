import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, renderHook, act } from '@testing-library/react';
import LoginView from './LoginView';
import ChangePasswordForm from './ChangePasswordForm';
import useSession from '../../hooks/useSession';
import * as authApi from '../../services/authApi';
import { UNAUTHORIZED_EVENT } from '../../services/api';
import type { Me } from '../../types/auth';

vi.mock('../../services/authApi', () => ({
  getMe: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
}));

const ana: Me = {
  username: 'ana',
  display_name: 'Ana Silva',
  is_admin: false,
  must_change_password: false,
  token_balance: 3,
};

const apiError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LoginView', () => {
  const signIn = (username: string, password: string) => {
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
  };

  it('signs in with a trimmed username', async () => {
    vi.mocked(authApi.login).mockResolvedValue(ana);
    const onSignedIn = vi.fn();
    render(<LoginView onSignedIn={onSignedIn} />);

    signIn('  ana ', 'secret');

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(ana));
    expect(authApi.login).toHaveBeenCalledWith('ana', 'secret');
  });

  it('shows one generic message for wrong credentials and another when blocked', async () => {
    vi.mocked(authApi.login).mockRejectedValueOnce(apiError(401));
    render(<LoginView onSignedIn={vi.fn()} />);
    signIn('ana', 'wrong');
    expect(await screen.findByText('Invalid username or password.')).toBeInTheDocument();

    vi.mocked(authApi.login).mockRejectedValueOnce(apiError(429));
    signIn('ana', 'wrong');
    expect(
      await screen.findByText('Too many failed attempts. Try again in a few minutes.')
    ).toBeInTheDocument();
  });
});

describe('useSession', () => {
  it('is signed in when the session is valid', async () => {
    vi.mocked(authApi.getMe).mockResolvedValue(ana);
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.state).toEqual({ status: 'signedIn', me: ana }));
  });

  it('is signed out without a session, and after any 401 from the API', async () => {
    vi.mocked(authApi.getMe).mockRejectedValueOnce(apiError(401));
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.state.status).toBe('signedOut'));

    act(() => result.current.signedIn(ana));
    expect(result.current.state.status).toBe('signedIn');

    act(() => {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    });
    expect(result.current.state.status).toBe('signedOut');
  });

  it('signs out even if the server call fails', async () => {
    vi.mocked(authApi.getMe).mockResolvedValue(ana);
    vi.mocked(authApi.logout).mockRejectedValue(apiError(500));
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.state.status).toBe('signedIn'));

    await act(async () => {
      await result.current.signOut().catch(() => {});
    });
    expect(result.current.state.status).toBe('signedOut');
  });
});

describe('ChangePasswordForm', () => {
  it('needs a long enough, confirmed new password', async () => {
    vi.mocked(authApi.changePassword).mockResolvedValue(undefined);
    const onChanged = vi.fn();
    render(<ChangePasswordForm onChanged={onChanged} />);
    const submit = screen.getByRole('button', { name: /change password/i });

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'temporary' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'my own password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'my own password' },
    });
    fireEvent.click(submit);

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(authApi.changePassword).toHaveBeenCalledWith('temporary', 'my own password');
  });

  it('says when the current password is wrong', async () => {
    vi.mocked(authApi.changePassword).mockRejectedValue(apiError(403));
    render(<ChangePasswordForm onChanged={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'nope' } });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'my own password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'my own password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
