import { describe, it, expect } from 'vitest';
import type { TranscriptSegment } from '../types/api';
import { mergeSegmentInto, moveSegmentNextTo } from './moveSegment';

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
    const moved = moveSegmentNextTo(call(), 3, 1, 'after', 'A')!;

    expect(moved.map((s) => s.text)).toEqual(['A1', 'A2', 'B1', 'A3']);
    expect(moved[2]).toMatchObject({
      speaker: 'A',
      start: 5,
      end: 8,
      original: { speaker: 'B', start: 40, end: 43 },
    });
  });

  it("keeps the line's own speaker when dropped between another speaker's lines", () => {
    // B1 dragged within B's column to the height between A2 and A3.
    const moved = moveSegmentNextTo(call(), 3, 1, 'after', 'B')!;

    expect(moved.map((s) => s.text)).toEqual(['A1', 'A2', 'B1', 'A3']);
    expect(moved[2]).toMatchObject({
      speaker: 'B',
      start: 5,
      end: 8,
      original: { speaker: 'B', start: 40, end: 43 },
    });
  });

  it('goes next to the line it is dropped at, whoever says the lines around it', () => {
    const segments = [
      seg('A', 0, 2, 'A1'),
      seg('B', 2, 4, 'B1'),
      seg('A', 10, 12, 'A2'),
      seg('C', 30, 33, 'C1'),
    ];
    // C1 dropped right after A1, before B1 (another speaker's line).
    const moved = moveSegmentNextTo(segments, 3, 0, 'after', 'C')!;
    expect(moved.map((s) => s.text)).toEqual(['A1', 'C1', 'B1', 'A2']);
    expect(moved[1]).toMatchObject({ speaker: 'C', start: 2, end: 3 });
  });

  it('dropping before the next line is the same place', () => {
    expect(moveSegmentNextTo(call(), 3, 2, 'before', 'A')).toEqual(
      moveSegmentNextTo(call(), 3, 1, 'after', 'A')
    );
  });

  it('shortens the line when the gap is smaller than it', () => {
    const segments = [seg('A', 0, 2), seg('A', 3, 4), seg('B', 40, 45)];
    const moved = moveSegmentNextTo(segments, 2, 0, 'after', 'A')!;
    expect(moved[1]).toMatchObject({ start: 2, end: 3 });
  });

  it('keeps at least a second when there is no room at all', () => {
    const segments = [seg('A', 0, 2), seg('A', 2, 4), seg('B', 40, 43)];
    expect(moveSegmentNextTo(segments, 2, 0, 'after', 'A')![1]).toMatchObject({ start: 2, end: 3 });
    expect(moveSegmentNextTo(segments, 2, 0, 'before', 'A')![0]).toMatchObject({
      start: 0,
      end: 1,
    });
  });

  it('places a line before the first or after the last line of a column', () => {
    const first = moveSegmentNextTo([seg('A', 10, 12), seg('B', 40, 43)], 1, 0, 'before', 'A')!;
    expect(first[0]).toMatchObject({ speaker: 'A', start: 7, end: 10 });

    const last = moveSegmentNextTo([seg('B', 0, 3), seg('A', 10, 12)], 0, 1, 'after', 'A')!;
    expect(last[1]).toMatchObject({ speaker: 'A', start: 12, end: 15 });
  });

  it('only changes the speaker when the line already falls there', () => {
    const segments = [seg('A', 0, 2), seg('B', 4, 6), seg('A', 8, 9)];
    const moved = moveSegmentNextTo(segments, 1, 0, 'after', 'A')!;
    expect(moved[1]).toEqual({ ...segments[1], speaker: 'A' });
  });

  it('reorders within one column', () => {
    const segments = [seg('A', 0, 2, 'one'), seg('A', 3, 5, 'two'), seg('A', 6, 7, 'three')];
    const moved = moveSegmentNextTo(segments, 2, 0, 'after', 'A')!;
    expect(moved.map((s) => s.text)).toEqual(['one', 'three', 'two']);
    expect(moved[1]).toMatchObject({ start: 2, end: 3, original: { start: 6, end: 7 } });
  });

  it('does nothing when dropped where it already is', () => {
    const segments = call();
    expect(moveSegmentNextTo(segments, 1, 0, 'after', 'A')).toBeNull();
    expect(moveSegmentNextTo(segments, 1, 1, 'before', 'A')).toBeNull();
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
    const moved = moveSegmentNextTo(segments, 3, 1, 'after', 'A')!;
    expect(moved[2].words).toEqual([
      { start: 5, end: 6, word: ' Bom', probability: 0.9 },
      { start: 6.5, end: 8, word: ' dia', probability: 0.4 },
    ]);
  });

  it('keeps the first original times when moved again', () => {
    const once = moveSegmentNextTo(call(), 3, 1, 'after', 'A')!;
    const twice = moveSegmentNextTo(once, 2, 0, 'before', 'A')!;
    expect(twice[0].original).toEqual({ speaker: 'B', start: 40, end: 43 });
  });
});

