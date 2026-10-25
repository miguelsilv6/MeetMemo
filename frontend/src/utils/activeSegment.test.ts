import { describe, it, expect } from 'vitest';
import type { TranscriptSegment } from '../types/api';
import { findActiveSegmentIndex } from './activeSegment';

const segment = (speaker: string, start: number, end: number): TranscriptSegment => ({
  speaker,
  text: '…',
  start,
  end,
});

describe('findActiveSegmentIndex', () => {
  it('follows segments one after another', () => {
    const segments = [segment('A', 0, 4), segment('B', 4, 9)];
    expect(findActiveSegmentIndex(segments, 2)).toBe(0);
    expect(findActiveSegmentIndex(segments, 4)).toBe(1);
  });

  it('moves to the speaker who started last when segments overlap', () => {
    // A long segment of one channel spans the other channel's lines.
    const segments = [segment('A', 10, 30), segment('B', 12, 18), segment('B', 20, 26)];
    expect(findActiveSegmentIndex(segments, 11)).toBe(0);
    expect(findActiveSegmentIndex(segments, 15)).toBe(1);
    expect(findActiveSegmentIndex(segments, 19)).toBe(0);
    expect(findActiveSegmentIndex(segments, 22)).toBe(2);
  });

  it('keeps the last segment after the end and none in a gap or before the start', () => {
    const segments = [segment('A', 2, 4), segment('B', 6, 8)];
    expect(findActiveSegmentIndex(segments, 1)).toBe(-1);
    expect(findActiveSegmentIndex(segments, 5)).toBe(-1);
    expect(findActiveSegmentIndex(segments, 9)).toBe(1);
  });

  it('has nothing to highlight without segments', () => {
    expect(findActiveSegmentIndex(undefined, 3)).toBe(-1);
    expect(findActiveSegmentIndex([], 3)).toBe(-1);
  });
});
