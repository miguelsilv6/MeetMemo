import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import SaveStatus, { SaveStatusBadge } from './SaveStatus';

afterEach(() => {
  vi.useRealTimers();
});

describe('SaveStatusBadge', () => {
  it.each([
    ['saved', 'Saved'],
    ['saving', 'Saving…'],
    ['pending', 'Not saved yet'],
    ['failed', 'Not saved'],
  ] as const)('says %s', (state, text) => {
    render(<SaveStatusBadge saveState={state} />);
    expect(screen.getByTestId('save-status')).toHaveTextContent(text);
  });
});

describe('SaveStatus', () => {
  it('shows nothing while the edits are saved or being saved', () => {
    const { container, rerender } = render(
      <SaveStatus saveState="saved" saveError={null} retryAt={null} onRetry={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<SaveStatus saveState="saving" saveError={null} retryAt={null} onRetry={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('counts down to the next attempt, and can try now', () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    const { rerender } = render(
      <SaveStatus saveState="saved" saveError={null} retryAt={null} onRetry={onRetry} />
    );
    // Long after it was first shown, the countdown still starts from now.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    rerender(
      <SaveStatus
        saveState="pending"
        saveError="Failed to fetch"
        retryAt={Date.now() + 4000}
        onRetry={onRetry}
      />
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    const alert = screen.getByTestId('save-status-alert');
    expect(alert).toHaveTextContent('(Failed to fetch)');
    expect(alert).toHaveTextContent('next attempt in 4 s');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(alert).toHaveTextContent('next attempt in 3 s');

    fireEvent.click(screen.getByText('Try now'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('says why it could not be saved, and can try again', () => {
    const onRetry = vi.fn();
    render(
      <SaveStatus saveState="failed" saveError="Job not found" retryAt={null} onRetry={onRetry} />
    );
    expect(screen.getByTestId('save-status-alert')).toHaveTextContent('Job not found');
    fireEvent.click(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalled();
  });
});