describe('mergeSegmentInto', () => {
  it("puts the dropped line's text after the target's, said by the target's speaker", () => {
    const merged = mergeSegmentInto(call(), 3, 1)!;
    expect(merged.map((s) => s.text)).toEqual(['A1', 'A2 B1', 'A3']);
    expect(merged[1].speaker).toBe('A');
  });

  it('spans both lines when no other line comes between them', () => {
    const lines = [seg('A', 0, 2, 'A1'), seg('B', 2.5, 4, 'B1'), seg('A', 5, 6, 'A2')];
    expect(mergeSegmentInto(lines, 1, 0)).toEqual([
      expect.objectContaining({ text: 'A1 B1', start: 0, end: 4 }),
      seg('A', 5, 6, 'A2'),
    ]);
    // Dropped onto the line after it: still both, the target's text first.
    expect(mergeSegmentInto(lines, 0, 1)![0]).toMatchObject({ text: 'B1 A1', start: 0, end: 4 });
  });

  it('far apart, keeps the target times and grows only up to its next line', () => {
    // B1 (40-43) dropped onto A2 (3-5): 3 more seconds, but A3 starts at 10.
    expect(mergeSegmentInto(call(), 3, 1)![1]).toMatchObject({ start: 3, end: 8 });
    // Onto A1 (0-2), with A2 at 3: only one more second fits.
    expect(mergeSegmentInto(call(), 3, 0)![0]).toMatchObject({ start: 0, end: 3 });
  });

  it('keeps a second at least for the merged text, even with no room before the next line', () => {
    const lines = [seg('A', 0, 2, 'A1'), seg('A', 2, 4, 'A2'), seg('B', 40, 43, 'B1')];
    expect(mergeSegmentInto(lines, 2, 0)![0]).toMatchObject({ start: 0, end: 3 });
  });

  it("keeps what the dropped line was, and the target's earlier merges", () => {
    const once = mergeSegmentInto(call(), 3, 1)!;
    expect(once[1].merged).toEqual([{ speaker: 'B', start: 40, end: 43, text: 'B1' }]);
    const twice = mergeSegmentInto(once, 2, 1)!;
    expect(twice.map((s) => s.text)).toEqual(['A1', 'A2 B1 A3']);
    expect(twice[1].merged?.map((m) => m.text)).toEqual(['B1', 'A3']);
  });

  it('remembers where a moved line was transcribed, not where it was moved to', () => {
    const moved = { ...seg('A', 20, 22, 'B1'), original: { speaker: 'B', start: 40, end: 43 } };
    const merged = mergeSegmentInto([seg('A', 0, 2, 'A1'), moved, seg('A', 50, 51)], 1, 0)!;
    expect(merged[0].merged).toEqual([{ speaker: 'B', start: 40, end: 43, text: 'B1' }]);
  });

  it('joins the words, re-timing the dropped ones into the added time', () => {
    const word = (w: string, start: number, end: number) => ({
      word: w,
      start,
      end,
      probability: 0.9,
    });
    const lines = call();
    lines[1] = { ...lines[1], words: [word('A2', 3, 5)] };
    lines[3] = { ...lines[3], words: [word('B', 40, 41.5), word('1', 41.5, 43)] };
    expect(mergeSegmentInto(lines, 3, 1)![1].words).toEqual([
      word('A2', 3, 5),
      word('B', 5, 6.5),
      word('1', 6.5, 8),
    ]);
  });

  it('is doubtful if either line was', () => {
    const lines = call();
    lines[3] = { ...lines[3], low_confidence: true };
    expect(mergeSegmentInto(lines, 3, 1)![1].low_confidence).toBe(true);
    expect(mergeSegmentInto(call(), 3, 1)![1].low_confidence).toBeUndefined();
  });

  it('does nothing when dropped onto itself', () => {
    expect(mergeSegmentInto(call(), 1, 1)).toBeNull();
  });
});
