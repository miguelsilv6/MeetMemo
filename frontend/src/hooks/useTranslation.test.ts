import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useTranslation from './useTranslation';
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

    expect(api.translateTranscript).toHaveBeenCalledWith('job1', 'pt');
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
});
