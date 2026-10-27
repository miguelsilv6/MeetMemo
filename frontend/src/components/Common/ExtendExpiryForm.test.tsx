import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ExtendExpiryForm from './ExtendExpiryForm';
import { toLocalInput } from '../../utils/expiryDates';

const DAY = 24 * 3600 * 1000;

afterEach(() => {
  vi.useRealTimers();
});

function renderForm(currentMs: number, onSave = vi.fn().mockResolvedValue(undefined)) {
  const onCancel = vi.fn();
  render(
    <ExtendExpiryForm
      currentExpiry={new Date(currentMs).toISOString()}
      onSave={onSave}
      onCancel={onCancel}
    />
  );
  return { field: screen.getByLabelText('New expiry date'), onSave, onCancel };
}

describe('ExtendExpiryForm', () => {
  it('suggests 7 days after the current expiry, and +30 days moves it', () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 27, 12, 0) });
    const current = new Date(2026, 9, 28, 9, 30).getTime();
    const { field } = renderForm(current);
    expect(field).toHaveValue(toLocalInput(current + 7 * DAY));
    fireEvent.click(screen.getByText('+30 days'));
    expect(field).toHaveValue(toLocalInput(current + 30 * DAY));
  });

  it('extends an expired, not yet deleted, item from now', () => {
    const now = new Date(2026, 9, 27, 12, 0).getTime();
    vi.useFakeTimers({ now });
    const { field } = renderForm(now - DAY);
    expect(field).toHaveValue(toLocalInput(now + 7 * DAY));
  });

  it('refuses a date not later than the current one, or more than a year away', () => {
    const now = Date.now();
    const { field, onSave } = renderForm(now + 2 * DAY);
    fireEvent.change(field, { target: { value: toLocalInput(now + DAY) } });
    fireEvent.click(screen.getByText('Save new date'));
    expect(screen.getByRole('alert')).toHaveTextContent('must be later');

    fireEvent.change(field, { target: { value: toLocalInput(now + 400 * DAY) } });
    fireEvent.click(screen.getByText('Save new date'));
    expect(screen.getByRole('alert')).toHaveTextContent('at most 365 days');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves the chosen date, and shows why the server refused it', async () => {
    const now = Date.now();
    const onSave = vi.fn().mockRejectedValueOnce(new Error('Project not found'));
    const { field } = renderForm(now + DAY, onSave);
    const chosen = new Date(now + 10 * DAY);
    chosen.setSeconds(0, 0);
    fireEvent.change(field, { target: { value: toLocalInput(chosen.getTime()) } });
    fireEvent.click(screen.getByText('Save new date'));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(chosen.toISOString()));
    expect(await screen.findByRole('alert')).toHaveTextContent('Project not found');
  });

  it('cancels', () => {
    const { onCancel } = renderForm(Date.now() + DAY);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });
});
