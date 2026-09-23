import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useTranscript from './useTranscript';
import * as api from '../services/api';
import type { TranscriptSegment } from '../types/api';

vi.mock('../services/api');

const segments: TranscriptSegment[] = [
  { speaker: 'SPEAKER_00', start: 0, end: 2, text: 'Hello' },
  { speaker: 'SPEAKER_01', start: 2, end: 4, text: 'Hi there' },
];

const threeSpeakerSegments: TranscriptSegment[] = [
  { speaker: 'SPEAKER_00', start: 0, end: 2, text: 'Hello' },
  { speaker: 'SPEAKER_01', start: 2, end: 4, text: 'Hi there' },
  { speaker: 'SPEAKER_00', start: 4, end: 6, text: 'How are you' },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useTranscript', () => {
  it('stores the transcript via setTranscriptWithColors', () => {
    const { result } = renderHook(() => useTranscript('job1', vi.fn()));
    act(() => {
      result.current.setTranscriptWithColors({ segments });
    });
    expect(result.current.transcript).toEqual({ segments });
  });

  it('opens the edit modal with the selected segment and its index', () => {
    const { result } = renderHook(() => useTranscript('job1', vi.fn()));
    act(() => {
      result.current.handleEditText(segments[1], 1);
    });
    expect(result.current.showEditTextModal).toBe(true);
    expect(result.current.editingSegment).toMatchObject({ index: 1, text: 'Hi there' });
  });

  it('saves an edited segment through the API and updates state', async () => {
    vi.mocked(api.updateTranscript).mockResolvedValue({});
    const { result } = renderHook(() => useTranscript('job1', vi.fn()));

    act(() => {
      result.current.setTranscriptWithColors({ segments });
    });
    act(() => {
      result.current.handleEditText(segments[0], 0);
    });
    act(() => {
      result.current.setEditingSegment({
        speaker: 'SPEAKER_00',
        start: 0,
        end: 2,
        text: 'Hello, everyone',
        index: 0,
      });
    });
    await act(async () => {
      await result.current.handleSaveSegmentText();
    });

    expect(api.updateTranscript).toHaveBeenCalledTimes(1);
    const [uuid, updated] = vi.mocked(api.updateTranscript).mock.calls[0];
    expect(uuid).toBe('job1');
    expect(updated[0].text).toBe('Hello, everyone');
    expect(result.current.transcript?.segments?.[0].text).toBe('Hello, everyone');
    expect(result.current.showEditTextModal).toBe(false);
  });

  it('reassigns a segment to another speaker via the API and updates state', async () => {
    vi.mocked(api.updateTranscript).mockResolvedValue({});
    const { result } = renderHook(() => useTranscript('job1', vi.fn()));

    act(() => {
      result.current.setTranscriptWithColors({ segments });
    });
    await act(async () => {
      await result.current.handleMoveSegmentSpeaker(0, 'SPEAKER_01');
    });

    expect(api.updateTranscript).toHaveBeenCalledTimes(1);
    const [uuid, updated] = vi.mocked(api.updateTranscript).mock.calls[0];
    expect(uuid).toBe('job1');
    expect(updated[0].speaker).toBe('SPEAKER_01');
    expect(result.current.transcript?.segments?.[0].speaker).toBe('SPEAKER_01');
  });

  it('rolls back the speaker change if the API call fails', async () => {
    const setError = vi.fn();
    vi.mocked(api.updateTranscript).mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useTranscript('job1', setError));

    act(() => {
      result.current.setTranscriptWithColors({ segments });
    });
    await act(async () => {
      await result.current.handleMoveSegmentSpeaker(0, 'SPEAKER_01');
    });

    expect(result.current.transcript?.segments?.[0].speaker).toBe('SPEAKER_00');
    expect(setError).toHaveBeenCalledWith('network down');
  });

  it('bulk-reassigns several segments to another speaker in one API call', async () => {
    vi.mocked(api.updateTranscript).mockResolvedValue({});
    const { result } = renderHook(() => useTranscript('job1', vi.fn()));

    act(() => {
      result.current.setTranscriptWithColors({ segments: threeSpeakerSegments });
    });
    await act(async () => {
      await result.current.handleBulkMoveSegments([0, 2], 'SPEAKER_01');
    });

    expect(api.updateTranscript).toHaveBeenCalledTimes(1);
    const [uuid, updated] = vi.mocked(api.updateTranscript).mock.calls[0];
    expect(uuid).toBe('job1');
    expect(updated[0].speaker).toBe('SPEAKER_01');
    expect(updated[2].speaker).toBe('SPEAKER_01');
    expect(updated[1].speaker).toBe('SPEAKER_01'); // unchanged, already SPEAKER_01
    expect(result.current.transcript?.segments?.[0].speaker).toBe('SPEAKER_01');
    expect(result.current.transcript?.segments?.[2].speaker).toBe('SPEAKER_01');
  });

  it('rolls back a bulk speaker reassignment if the API call fails', async () => {
    const setError = vi.fn();
    vi.mocked(api.updateTranscript).mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useTranscript('job1', setError));

    act(() => {
      result.current.setTranscriptWithColors({ segments: threeSpeakerSegments });
    });
    await act(async () => {
      await result.current.handleBulkMoveSegments([0, 2], 'SPEAKER_01');
    });

    expect(result.current.transcript?.segments?.[0].speaker).toBe('SPEAKER_00');
    expect(result.current.transcript?.segments?.[2].speaker).toBe('SPEAKER_00');
    expect(setError).toHaveBeenCalledWith('network down');
  });

  it('deletes the given segments through the API and updates state', async () => {
    vi.mocked(api.updateTranscript).mockResolvedValue({});
    const { result } = renderHook(() => useTranscript('job1', vi.fn()));

    act(() => {
      result.current.setTranscriptWithColors({ segments: threeSpeakerSegments });
    });
    await act(async () => {
      await result.current.handleDeleteSegments([0, 2]);
    });

    expect(api.updateTranscript).toHaveBeenCalledTimes(1);
    const [uuid, updated] = vi.mocked(api.updateTranscript).mock.calls[0];
    expect(uuid).toBe('job1');
    expect(updated).toEqual([threeSpeakerSegments[1]]);
    expect(result.current.transcript?.segments).toEqual([threeSpeakerSegments[1]]);
  });

  it('rolls back a segment deletion if the API call fails', async () => {
    const setError = vi.fn();
    vi.mocked(api.updateTranscript).mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useTranscript('job1', setError));

    act(() => {
      result.current.setTranscriptWithColors({ segments: threeSpeakerSegments });
    });
    await act(async () => {
      await result.current.handleDeleteSegments([0, 2]);
    });

    expect(result.current.transcript?.segments).toEqual(threeSpeakerSegments);
    expect(setError).toHaveBeenCalledWith('network down');
  });

  it('saves edited start/end alongside text and speaker', async () => {
    vi.mocked(api.updateTranscript).mockResolvedValue({});
    const { result } = renderHook(() => useTranscript('job1', vi.fn()));

    act(() => {
      result.current.setTranscriptWithColors({ segments });
    });
    act(() => {
      result.current.handleEditText(segments[0], 0);
    });
    act(() => {
      result.current.setEditingSegment({
        speaker: 'SPEAKER_00',
        start: 1,
        end: 3,
        text: 'Hello',
        index: 0,
      });
    });
    await act(async () => {
      await result.current.handleSaveSegmentText();
    });

    expect(result.current.transcript?.segments?.[0]).toMatchObject({ start: 1, end: 3 });
  });

  it('inserts a blank segment after the given index, defaulting to the same speaker, and opens it for editing', () => {
    const { result } = renderHook(() => useTranscript('job1', vi.fn()));

    act(() => {
      result.current.setTranscriptWithColors({ segments: threeSpeakerSegments });
    });
    act(() => {
      result.current.handleInsertSegmentAfter(0);
    });

    expect(result.current.transcript?.segments).toHaveLength(4);
    const inserted = result.current.transcript?.segments?.[1];
    expect(inserted).toMatchObject({ speaker: 'SPEAKER_00', text: '' });
    expect(inserted?.start).toBe(2); // end of segment 0
    expect(result.current.showEditTextModal).toBe(true);
    expect(result.current.editingSegment).toMatchObject({ index: 1, text: '' });
    expect(api.updateTranscript).not.toHaveBeenCalled(); // nothing persisted until Save
  });

  it('removes an inserted-but-unsaved segment when the edit modal is cancelled', () => {
    const { result } = renderHook(() => useTranscript('job1', vi.fn()));

    act(() => {
      result.current.setTranscriptWithColors({ segments: threeSpeakerSegments });
    });
    act(() => {
      result.current.handleInsertSegmentAfter(0);
    });
    expect(result.current.transcript?.segments).toHaveLength(4);

    act(() => {
      result.current.handleCancelEditText();
    });

    expect(result.current.transcript?.segments).toEqual(threeSpeakerSegments);
    expect(result.current.showEditTextModal).toBe(false);
  });

  it('cancelling an edit of an existing (not freshly-inserted) segment does not remove it', () => {
    const { result } = renderHook(() => useTranscript('job1', vi.fn()));

    act(() => {
      result.current.setTranscriptWithColors({ segments });
    });
    act(() => {
      result.current.handleEditText(segments[0], 0);
    });
    act(() => {
      result.current.handleCancelEditText();
    });

    expect(result.current.transcript?.segments).toEqual(segments);
  });

  it('splits a segment into two, dividing time proportionally to the text split', async () => {
    vi.mocked(api.updateTranscript).mockResolvedValue({});
    const { result } = renderHook(() => useTranscript('job1', vi.fn()));

    act(() => {
      result.current.setTranscriptWithColors({
        segments: [{ speaker: 'SPEAKER_00', start: 0, end: 10, text: 'aaaaabbbbb' }],
      });
    });
    await act(async () => {
      await result.current.handleSplitSegment(0, 'aaaaa', 'bbbbb', 'SPEAKER_01');
    });

    expect(api.updateTranscript).toHaveBeenCalledTimes(1);
    const updated = result.current.transcript?.segments;
    expect(updated).toHaveLength(2);
    expect(updated?.[0]).toMatchObject({ speaker: 'SPEAKER_00', text: 'aaaaa', start: 0, end: 5 });
    expect(updated?.[1]).toMatchObject({
      speaker: 'SPEAKER_01',
      text: 'bbbbb',
      start: 5,
      end: 10,
    });
  });

  it('rolls back a split if the API call fails', async () => {
    const setError = vi.fn();
    vi.mocked(api.updateTranscript).mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useTranscript('job1', setError));

    act(() => {
      result.current.setTranscriptWithColors({ segments: threeSpeakerSegments });
    });
    await act(async () => {
      await result.current.handleSplitSegment(0, 'Hel', 'lo', 'SPEAKER_01');
    });

    expect(result.current.transcript?.segments).toEqual(threeSpeakerSegments);
    expect(setError).toHaveBeenCalledWith('network down');
  });
});
