import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useTranscriptSaver, { RETRY_DELAYS_MS, isTransientSaveError } from './useTranscriptSaver';
import * as api from '../services/api';
import type { TranscriptSegment } from '../types/api';

vi.mock('../services/api');

const v = (text: string): TranscriptSegment[] => [{ speaker: 'A', start: 0, end: 1, text }];
const httpError = (status: number, message = `HTTP ${status}`) =>
  Object.assign(new Error(message), { status });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isTransientSaveError', () => {
  it('tries again after network, server, timeout, rate and session errors only', () => {
    expect(isTransientSaveError(new Error('Failed to fetch'))).toBe(true);
    for (const status of [500, 503, 408, 429, 401]) {
      expect(isTransientSaveError(httpError(status))).toBe(true);
    }
    for (const status of [400, 403, 404, 413, 422]) {
      expect(isTransientSaveError(httpError(status))).toBe(false);
    }
  });
});

describe('useTranscriptSaver', () => {
  it('saves at once and says so', async () => {
    vi.mocked(api.updateTranscript).mockResolvedValue({});
    const { result } = renderHook(() => useTranscriptSaver());

    await act(async () => {
      result.current.queueSave('job1', v('one'));
    });
    expect(api.updateTranscript).toHaveBeenCalledWith('job1', v('one'));
    expect(result.current.saveState).toBe('saved');
  });

  it('sends one request at a time, the newest version next', async () => {
    let answer!: () => void;
    vi.mocked(api.updateTranscript)
      .mockImplementationOnce(() => new Promise((resolve) => (answer = () => resolve({}))))
      .mockResolvedValue({});
    const { result } = renderHook(() => useTranscriptSaver());

    await act(async () => {
      result.current.queueSave('job1', v('one'));
      result.current.queueSave('job1', v('two'));
      result.current.queueSave('job1', v('three'));
    });
    expect(api.updateTranscript).toHaveBeenCalledTimes(1);
    expect(result.current.saveState).toBe('saving');

    await act(async () => {
      answer();
    });
    expect(api.updateTranscript).toHaveBeenCalledTimes(2);
    expect(api.updateTranscript).toHaveBeenLastCalledWith('job1', v('three'));
    expect(result.current.saveState).toBe('saved');
  });

  it('keeps each audio its own unsaved version', async () => {
    vi.mocked(api.updateTranscript).mockRejectedValueOnce(new Error('down')).mockResolvedValue({});
    const { result } = renderHook(() => useTranscriptSaver());

    await act(async () => {
      result.current.queueSave('job1', v('one'));
    });
    // Another audio's edit does not replace it: both get saved.
    await act(async () => {
      result.current.queueSave('job2', v('other'));
    });

    expect(vi.mocked(api.updateTranscript).mock.calls.slice(1)).toEqual([
      ['job1', v('one')],
      ['job2', v('other')],
    ]);
    expect(result.current.saveState).toBe('saved');
  });

  it('tries again after a growing wait while the failure may pass', async () => {
    vi.mocked(api.updateTranscript)
      .mockRejectedValueOnce(httpError(503))
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValue({});
    const { result } = renderHook(() => useTranscriptSaver());

    await act(async () => {
      result.current.queueSave('job1', v('one'));
    });
    expect(result.current.saveState).toBe('pending');
    expect(result.current.retryAt).toBe(Date.now() + RETRY_DELAYS_MS[0]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
    });
    expect(api.updateTranscript).toHaveBeenCalledTimes(2);
    expect(result.current.saveError).toBe('Failed to fetch');
    expect(result.current.retryAt).toBe(Date.now() + RETRY_DELAYS_MS[1]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[1] - 1);
    });
    expect(api.updateTranscript).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.saveState).toBe('saved');
    expect(result.current.retryAt).toBeNull();
  });

  it('waits for retryNow after a failure that will not pass by itself', async () => {
    vi.mocked(api.updateTranscript)
      .mockRejectedValueOnce(httpError(404, 'Job not found'))
      .mockResolvedValue({});
    const { result } = renderHook(() => useTranscriptSaver());

    await act(async () => {
      result.current.queueSave('job1', v('one'));
    });
    expect(result.current.saveState).toBe('failed');
    expect(result.current.saveError).toBe('Job not found');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(api.updateTranscript).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.retryNow();
    });
    expect(api.updateTranscript).toHaveBeenCalledTimes(2);
    expect(result.current.saveState).toBe('saved');
  });

  it('tries at once when the network is back', async () => {
    vi.mocked(api.updateTranscript).mockRejectedValueOnce(new Error('down')).mockResolvedValue({});
    const { result } = renderHook(() => useTranscriptSaver());
    await act(async () => {
      result.current.queueSave('job1', v('one'));
    });

    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(api.updateTranscript).toHaveBeenCalledTimes(2);
    expect(result.current.saveState).toBe('saved');
  });

  it('flush says whether everything got saved', async () => {
    vi.mocked(api.updateTranscript).mockRejectedValueOnce(new Error('down')).mockResolvedValue({});
    const { result } = renderHook(() => useTranscriptSaver());
    await expect(result.current.flush()).resolves.toBe(true);

    let first!: Promise<boolean>;
    await act(async () => {
      result.current.queueSave('job1', v('one'));
      first = result.current.flush();
    });
    await expect(first).resolves.toBe(false);

    let second!: Promise<boolean>;
    await act(async () => {
      second = result.current.flush();
    });
    await expect(second).resolves.toBe(true);
    expect(result.current.saveState).toBe('saved');
  });

  it('asks before leaving the page only while something is unsaved', async () => {
    vi.mocked(api.updateTranscript).mockRejectedValueOnce(new Error('down')).mockResolvedValue({});
    const { result } = renderHook(() => useTranscriptSaver());
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);

    await act(async () => {
      result.current.queueSave('job1', v('one'));
    });
    expect(leave()).toBe(true);

    await act(async () => {
      result.current.retryNow();
    });
    expect(leave()).toBe(false);
  });

  it('changes what is still to be saved, so a late save does not undo a rename', async () => {
    let answer!: () => void;
    vi.mocked(api.updateTranscript)
      .mockImplementationOnce(() => new Promise((resolve) => (answer = () => resolve({}))))
      .mockResolvedValue({});
    const { result } = renderHook(() => useTranscriptSaver());
    const rename = (segments: TranscriptSegment[]) =>
      segments.map((s) => ({ ...s, speaker: 'Ana' }));

    // Being sent: a renamed copy is saved after it.
    await act(async () => {
      result.current.queueSave('job1', v('one'));
    });
    act(() => {
      result.current.updatePending('job1', rename);
    });
    await act(async () => {
      answer();
    });
    expect(api.updateTranscript).toHaveBeenLastCalledWith('job1', [
      { speaker: 'Ana', start: 0, end: 1, text: 'one' },
    ]);

    // Nothing to save for another audio: nothing is sent.
    act(() => {
      result.current.updatePending('job2', rename);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(api.updateTranscript).toHaveBeenCalledTimes(2);
    expect(result.current.saveState).toBe('saved');
  });
});
