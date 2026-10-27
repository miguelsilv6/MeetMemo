import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useTranscript from './useTranscript';
import { RETRY_DELAYS_MS } from './useTranscriptSaver';
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

  it('moves a segment between two lines of another speaker, saves it and can undo it', async () => {
    vi.mocked(api.updateTranscript).mockResolvedValue({});
    const call: TranscriptSegment[] = [
      { speaker: 'SPEAKER_00', start: 0, end: 2, text: 'one' },
      { speaker: 'SPEAKER_00', start: 3, end: 5, text: 'two' },
      { speaker: 'SPEAKER_00', start: 10, end: 12, text: 'three' },
      { speaker: 'SPEAKER_01', start: 40, end: 43, text: 'reply' },
    ];
    const { result } = renderHook(() => useTranscript('job1', vi.fn()));

    act(() => {
      result.current.setTranscriptWithColors({ segments: call });
    });
    await act(async () => {
      await result.current.handleMoveSegmentTo(3, 1, 'after', 'SPEAKER_00');
    });

    const [, saved] = vi.mocked(api.updateTranscript).mock.calls[0];
    expect(saved.map((s) => s.text)).toEqual(['one', 'two', 'reply', 'three']);
    expect(saved[2]).toMatchObject({ speaker: 'SPEAKER_00', start: 5, end: 8 });
    expect(result.current.transcript?.segments).toEqual(saved);

    await act(async () => {
      await result.current.handleUndo();
    });
    expect(result.current.transcript?.segments).toEqual(call);
  });

  it('keeps the new speaker names when undoing an edit made before the rename', async () => {
    vi.mocked(api.updateTranscript).mockResolvedValue({});
    const { result } = renderHook(() => useTranscript('job1', vi.fn()));
    act(() => {
      result.current.setTranscriptWithColors({ segments: threeSpeakerSegments });
    });
    await act(async () => {
      await result.current.handleDeleteSegments([2]);
    });

    // The names are saved on the server; then the deletion is undone.
    act(() => {
      result.current.setTranscriptWithColors({
        segments: result.current.transcript!.segments!.map((s) => ({
          ...s,
          speaker: s.speaker === 'SPEAKER_00' ? 'SPEAKER_01' : 'SPEAKER_00',
        })),
      });
      result.current.renameSpeakersInHistory({
        SPEAKER_00: 'SPEAKER_01',
        SPEAKER_01: 'SPEAKER_00',
      });
    });
    await act(async () => {
      await result.current.handleUndo();
    });

    const [, saved] = vi.mocked(api.updateTranscript).mock.calls.at(-1)!;
    expect(saved.map((s) => [s.speaker, s.text])).toEqual([
      ['SPEAKER_01', 'Hello'],
      ['SPEAKER_00', 'Hi there'],
      ['SPEAKER_01', 'How are you'],
    ]);
  });

  it('merges a line into another, saves it and can undo it', async () => {
    vi.mocked(api.updateTranscript).mockResolvedValue({});
    const { result } = renderHook(() => useTranscript('job1', vi.fn()));
    act(() => {
      result.current.setTranscriptWithColors({ segments: threeSpeakerSegments });
    });

    await act(async () => {
      await result.current.handleMergeSegmentInto(1, 0);
    });
    const [, saved] = vi.mocked(api.updateTranscript).mock.calls[0];
    expect(saved.map((s) => [s.speaker, s.text])).toEqual([
      ['SPEAKER_00', 'Hello Hi there'],
      ['SPEAKER_00', 'How are you'],
    ]);
    expect(result.current.transcript?.segments).toEqual(saved);

    await act(async () => {
      await result.current.handleUndo();
    });
    expect(result.current.transcript?.segments).toEqual(threeSpeakerSegments);
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

  it('splits at an explicit splitRatio (e.g. picked on the waveform) instead of the text-length estimate', async () => {
    vi.mocked(api.updateTranscript).mockResolvedValue({});
    const { result } = renderHook(() => useTranscript('job1', vi.fn()));

    act(() => {
      result.current.setTranscriptWithColors({
        segments: [{ speaker: 'SPEAKER_00', start: 0, end: 10, text: 'aaaaabbbbb' }],
      });
    });
    await act(async () => {
      await result.current.handleSplitSegment(0, 'aaaaa', 'bbbbb', 'SPEAKER_01', 0.2);
    });

    const updated = result.current.transcript?.segments;
    expect(updated?.[0]).toMatchObject({ end: 2 });
    expect(updated?.[1]).toMatchObject({ start: 2, end: 10 });
  });

  it('has no undo history for a freshly-loaded transcript', () => {
    const { result } = renderHook(() => useTranscript('job1', vi.fn()));
    act(() => {
      result.current.setTranscriptWithColors({ segments: threeSpeakerSegments });
    });
    expect(result.current.canUndo).toBe(false);
  });

  it('tracks undo history after a mutation and steps back through it', async () => {
    vi.mocked(api.updateTranscript).mockResolvedValue({});
    const { result } = renderHook(() => useTranscript('job1', vi.fn()));

    act(() => {
      result.current.setTranscriptWithColors({ segments });
    });
    await act(async () => {
      await result.current.handleMoveSegmentSpeaker(0, 'SPEAKER_01');
    });

    expect(result.current.canUndo).toBe(true);
    expect(result.current.transcript?.segments?.[0].speaker).toBe('SPEAKER_01');

    await act(async () => {
      await result.current.handleUndo();
    });

    expect(result.current.transcript?.segments).toEqual(segments);
    expect(result.current.canUndo).toBe(false);
    // The undo itself is persisted to the backend.
    expect(api.updateTranscript).toHaveBeenLastCalledWith('job1', segments);
  });

  it('does nothing when there is no history to undo', async () => {
    const { result } = renderHook(() => useTranscript('job1', vi.fn()));
    act(() => {
      result.current.setTranscriptWithColors({ segments });
    });

    await act(async () => {
      await result.current.handleUndo();
    });

    expect(api.updateTranscript).not.toHaveBeenCalled();
    expect(result.current.transcript?.segments).toEqual(segments);
  });

  it('does not add an unsaved, cancelled insert to the undo history', () => {
    const { result } = renderHook(() => useTranscript('job1', vi.fn()));
    act(() => {
      result.current.setTranscriptWithColors({ segments: threeSpeakerSegments });
    });
    act(() => {
      result.current.handleInsertSegmentAfter(0);
    });
    act(() => {
      result.current.handleCancelEditText();
    });

    expect(result.current.canUndo).toBe(false);
  });

  it('undoing a saved insert restores the pre-insert persisted state, not the blank placeholder', async () => {
    vi.mocked(api.updateTranscript).mockResolvedValue({});
    const { result } = renderHook(() => useTranscript('job1', vi.fn()));

    act(() => {
      result.current.setTranscriptWithColors({ segments: threeSpeakerSegments });
    });
    act(() => {
      result.current.handleInsertSegmentAfter(0);
    });
    act(() => {
      result.current.setEditingSegment({
        speaker: 'SPEAKER_00',
        start: 2,
        end: 3,
        text: 'Filled in',
        index: 1,
      });
    });
    await act(async () => {
      await result.current.handleSaveSegmentText();
    });
    expect(result.current.transcript?.segments).toHaveLength(4);

    await act(async () => {
      await result.current.handleUndo();
    });

    expect(result.current.transcript?.segments).toEqual(threeSpeakerSegments);
  });

  it('drops the word confidences of a segment whose text is edited or split', async () => {
    vi.mocked(api.updateTranscript).mockResolvedValue({});
    const words = [
      { start: 0, end: 1, word: ' Bom', probability: 0.4 },
      { start: 1, end: 2, word: ' dia', probability: 0.9 },
    ];
    const { result } = renderHook(() => useTranscript('job1', vi.fn()));
    act(() => {
      result.current.setTranscriptWithColors({
        segments: [
          { speaker: 'SPEAKER_00', start: 0, end: 2, text: 'Bom dia', words },
          { speaker: 'SPEAKER_01', start: 2, end: 4, text: 'Olá', words },
        ],
      });
    });

    // Only the speaker changes: the words still describe the text.
    act(() => {
      result.current.setEditingSegment({
        speaker: 'SPEAKER_01',
        start: 0,
        end: 2,
        text: 'Bom dia',
        index: 0,
      });
    });
    await act(async () => {
      await result.current.handleSaveSegmentText();
    });
    expect(result.current.transcript?.segments?.[0].words).toEqual(words);

    act(() => {
      result.current.setEditingSegment({
        speaker: 'SPEAKER_01',
        start: 0,
        end: 2,
        text: 'Bom dia a todos',
        index: 0,
      });
    });
    await act(async () => {
      await result.current.handleSaveSegmentText();
    });
    expect(result.current.transcript?.segments?.[0].words).toBeUndefined();

    await act(async () => {
      await result.current.handleSplitSegment(1, 'O', 'lá', 'SPEAKER_00');
    });
    expect(result.current.transcript?.segments?.[1].words).toBeUndefined();
  });

  describe('when the server does not save an edit', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const load = () => {
      const setError = vi.fn();
      const hook = renderHook(() => useTranscript('job1', setError));
      act(() => {
        hook.result.current.setTranscriptWithColors({ segments: threeSpeakerSegments });
      });
      return { ...hook, setError };
    };

    type Hook = ReturnType<typeof load>['result']['current'];
    const edits: [string, (h: Hook) => void][] = [
      ['a speaker change', (h) => h.handleMoveSegmentSpeaker(0, 'SPEAKER_01')],
      ['a move next to another line', (h) => h.handleMoveSegmentTo(2, 0, 'after', 'SPEAKER_00')],
      ['a merge', (h) => h.handleMergeSegmentInto(1, 0)],
      ['a bulk speaker change', (h) => h.handleBulkMoveSegments([0, 2], 'SPEAKER_01')],
      ['a deletion', (h) => h.handleDeleteSegments([1])],
      ['a split', (h) => h.handleSplitSegment(0, 'Hel', 'lo', 'SPEAKER_01')],
    ];

    it.each(edits)('keeps %s on screen and undoable, waiting to be saved', async (_, edit) => {
      vi.mocked(api.updateTranscript).mockRejectedValue(new Error('network down'));
      const { result, setError } = load();

      await act(async () => {
        edit(result.current);
      });

      const shown = result.current.transcript?.segments;
      expect(shown).not.toEqual(threeSpeakerSegments);
      expect(api.updateTranscript).toHaveBeenLastCalledWith('job1', shown);
      expect(result.current.saveState).toBe('pending');
      expect(result.current.saveError).toBe('network down');
      expect(result.current.canUndo).toBe(true);
      expect(setError).not.toHaveBeenCalledWith('network down');
    });

    it('keeps an edited text and closes the editor at once', async () => {
      vi.mocked(api.updateTranscript).mockRejectedValue(new Error('network down'));
      const { result } = load();
      act(() => {
        result.current.handleEditText(threeSpeakerSegments[0], 0);
      });
      act(() => {
        result.current.setEditingSegment({ ...result.current.editingSegment!, text: 'Olá' });
      });
      await act(async () => {
        result.current.handleSaveSegmentText();
      });

      expect(result.current.transcript?.segments?.[0].text).toBe('Olá');
      expect(result.current.showEditTextModal).toBe(false);
      expect(result.current.saveState).toBe('pending');
    });

    it('saves it on the next attempt', async () => {
      vi.useFakeTimers();
      vi.mocked(api.updateTranscript)
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValue({});
      const { result } = load();

      await act(async () => {
        result.current.handleMergeSegmentInto(1, 0);
      });
      expect(result.current.saveState).toBe('pending');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
      });
      expect(result.current.saveState).toBe('saved');
      expect(api.updateTranscript).toHaveBeenCalledTimes(2);
      expect(api.updateTranscript).toHaveBeenLastCalledWith(
        'job1',
        result.current.transcript?.segments
      );
    });

    it('saves an edit still waiting with the speakers renamed meanwhile', async () => {
      vi.useFakeTimers();
      vi.mocked(api.updateTranscript)
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValue({});
      const { result } = load();
      await act(async () => {
        result.current.handleDeleteSegments([2]);
      });

      act(() => {
        result.current.renameSpeakersInHistory({ SPEAKER_00: 'Ana' });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]);
      });

      const [, saved] = vi.mocked(api.updateTranscript).mock.calls.at(-1)!;
      expect(saved.map((s) => s.speaker)).toEqual(['Ana', 'SPEAKER_01']);
    });

    it('keeps an undo too, and saves it with the edits', async () => {
      vi.mocked(api.updateTranscript).mockResolvedValueOnce({});
      const { result } = load();
      await act(async () => {
        result.current.handleMoveSegmentSpeaker(0, 'SPEAKER_01');
      });

      vi.mocked(api.updateTranscript).mockRejectedValueOnce(new Error('network down'));
      await act(async () => {
        result.current.handleUndo();
      });

      expect(result.current.transcript?.segments).toEqual(threeSpeakerSegments);
      expect(result.current.canUndo).toBe(false);
      expect(result.current.saveState).toBe('pending');
      expect(api.updateTranscript).toHaveBeenLastCalledWith('job1', threeSpeakerSegments);
    });
  });
});
