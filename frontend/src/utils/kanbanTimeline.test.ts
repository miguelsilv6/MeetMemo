import { describe, it, expect } from 'vitest';
import { buildKanbanTimeline, resolveColumnOverlap, KANBAN_PX_PER_SECOND } from './kanbanTimeline';

describe('buildKanbanTimeline', () => {
  it('returns an empty timeline for no segments', () => {
    const timeline = buildKanbanTimeline([]);
    expect(timeline.totalHeight).toBe(0);
    expect(timeline.silences).toEqual([]);
    expect(timeline.toY(10)).toBe(0);
  });

  it('maps the first segment start to y=0, anchored at the conversation start', () => {
    const timeline = buildKanbanTimeline([{ start: 5, end: 8 }]);
    expect(timeline.toY(5)).toBe(0);
  });

  it('gives the same y for the same timestamp regardless of which speaker owns it', () => {
    // Two speakers, interleaved, both starting exactly at t=10.
    const segments = [
      { start: 0, end: 2 },
      { start: 10, end: 12 },
      { start: 10, end: 11 },
    ];
    const timeline = buildKanbanTimeline(segments);
    expect(timeline.toY(10)).toBe(timeline.toY(10));
  });

  it('positions time proportionally within a continuous stretch of speech', () => {
    const timeline = buildKanbanTimeline([{ start: 0, end: 10 }]);
    expect(timeline.toY(5)).toBeCloseTo(5 * KANBAN_PX_PER_SECOND);
  });

  it('does not report a silence for a short gap between segments', () => {
    const timeline = buildKanbanTimeline([
      { start: 0, end: 2 },
      { start: 5, end: 7 },
    ]);
    expect(timeline.silences).toEqual([]);
  });

  it('reports a silence for a long gap where nobody is speaking, across all speakers combined', () => {
    // SPEAKER_00 talks 0-2s, SPEAKER_01 doesn't start until 45s: the real
    // silence is 43s (from the end of the last speech, not from t=0).
    const timeline = buildKanbanTimeline([
      { start: 0, end: 2 },
      { start: 45, end: 47 },
    ]);
    expect(timeline.silences).toHaveLength(1);
    expect(timeline.silences[0].durationSeconds).toBe(43);
  });

  it('does not count an overlapping second speaker as silence', () => {
    // SPEAKER_01 starts talking before SPEAKER_00 finishes - no true gap.
    const timeline = buildKanbanTimeline([
      { start: 0, end: 30 },
      { start: 20, end: 50 },
    ]);
    expect(timeline.silences).toEqual([]);
  });

  it('caps how much vertical space a very long silence takes', () => {
    const timeline = buildKanbanTimeline([
      { start: 0, end: 2 },
      { start: 1000, end: 1002 },
    ]);
    expect(timeline.silences[0].heightPx).toBeLessThan(1000 * KANBAN_PX_PER_SECOND);
  });
});

describe('resolveColumnOverlap', () => {
  it('keeps natural tops when they are already spaced out enough', () => {
    expect(resolveColumnOverlap([0, 200, 400], 72)).toEqual([0, 200, 400]);
  });

  it('pushes a bubble down to clear the minimum height of the one above it', () => {
    expect(resolveColumnOverlap([0, 10], 72)).toEqual([0, 72]);
  });

  it('cascades the push-down across several tightly-packed bubbles', () => {
    expect(resolveColumnOverlap([0, 5, 10], 72)).toEqual([0, 72, 144]);
  });

  it('returns an empty array for no bubbles', () => {
    expect(resolveColumnOverlap([], 72)).toEqual([]);
  });
});
