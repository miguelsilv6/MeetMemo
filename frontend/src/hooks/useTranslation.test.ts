import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useTranslation, { TRANSLATION_BLOCK_SIZE } from './useTranslation';
import * as api from '../services/api';
import type { TranscriptSegment } from '../types/api';

vi.mock('../services/api');

const segments: TranscriptSegment[] = [
  { speaker: 'SPEAKER_00', start: 0, end: 2, text: 'Hello' },
  { speaker: 'SPEAKER_01', start: 2, end: 4, text: 'Hi there' },
];

const translated: TranscriptSegment[] = [
  { speaker: 'SPEAKER_00', start: 0, end: 2, text: 'Ola' },
  { speaker: 'SPEAKER_01', start: 2, end: 4, text: 'Ola tambem' },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useTranslation', () => {
  it('fetches and shows the translation on first toggle', async () => {
    vi.mocked(api.translateTranscript).mockResolvedValue({
      status: 'generated',
      target_language: 'pt',
      segments: translated,
    });
    const { result } = renderHook(() => useTranslation('job1', vi.fn()));

    await act(async () => {
      await result.current.handleToggleTranslation(segments);
    });

    expect(api.translateTranscript).toHaveBeenCalledWith('job1', 0, TRANSLATION_BLOCK_SIZE);
    expect(result.current.showTranslation).toBe(true);
    expect(result.current.translatedSegments).toEqual(translated);
  });

  it('hides the translation on the next toggle without refetching', async () => {
    vi.mocked(api.translateTranscript).mockResolvedValue({
      status: 'generated',
      target_language: 'pt',
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
      status: 'generated',
      target_language: 'pt',
      segments: translated,
    });
    const { result } = renderHook(() => useTranslation('job1', vi.fn()));

    await act(async () => {
      await result.current.handleToggleTranslation(segments);
    });
    await act(async () => {
      await result.current.handleToggleTranslation(segments);
    });

    const editedSegments = [...segments];
    await act(async () => {
      await result.current.handleToggleTranslation(editedSegments);
    });

    expect(api.translateTranscript).toHaveBeenCalledTimes(2);
  });

  it('surfaces an error and does not show a translation on failure', async () => {
    const setError = vi.fn();
    vi.mocked(api.translateTranscript).mockRejectedValue(new Error('LLM unavailable'));
    const { result } = renderHook(() => useTranslation('job1', setError));

    await act(async () => {
      await result.current.handleToggleTranslation(segments);
    });

    expect(result.current.showTranslation).toBe(false);
    expect(setError).toHaveBeenCalledWith('LLM unavailable');
  });

  it('translates a long transcript block by block, reporting progress', async () => {
    const many: TranscriptSegment[] = Array.from({ length: 20 }, (_, i) => ({
      speaker: 'SPEAKER_00',
      start: i,
      end: i + 1,
      text: `line ${i}`,
    }));
    const blockFor = (start: number, limit: number) => ({
      status: 'generated',
      start,
      total: many.length,
      segments: many.slice(start, start + limit).map((s) => ({ ...s, text: `PT ${s.text}` })),
    });
    // Each block resolves only when the test says so, to observe progress in between.
    const pending: Array<() => void> = [];
    vi.mocked(api.translateTranscript).mockImplementation(
      (_uuid, start = 0, limit = 0) =>
        new Promise((resolve) => pending.push(() => resolve(blockFor(start, limit))))
    );
    const { result } = renderHook(() => useTranslation('job1', vi.fn()));

    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = result.current.handleToggleTranslation(many);
    });
    expect(result.current.translating).toBe(true);
    expect(result.current.translationProgress).toEqual({ done: 0, total: 20 });

    await act(async () => pending.shift()?.());
    expect(result.current.translationProgress).toEqual({ done: 15, total: 20 });

    await act(async () => {
      pending.shift()?.();
      await done;
    });

    expect(vi.mocked(api.translateTranscript).mock.calls).toEqual([
      ['job1', 0, TRANSLATION_BLOCK_SIZE],
      ['job1', TRANSLATION_BLOCK_SIZE, TRANSLATION_BLOCK_SIZE],
    ]);
    expect(result.current.translatedSegments?.map((s) => s.text)).toEqual(
      many.map((s) => `PT ${s.text}`)
    );
    expect(result.current.translationProgress).toBeNull();
    expect(result.current.translating).toBe(false);
  });

  it('keeps nothing and reports the error when a later block fails', async () => {
    const setError = vi.fn();
    const many: TranscriptSegment[] = Array.from({ length: 20 }, (_, i) => ({
      speaker: 'SPEAKER_00',
      start: i,
      end: i + 1,
      text: `line ${i}`,
    }));
    vi.mocked(api.translateTranscript)
      .mockResolvedValueOnce({ total: 20, segments: many.slice(0, 15) })
      .mockRejectedValueOnce(new Error('Translation service unavailable: timeout'));
    const { result } = renderHook(() => useTranslation('job1', setError));

    await act(async () => {
      await result.current.handleToggleTranslation(many);
    });

    expect(setError).toHaveBeenCalledWith('Translation service unavailable: timeout');
    expect(result.current.showTranslation).toBe(false);
    expect(result.current.translationProgress).toBeNull();
  });
});
