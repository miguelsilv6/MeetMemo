import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoadingScreen from './LoadingScreen';

describe('LoadingScreen', () => {
  it('shows the backend error message when the backend is unreachable', () => {
    render(<LoadingScreen backendError="Backend unavailable: connection refused" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Backend unavailable: connection refused');
  });
});
