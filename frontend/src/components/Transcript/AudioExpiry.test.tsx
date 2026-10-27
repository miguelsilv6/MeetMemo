import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AudioExpiry from './AudioExpiry';
import * as api from '../../services/api';
import * as adminApi from '../../services/adminApi';
import { formatDateTime } from '../../utils/projectDates';

vi.mock('../../services/api', () => ({ getJobStatus: vi.fn() }));
vi.mock('../../services/adminApi', () => ({ extendJobExpiry: vi.fn() }));

const HOUR = 3600 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AudioExpiry', () => {
  it('shows when an audio outside a project is deleted, without a way to extend it', async () => {
    const expires = new Date(Date.now() + 10 * HOUR).toISOString();
    vi.mocked(api.getJobStatus).mockResolvedValue({ expires_at: expires });
    render(<AudioExpiry jobId="j1" fileName="call.wav" />);

    expect(await screen.findByText(formatDateTime(expires, 'en'))).not.toHaveClass('text-danger');
    expect(screen.getByText('Deleted automatically on')).toBeInTheDocument();
    expect(screen.queryByText('Extend')).not.toBeInTheDocument();
  });

  it('is red with less than an hour left', async () => {
    const expires = new Date(Date.now() + 0.5 * HOUR).toISOString();
    vi.mocked(api.getJobStatus).mockResolvedValue({ expires_at: expires });
    render(<AudioExpiry jobId="j1" fileName="call.wav" />);
    expect(await screen.findByText(formatDateTime(expires, 'en'))).toHaveClass('text-danger');
  });

  it('shows nothing for an audio in a project', async () => {
    vi.mocked(api.getJobStatus).mockResolvedValue({ expires_at: null });
    const { container } = render(<AudioExpiry jobId="j1" fileName="call.wav" isAdmin />);
    await waitFor(() => expect(api.getJobStatus).toHaveBeenCalledWith('j1'));
    expect(container).toBeEmptyDOMElement();
  });

  it('lets the administrator keep it until a later date', async () => {
    const expires = new Date(Date.now() + 10 * HOUR).toISOString();
    const later = new Date(Date.now() + 7 * 24 * HOUR).toISOString();
    vi.mocked(api.getJobStatus).mockResolvedValue({ expires_at: expires });
    vi.mocked(adminApi.extendJobExpiry).mockResolvedValue({ expires_at: later });
    render(<AudioExpiry jobId="j1" fileName="call.wav" isAdmin />);

    fireEvent.click(await screen.findByText('Extend'));
    expect(screen.getByText('Extend expiry — call.wav')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Save new date'));

    await waitFor(() => expect(adminApi.extendJobExpiry).toHaveBeenCalled());
    expect(vi.mocked(adminApi.extendJobExpiry).mock.calls[0][0]).toBe('j1');
    expect(await screen.findByText(formatDateTime(later, 'en'))).toBeInTheDocument();
  });
});
