import { describe, it, expect } from 'vitest';
import type { TranscriptSegment } from '../types/api';
import { moveSegmentNextTo } from './moveSegment';

const seg = (speaker: string, start: number, end: number, text = `${speaker} ${start}`) =>
  ({ speaker, start, end, text }) as TranscriptSegment;

// Speaker A has three lines in a row; B's line was transcribed much later.
const call = () => [
  seg('A', 0, 2, 'A1'),
  seg('A', 3, 5, 'A2'),
  seg('A', 10, 12, 'A3'),
  seg('B', 40, 43, 'B1'),
];

describe('moveSegmentNextTo', () => {
  it('puts a line between two lines of another speaker, with times there', () => {
    const moved = moveSegmentNextTo(call(), 3, 1, 'after')!;

    expect(moved.map((s) => s.text)).toEqual(['A1', 'A2', 'B1', 'A3']);
    expect(moved[2]).toMatchObject({
      speaker: 'A',
      start: 5,
      end: 8,
      original: { speaker: 'B', start: 40, end: 43 },
    });
  });

  it('dropping before the next line is the same place', () => {
    expect(moveSegmentNextTo(call(), 3, 2, 'before')).toEqual(
      moveSegmentNextTo(call(), 3, 1, 'after')
    );
  });

  it('shortens the line when the gap is smaller than it', () => {
    const segments = [seg('A', 0, 2), seg('A', 3, 4), seg('B', 40, 45)];
    const moved = moveSegmentNextTo(segments, 2, 0, 'after')!;
    expect(moved[1]).toMatchObject({ start: 2, end: 3 });
  });

  it('keeps at least a second when there is no room at all', () => {
    const segments = [seg('A', 0, 2), seg('A', 2, 4), seg('B', 40, 43)];
    expect(moveSegmentNextTo(segments, 2, 0, 'after')![1]).toMatchObject({ start: 2, end: 3 });
    expect(moveSegmentNextTo(segments, 2, 0, 'before')![0]).toMatchObject({ start: 0, end: 1 });
  });

  it('places a line before the first or after the last line of a column', () => {
    const first = moveSegmentNextTo([seg('A', 10, 12), seg('B', 40, 43)], 1, 0, 'before')!;
    expect(first[0]).toMatchObject({ speaker: 'A', start: 7, end: 10 });

    const last = moveSegmentNextTo([seg('B', 0, 3), seg('A', 10, 12)], 0, 1, 'after')!;
    expect(last[1]).toMatchObject({ speaker: 'A', start: 12, end: 15 });
  });

  it('only changes the speaker when the line already falls there', () => {
    const segments = [seg('A', 0, 2), seg('B', 4, 6), seg('A', 8, 9)];
    const moved = moveSegmentNextTo(segments, 1, 0, 'after')!;
    expect(moved[1]).toEqual({ ...segments[1], speaker: 'A' });
  });

  it('reorders within one column', () => {
    const segments = [seg('A', 0, 2, 'one'), seg('A', 3, 5, 'two'), seg('A', 6, 7, 'three')];
    const moved = moveSegmentNextTo(segments, 2, 0, 'after')!;
    expect(moved.map((s) => s.text)).toEqual(['one', 'three', 'two']);
    expect(moved[1]).toMatchObject({ start: 2, end: 3, original: { start: 6, end: 7 } });
  });

  it('does nothing when dropped where it already is', () => {
    const segments = call();
    expect(moveSegmentNextTo(segments, 1, 0, 'after')).toBeNull();
    expect(moveSegmentNextTo(segments, 1, 1, 'before')).toBeNull();
  });

  it('re-times the words into the new span', () => {
    const segments = call();
    segments[3] = {
      ...segments[3],
      words: [
        { start: 40, end: 41, word: ' Bom', probability: 0.9 },
        { start: 41.5, end: 43, word: ' dia', probability: 0.4 },
      ],
    };
    const moved = moveSegmentNextTo(segments, 3, 1, 'after')!;
    expect(moved[2].words).toEqual([
      { start: 5, end: 6, word: ' Bom', probability: 0.9 },
      { start: 6.5, end: 8, word: ' dia', probability: 0.4 },
    ]);
  });

  it('keeps the first original times when moved again', () => {
    const once = moveSegmentNextTo(call(), 3, 1, 'after')!;
    const twice = moveSegmentNextTo(once, 2, 0, 'before')!;
    expect(twice[0].original).toEqual({ speaker: 'B', start: 40, end: 43 });
  });
});
