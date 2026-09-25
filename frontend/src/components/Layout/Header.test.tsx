import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Header from './Header';

describe('Header', () => {
  beforeEach(() => {
    // jsdom has no matchMedia; the theme switcher reads the system preference.
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not link to the admin panel, whose address only the administrator knows', () => {
    const { container } = render(<Header onStartNewMeeting={vi.fn()} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(container.querySelector('a[href*="admin"]')).not.toBeInTheDocument();
  });
});
