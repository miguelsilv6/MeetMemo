import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoadingView from './LoadingView';

describe('LoadingView', () => {
  it('announces what is loading', () => {
    render(<LoadingView message="Opening the transcript…" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Opening the transcript…');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });
});
