import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import useTranslation from './useTranslation';
import * as api from '../services/api';
import type { LlmTask, TranscriptSegment } from '../types/api';
import { LLM_POLL_MS } from '../utils/llmTasks';

vi.mock('../services/api');

const segments: TranscriptSegment[] = [
  { speaker: 'SPEAKER_00', start: 0, end: 2, text: 'Hello' },
  { speaker: 'SPEAKER_01', start: 2, end: 4, text: 'Hi there' },
];

const translated: TranscriptSegment[] = [
  { speaker: 'SPEAKER_00', start: 0, end: 2, text: 'Ola' },
  { speaker: 'SPEAKER_01', start: 2, end: 4, text: 'Ola tambem' },
];

const task = (overrides: Partial<LlmTask> = {}): LlmTask => ({
  id: 7,
  kind: 'translation',
  status: 'running',
  progress_done: 0,
  progress_total: 20,
  queue_position: null,
  error_code: null,
  error: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getTranslation).mockResolvedValue({ status: 'none', segments: [], task: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useTranslation', () => {
  it('shows a translation that already exists at once', async () => {
    vi.mocked(api.translateTranscript).mockResolvedValue({
      status: 'cached',
      target_language: 'pt-PT',
      segments: translated,
    });
    const { result } = renderHook(() => useTranslation('job1', vi.fn()));

    await act(async () => {
      await result.current.handleToggleTranslation(segments);
    });

    expect(api.translateTranscript).toHaveBeenCalledWith('job1');
    expect(result.current.showTranslation).toBe(true);
    expect(result.current.translatedSegments).toEqual(translated);
  });

  it('hides the translation on the next toggle without refetching', async () => {
    vi.mocked(api.translateTranscript).mockResolvedValue({
      status: 'cached',
      segments: translated,
    });
    const { result } = renderHook(() => useTranslation('job1', vi.fn()));

    await act(async () => {
      await result.current.handleToggleTranslation(segments);
    });
    await act(async () => {
      await result.current.handleToggleTranslation(segments);
    });

    expect(result.current.showTranslation).toBe(false);
    expect(result.current.translatedSegments).toBeNull();

    await act(async () => {
      await result.current.handleToggleTranslation(segments);
    });
    expect(api.translateTranscript).toHaveBeenCalledTimes(1);
    expect(result.current.showTranslation).toBe(true);
  });

  it('refetches when the underlying segments array changed since the last translation', async () => {
    vi.mocked(api.translateTranscript).mockResolvedValue({
      status: 'cached',
      segments: translated,
    });
    const { result } = renderHook(() => useTranslation('job1', vi.fn()));

    await act(async () => {
      await result.current.handleToggleTranslation(segments);
    });
    await act(async () => {
      await result.current.handleToggleTranslation(segments);
    });
    await act(async () => {
      await result.current.handleToggleTranslation([...segments]);
    });

    expect(api.translateTranscript).toHaveBeenCalledTimes(2);
  });

  it('surfaces an error and does not show a translation when the request fails', async () => {
    const setError = vi.fn();
    vi.mocked(api.translateTranscript).mockRejectedValue(new Error('Server error'));
    const { result } = renderHook(() => useTranslation('job1', setError));

    await act(async () => {
      await result.current.handleToggleTranslation(segments);
    });

    expect(result.current.showTranslation).toBe(false);
    expect(result.current.translating).toBe(false);
    expect(setError).toHaveBeenCalledWith('Server error');
  });

  it('follows a background translation, showing its progress, until it is ready', async () => {
    vi.useFakeTimers();
    vi.mocked(api.translateTranscript).mockResolvedValue({
      status: 'queued',
      segments: [],
      total: 20,
      task: task({ status: 'queued', progress_total: 0, queue_position: 1 }),
    });
    vi.mocked(api.getTranslation)
      .mockResolvedValueOnce({ status: 'none', segments: [], task: null }) // on mount
      .mockResolvedValueOnce({
        status: 'running',
        segments: [],
        total: 20,
        task: task({ progress_done: 15 }),
      })
      .mockResolvedValueOnce({ status: 'cached', segments: translated, total: 2, task: null });
    const { result } = renderHook(() => useTranslation('job1', vi.fn()));

    let done: Promise<void> = Promise.resolve();
    await act(async () => {
      done = result.current.handleToggleTranslation(segments);
    });
    expect(result.current.translating).toBe(true);
    expect(result.current.translationProgress).toEqual({
      done: 0,
      total: 20,
      queued: true,
      position: 1,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LLM_POLL_MS);
    });
    expect(result.current.translationProgress).toEqual({
      done: 15,
      total: 20,
      queued: false,
      position: null,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LLM_POLL_MS);
      await done;
    });
    expect(result.current.translatedSegments).toEqual(translated);
    expect(result.current.showTranslation).toBe(true);
    expect(result.current.translating).toBe(false);
    expect(result.current.translationProgress).toBeNull();
  });

  it('explains why a background translation failed', async () => {
    vi.useFakeTimers();
    const setError = vi.fn();
    vi.mocked(api.translateTranscript).mockResolvedValue({
      status: 'running',
      segments: [],
      task: task(),
    });
    vi.mocked(api.getTranslation)
      .mockResolvedValueOnce({ status: 'none', segments: [], task: null }) // on mount
      .mockResolvedValueOnce({
        status: 'error',
        segments: [],
        task: task({ status: 'error', error_code: 'timeout', error: 'no answer in 60 s' }),
      });
    const { result } = renderHook(() => useTranslation('job1', setError));

    let done: Promise<void> = Promise.resolve();
    await act(async () => {
      done = result.current.handleToggleTranslation(segments);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LLM_POLL_MS);
      await done;
    });

    expect(setError).toHaveBeenLastCalledWith(expect.stringMatching(/did not answer in time/i));
    expect(setError).toHaveBeenLastCalledWith(expect.stringContaining('no answer in 60 s'));
    expect(result.current.showTranslation).toBe(false);
    expect(result.current.translating).toBe(false);
  });

  it('picks up a translation still being made when the transcript is opened', async () => {
    vi.mocked(api.getTranslation).mockResolvedValue({
      status: 'running',
      segments: [],
      total: 20,
      task: task({ progress_done: 5 }),
    });
    const { result } = renderHook(() => useTranslation('job1', vi.fn()));

    await waitFor(() => expect(result.current.translating).toBe(true));
    expect(result.current.translationProgress).toMatchObject({ done: 5, total: 20 });
  });
});
