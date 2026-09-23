import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import useWaveformPeaks from './useWaveformPeaks';
import * as api from '../services/api';

vi.mock('../services/api');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useWaveformPeaks', () => {
  it('fetches peaks for the given range and buckets', async () => {
    vi.mocked(api.getWaveformPeaks).mockResolvedValue({
      peaks: [
        { min: -0.5, max: 0.5 },
        { min: -0.2, max: 0.3 },
      ],
    });

    const { result } = renderHook(() => useWaveformPeaks('job1', 10, 12, 50));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(api.getWaveformPeaks).toHaveBeenCalledWith('job1', 10, 12, 50);
    expect(result.current.peaks).toEqual([
      { min: -0.5, max: 0.5 },
      { min: -0.2, max: 0.3 },
    ]);
    expect(result.current.error).toBeNull();
  });

  it('does not fetch when there is no jobId', () => {
    const { result } = renderHook(() => useWaveformPeaks(null, 0, 2));

    expect(api.getWaveformPeaks).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.peaks).toBeNull();
  });

  it('does not fetch for an empty or invalid range', () => {
    const { result } = renderHook(() => useWaveformPeaks('job1', 5, 5));

    expect(api.getWaveformPeaks).not.toHaveBeenCalled();
    expect(result.current.peaks).toBeNull();
  });

  it('surfaces an error and clears peaks on failure', async () => {
    vi.mocked(api.getWaveformPeaks).mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useWaveformPeaks('job1', 0, 2));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('network down');
    expect(result.current.peaks).toBeNull();
  });

  it('refetches when the range changes', async () => {
    vi.mocked(api.getWaveformPeaks).mockResolvedValue({ peaks: [] });

    const { rerender } = renderHook(({ start, end }) => useWaveformPeaks('job1', start, end), {
      initialProps: { start: 0, end: 2 },
    });

    await waitFor(() => expect(api.getWaveformPeaks).toHaveBeenCalledTimes(1));

    rerender({ start: 2, end: 4 });

    await waitFor(() => expect(api.getWaveformPeaks).toHaveBeenCalledTimes(2));
    expect(api.getWaveformPeaks).toHaveBeenLastCalledWith('job1', 2, 4, 100);
  });
});
