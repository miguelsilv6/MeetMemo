import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Header from './Header';

describe('Header', () => {
  it('does not link to the admin panel, whose address only the administrator knows', () => {
    const { container } = render(<Header onStartNewMeeting={vi.fn()} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(container.querySelector('a[href*="admin"]')).not.toBeInTheDocument();
  });

  it('has no theme switch: the app only has a light theme', () => {
    render(<Header onStartNewMeeting={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /mode/i })).not.toBeInTheDocument();
    expect(document.documentElement).not.toHaveAttribute('data-theme', 'dark');
  });

  it('opens the projects page and marks it as current there', () => {
    const onOpenProjects = vi.fn();
    const { rerender } = render(
      <Header onStartNewMeeting={vi.fn()} onOpenProjects={onOpenProjects} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    expect(onOpenProjects).toHaveBeenCalled();

    rerender(<Header onStartNewMeeting={vi.fn()} onOpenProjects={onOpenProjects} projectsActive />);
    expect(screen.getByRole('button', { name: 'Projects' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('shows the signed-in user with password change and sign-out', () => {
    const onChangePassword = vi.fn();
    const onLogout = vi.fn();
    render(
      <Header
        onStartNewMeeting={vi.fn()}
        me={{
          username: 'ana',
          display_name: 'Ana Silva',
          is_admin: false,
          must_change_password: false,
          token_balance: 3,
        }}
        onChangePassword={onChangePassword}
        onLogout={onLogout}
      />
    );

    expect(screen.getByText('Ana Silva')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onChangePassword).toHaveBeenCalled();
    expect(onLogout).toHaveBeenCalled();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('links the signed-in administrator back to the admin panel', () => {
    render(
      <Header
        onStartNewMeeting={vi.fn()}
        me={{
          username: 'admin',
          display_name: null,
          is_admin: true,
          must_change_password: false,
          token_balance: 3,
        }}
      />
    );
    expect(screen.getByRole('link', { name: /admin panel/i })).toHaveAttribute('href', '#/admin');
  });

  it("shows the user's token balance, in red when it runs out", () => {
    const user = {
      username: 'ana',
      display_name: 'Ana',
      is_admin: false,
      must_change_password: false,
    };
    const { rerender } = render(
      <Header onStartNewMeeting={vi.fn()} me={{ ...user, token_balance: 3 }} />
    );
    expect(screen.getByText('3 tokens')).toHaveClass('bg-secondary');

    rerender(<Header onStartNewMeeting={vi.fn()} me={{ ...user, token_balance: 0 }} />);
    expect(screen.getByText('0 tokens')).toHaveClass('bg-danger');
  });
});
