import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useSpeakerManagement from './useSpeakerManagement';
import * as api from '../services/api';
import type { Transcript } from '../types/api';

vi.mock('../services/api');

const transcript: Transcript = {
  segments: [
    { speaker: 'SPEAKER_00', start: 0, end: 1, text: 'a' },
    { speaker: 'SPEAKER_01', start: 1, end: 2, text: 'b' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useSpeakerManagement.handleEditSpeakers', () => {
  it('opens the editor with every speaker keeping its current label', () => {
    const { result } = renderHook(() => useSpeakerManagement('job1', transcript, vi.fn(), vi.fn()));

    act(() => {
      result.current.handleEditSpeakers();
    });

    expect(result.current.showEditSpeakersModal).toBe(true);
    expect(result.current.editingSpeakers).toEqual({
      SPEAKER_00: 'SPEAKER_00',
      SPEAKER_01: 'SPEAKER_01',
    });
    // Names are only ever set by the user: nothing is fetched or saved here.
    expect(api.updateSpeakers).not.toHaveBeenCalled();
    expect(api.getTranscript).not.toHaveBeenCalled();
  });
});

describe('useSpeakerManagement.handleSaveSpeakers', () => {
  it('persists renamed speakers and rewrites the local transcript', async () => {
    vi.mocked(api.updateSpeakers).mockResolvedValue({});
    const setTranscriptWithColors = vi.fn();
    const { result } = renderHook(() =>
      useSpeakerManagement('job1', transcript, setTranscriptWithColors, vi.fn())
    );

    act(() => {
      result.current.setEditingSpeakers({ SPEAKER_00: 'Alice', SPEAKER_01: 'SPEAKER_01' });
    });
    await act(async () => {
      await result.current.handleSaveSpeakers();
    });

    expect(api.updateSpeakers).toHaveBeenCalledWith('job1', {
      SPEAKER_00: 'Alice',
      SPEAKER_01: 'SPEAKER_01',
    });
    const updated = setTranscriptWithColors.mock.calls.at(-1)?.[0] as Transcript;
    expect(updated.segments?.[0].speaker).toBe('Alice');
    expect(updated.segments?.[1].speaker).toBe('SPEAKER_01');
  });
});
