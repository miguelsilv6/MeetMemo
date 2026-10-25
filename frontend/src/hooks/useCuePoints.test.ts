import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import useCuePoints from './useCuePoints';
import * as api from '../services/api';
import type { CuePoint } from '../types/api';

vi.mock('../services/api');

const cue = (id: number, position: number, note = ''): CuePoint => ({
  id,
  position_seconds: position,
  note,
  created_by: 'ana',
  created_at: '2026-10-25T10:00:00Z',
  updated_at: '2026-10-25T10:00:00Z',
});

async function loaded(cuePoints: CuePoint[]) {
  vi.mocked(api.listCuePoints).mockResolvedValue(cuePoints);
  const hook = renderHook(() => useCuePoints('job1'));
  await waitFor(() => expect(hook.result.current.cuePoints).toHaveLength(cuePoints.length));
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useCuePoints', () => {
  it("loads the audio's cue points in time order", async () => {
    const { result } = await loaded([cue(2, 80), cue(1, 10, 'morada')]);
    expect(api.listCuePoints).toHaveBeenCalledWith('job1');
    expect(result.current.cuePoints.map((c) => c.id)).toEqual([1, 2]);
  });

  it('adds a cue point in its place and marks it as just added', async () => {
    const { result } = await loaded([cue(1, 10), cue(2, 80)]);
    vi.mocked(api.createCuePoint).mockResolvedValue(cue(3, 42.5));

    await act(async () => {
      await result.current.addCuePoint(42.5);
    });

    expect(api.createCuePoint).toHaveBeenCalledWith('job1', 42.5);
    expect(result.current.cuePoints.map((c) => c.id)).toEqual([1, 3, 2]);
    expect(result.current.addedId).toBe(3);
  });

  it('shows a changed note at once and keeps what the server saved', async () => {
    const { result } = await loaded([cue(1, 10, 'old')]);
    const saved = { ...cue(1, 10, 'new'), updated_at: '2026-10-25T11:00:00Z' };
    vi.mocked(api.updateCuePoint).mockResolvedValue(saved);

    await act(async () => {
      await result.current.updateNote(1, '  new ');
    });

    expect(api.updateCuePoint).toHaveBeenCalledWith('job1', 1, '  new ');
    expect(result.current.cuePoints[0]).toEqual(saved);
  });

  it('stops focusing the new cue point once its note is left', async () => {
    const { result } = await loaded([]);
    vi.mocked(api.createCuePoint).mockResolvedValue(cue(3, 5));
    await act(async () => {
      await result.current.addCuePoint(5);
    });
    expect(result.current.addedId).toBe(3);

    await act(async () => {
      await result.current.updateNote(3, '');
    });
    expect(result.current.addedId).toBeNull();
  });

  it('does not save a note that did not change', async () => {
    const { result } = await loaded([cue(1, 10, 'same')]);
    await act(async () => {
      await result.current.updateNote(1, 'same ');
    });
    expect(api.updateCuePoint).not.toHaveBeenCalled();
  });

  it('puts the note back when the server refuses it', async () => {
    const { result } = await loaded([cue(1, 10, 'old')]);
    vi.mocked(api.updateCuePoint).mockRejectedValue(new Error('network down'));

    await act(async () => {
      await result.current.updateNote(1, 'new');
    });

    expect(result.current.cuePoints[0].note).toBe('old');
    expect(result.current.error).toBe('network down');
  });

  it('removes a cue point, and brings it back if the server refuses', async () => {
    const { result } = await loaded([cue(1, 10), cue(2, 80)]);
    vi.mocked(api.deleteCuePoint).mockResolvedValueOnce(undefined);
    await act(async () => {
      await result.current.removeCuePoint(1);
    });
    expect(api.deleteCuePoint).toHaveBeenCalledWith('job1', 1);
    expect(result.current.cuePoints.map((c) => c.id)).toEqual([2]);

    vi.mocked(api.deleteCuePoint).mockRejectedValueOnce(new Error('network down'));
    await act(async () => {
      await result.current.removeCuePoint(2);
    });
    expect(result.current.cuePoints.map((c) => c.id)).toEqual([2]);
    expect(result.current.error).toBe('network down');
  });

  it('reports a cue point the server would not add (e.g. the limit)', async () => {
    const { result } = await loaded([]);
    vi.mocked(api.createCuePoint).mockRejectedValue(
      new Error('An audio can have at most 200 cue points')
    );
    await act(async () => {
      await result.current.addCuePoint(5);
    });
    expect(result.current.cuePoints).toEqual([]);
    expect(result.current.error).toBe('An audio can have at most 200 cue points');
  });

  it('has nothing without an audio', () => {
    const { result } = renderHook(() => useCuePoints(null));
    expect(result.current.cuePoints).toEqual([]);
    expect(api.listCuePoints).not.toHaveBeenCalled();
  });
});
