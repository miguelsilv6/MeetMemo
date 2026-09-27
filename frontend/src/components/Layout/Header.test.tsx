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
});
