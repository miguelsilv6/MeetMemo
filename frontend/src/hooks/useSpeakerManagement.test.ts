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

describe('useSpeakerManagement renaming the channels', () => {
  it("names each channel of a per-channel call by its speaker's new name", async () => {
    vi.mocked(api.updateSpeakers).mockResolvedValue({});
    const setTranscriptWithColors = vi.fn();
    const channelCall: Transcript = {
      ...transcript,
      language_detection: {
        language: 'pt',
        probability: 0.9,
        candidates: [],
        flags: [],
        channels: [
          {
            channel: 0,
            speaker: 'SPEAKER_00',
            display_name: 'Ana',
            language: 'pt',
            probability: 0.9,
            flags: [],
            forced: false,
            speech_seconds: 10,
          },
          {
            channel: 1,
            speaker: 'SPEAKER_01',
            language: 'ro',
            probability: 0.8,
            flags: [],
            forced: false,
            speech_seconds: 8,
          },
        ],
      } as Transcript['language_detection'],
    };
    const { result } = renderHook(() =>
      useSpeakerManagement('job1', channelCall, setTranscriptWithColors, vi.fn())
    );

    act(() => {
      result.current.setEditingSpeakers({ Ana: 'Ana Silva', SPEAKER_01: 'Bruno' });
    });
    await act(async () => {
      await result.current.handleSaveSpeakers();
    });

    const updated = setTranscriptWithColors.mock.calls.at(-1)?.[0] as Transcript;
    expect(updated.language_detection?.channels?.map((c) => [c.speaker, c.display_name])).toEqual([
      ['SPEAKER_00', 'Ana Silva'],
      ['SPEAKER_01', 'Bruno'],
    ]);
  });
});

describe('useSpeakerManagement.askSpeakerNamesBefore', () => {
  function renderAsking() {
    const next = vi.fn();
    const hook = renderHook(() => useSpeakerManagement('job1', transcript, vi.fn(), vi.fn()));
    act(() => {
      hook.result.current.askSpeakerNamesBefore(next);
    });
    return { ...hook, next };
  }

  it('opens the editor before the next step and runs it once the names are saved', async () => {
    vi.mocked(api.updateSpeakers).mockResolvedValue({});
    const { result, next } = renderAsking();
    expect(result.current.showEditSpeakersModal).toBe(true);
    expect(result.current.beforeNextStep).toBe(true);
    expect(next).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.handleSaveSpeakers();
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(result.current.showEditSpeakersModal).toBe(false);
    expect(result.current.beforeNextStep).toBe(false);
  });

  it('goes on without renaming when skipped', () => {
    const { result, next } = renderAsking();
    act(() => {
      result.current.handleSkipSpeakers();
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(api.updateSpeakers).not.toHaveBeenCalled();
    expect(result.current.showEditSpeakersModal).toBe(false);
  });

  it('does not go on when cancelled, nor when saving fails', async () => {
    const { result, next } = renderAsking();
    act(() => {
      result.current.handleCancelEditSpeakers();
    });
    expect(next).not.toHaveBeenCalled();
    expect(result.current.showEditSpeakersModal).toBe(false);

    vi.mocked(api.updateSpeakers).mockRejectedValue(new Error('network down'));
    act(() => {
      result.current.askSpeakerNamesBefore(next);
    });
    await act(async () => {
      await result.current.handleSaveSpeakers();
    });
    expect(next).not.toHaveBeenCalled();
    expect(result.current.showEditSpeakersModal).toBe(true);
  });

  it('a plain edit (not before a step) runs nothing after saving', async () => {
    vi.mocked(api.updateSpeakers).mockResolvedValue({});
    const { result, next } = renderAsking();
    act(() => {
      result.current.handleCancelEditSpeakers();
      result.current.handleEditSpeakers();
    });
    expect(result.current.beforeNextStep).toBe(false);
    await act(async () => {
      await result.current.handleSaveSpeakers();
    });
    expect(next).not.toHaveBeenCalled();
  });
});
