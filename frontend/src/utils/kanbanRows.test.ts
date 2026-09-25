import { describe, it, expect } from 'vitest';
import { buildKanbanRows, SILENCE_LABEL_THRESHOLD_SECONDS } from './kanbanRows';

describe('buildKanbanRows', () => {
  it('returns no rows for no segments', () => {
    expect(buildKanbanRows([])).toEqual([]);
  });

  it('orders rows by start time, keeping the original index', () => {
    const rows = buildKanbanRows([
      { start: 10, end: 12 },
      { start: 0, end: 2 },
      { start: 5, end: 6 },
    ]);
    expect(rows).toEqual([
      { kind: 'segment', index: 1 },
      { kind: 'segment', index: 2 },
      { kind: 'segment', index: 0 },
    ]);
  });

  it('keeps the original order for segments starting at the same time', () => {
    const rows = buildKanbanRows([
      { start: 3, end: 4 },
      { start: 3, end: 5 },
    ]);
    expect(rows).toEqual([
      { kind: 'segment', index: 0 },
      { kind: 'segment', index: 1 },
    ]);
  });

  it('accepts numeric strings for start and end', () => {
    const rows = buildKanbanRows([
      { start: '9.5', end: '10' },
      { start: '1.25', end: '2' },
    ]);
    expect(rows.map((row) => row.kind === 'segment' && row.index)).toEqual([1, 0]);
  });

  it('inserts a silence row for a pause at or above the threshold', () => {
    const rows = buildKanbanRows([
      { start: 0, end: 2 },
      { start: 2 + SILENCE_LABEL_THRESHOLD_SECONDS, end: 30 },
    ]);
    expect(rows).toEqual([
      { kind: 'segment', index: 0 },
      { kind: 'silence', durationSeconds: SILENCE_LABEL_THRESHOLD_SECONDS },
      { kind: 'segment', index: 1 },
    ]);
  });

  it('does not insert a silence row for a shorter pause', () => {
    const rows = buildKanbanRows([
      { start: 0, end: 2 },
      { start: 2 + SILENCE_LABEL_THRESHOLD_SECONDS - 1, end: 30 },
    ]);
    expect(rows.some((row) => row.kind === 'silence')).toBe(false);
  });

  it('measures silence from the latest end, not the previous segment', () => {
    // A long line (0-60s) overlaps a short one (5-6s): 6s -> 65s is not silence.
    const rows = buildKanbanRows([
      { start: 0, end: 60 },
      { start: 5, end: 6 },
      { start: 65, end: 70 },
    ]);
    expect(rows.some((row) => row.kind === 'silence')).toBe(false);
  });
});
