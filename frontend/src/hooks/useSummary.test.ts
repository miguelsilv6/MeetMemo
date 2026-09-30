import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import useSummary from './useSummary';
import * as api from '../services/api';
import type { LlmTask } from '../types/api';
import { LLM_POLL_MS } from '../utils/llmTasks';

vi.mock('../services/api');

const task = (overrides: Partial<LlmTask> = {}): LlmTask => ({
  id: 3,
  kind: 'summary',
  status: 'running',
  progress_done: 0,
  progress_total: 1,
  queue_position: null,
  error_code: null,
  error: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getSummary).mockResolvedValue({ status: 'none', task: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSummary', () => {
  it('generates a summary and advances to the summary step', async () => {
    vi.mocked(api.generateSummary).mockResolvedValue({ summary: 'All done' });
    const setCurrentStep = vi.fn();
    const { result } = renderHook(() => useSummary('job1', setCurrentStep, vi.fn()));

    await act(async () => {
      await result.current.handleGenerateSummary();
    });

    expect(api.generateSummary).toHaveBeenCalledWith('job1');
    expect(result.current.summary).toEqual({ summary: 'All done' });
    expect(setCurrentStep).toHaveBeenCalledWith('summary');
  });

  it('generates the summary for an explicit job instead of the hook-bound jobId', async () => {
    vi.mocked(api.generateSummary).mockResolvedValue({ summary: 'Other job summary' });
    const setCurrentStep = vi.fn();
    const { result } = renderHook(() => useSummary('job1', setCurrentStep, vi.fn()));

    await act(async () => {
      await result.current.generateSummaryFor('job2');
    });

    expect(api.generateSummary).toHaveBeenCalledWith('job2');
    expect(result.current.summary).toEqual({ summary: 'Other job summary' });
    expect(setCurrentStep).toHaveBeenCalledWith('summary');
  });

  it('ignores anything passed to handleGenerateSummary, such as a click event', async () => {
    vi.mocked(api.generateSummary).mockResolvedValue({ summary: 'All done' });
    const { result } = renderHook(() => useSummary('job1', vi.fn(), vi.fn()));

    await act(async () => {
      // Simulates onClick={handleGenerateSummary}: React passes the event.
      const handler = result.current.handleGenerateSummary as (...args: unknown[]) => Promise<void>;
      await handler({ type: 'click', target: {} });
    });

    expect(api.generateSummary).toHaveBeenCalledWith('job1');
  });

  it('does nothing without a jobId', async () => {
    const { result } = renderHook(() => useSummary(null, vi.fn(), vi.fn()));
    await act(async () => {
      await result.current.handleGenerateSummary();
    });
    expect(api.generateSummary).not.toHaveBeenCalled();
  });

  it('reports an error when generation fails', async () => {
    vi.mocked(api.generateSummary).mockRejectedValue(new Error('boom'));
    const setError = vi.fn();
    const { result } = renderHook(() => useSummary('job1', vi.fn(), setError));

    await act(async () => {
      await result.current.handleGenerateSummary();
    });

    expect(setError).toHaveBeenCalledWith('boom');
  });

  it('persists an edited summary and updates local state', async () => {
    vi.mocked(api.updateSummary).mockResolvedValue({});
    const { result } = renderHook(() => useSummary('job1', vi.fn(), vi.fn()));

    act(() => {
      result.current.setEditingSummary('edited text');
    });
    await act(async () => {
      await result.current.handleSaveSummary();
    });

    expect(api.updateSummary).toHaveBeenCalledWith('job1', 'edited text');
    expect(result.current.summary).toMatchObject({ summary: 'edited text' });
    expect(result.current.showEditSummaryModal).toBe(false);
  });

  it('follows a summary made in the background until it is ready', async () => {
    vi.useFakeTimers();
    vi.mocked(api.generateSummary).mockResolvedValue({
      status: 'queued',
      task: task({ status: 'queued', queue_position: 2 }),
    });
    vi.mocked(api.getSummary)
      .mockResolvedValueOnce({ status: 'none', task: null }) // on mount
      .mockResolvedValueOnce({ status: 'running', task: task() })
      .mockResolvedValueOnce({ status: 'cached', summary: '# Resumo', task: null });
    const setCurrentStep = vi.fn();
    const { result } = renderHook(() => useSummary('job1', setCurrentStep, vi.fn()));

    let done: Promise<void> = Promise.resolve();
    await act(async () => {
      done = result.current.handleGenerateSummary();
    });
    expect(result.current.generatingSummary).toBe(true);
    expect(result.current.summaryTask).toMatchObject({ status: 'queued', queue_position: 2 });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LLM_POLL_MS);
    });
    expect(result.current.summaryTask?.status).toBe('running');
    expect(setCurrentStep).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LLM_POLL_MS);
      await done;
    });
    expect(result.current.summary?.summary).toBe('# Resumo');
    expect(setCurrentStep).toHaveBeenCalledWith('summary');
    expect(result.current.generatingSummary).toBe(false);
    expect(result.current.summaryTask).toBeNull();
  });

  it('explains why a background summary failed', async () => {
    vi.useFakeTimers();
    const setError = vi.fn();
    const setCurrentStep = vi.fn();
    vi.mocked(api.generateSummary).mockResolvedValue({ status: 'running', task: task() });
    vi.mocked(api.getSummary)
      .mockResolvedValueOnce({ status: 'none', task: null }) // on mount
      .mockResolvedValueOnce({
        status: 'error',
        task: task({ status: 'error', error_code: 'unavailable', error: 'connection refused' }),
      });
    const { result } = renderHook(() => useSummary('job1', setCurrentStep, setError));

    let done: Promise<void> = Promise.resolve();
    await act(async () => {
      done = result.current.handleGenerateSummary();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LLM_POLL_MS);
      await done;
    });

    expect(setError).toHaveBeenLastCalledWith(expect.stringMatching(/not available/));
    expect(setError).toHaveBeenLastCalledWith(expect.stringContaining('connection refused'));
    expect(setCurrentStep).not.toHaveBeenCalled();
    expect(result.current.generatingSummary).toBe(false);
  });

  it('picks up a summary still being made when the transcript is opened', async () => {
    vi.mocked(api.getSummary).mockResolvedValue({ status: 'running', task: task() });
    const { result } = renderHook(() => useSummary('job1', vi.fn(), vi.fn()));

    await waitFor(() => expect(result.current.generatingSummary).toBe(true));
    expect(result.current.summaryTask?.status).toBe('running');
  });
});
