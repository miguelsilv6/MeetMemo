import { describe, it, expect, beforeEach } from 'vitest';
import { getSpeakerColor, getSpeakerBorderColor, initializeSpeakerColors } from './speakerColors';
import type { TranscriptSegment } from '../types/api';

const lines = (...speakers: string[]): TranscriptSegment[] =>
  speakers.map((speaker, i) => ({ speaker, start: i, end: i + 1, text: `line ${i}` }));

beforeEach(() => {
  initializeSpeakerColors([]);
});

describe('getSpeakerColor', () => {
  it('returns a color with bg and text fields', () => {
    const color = getSpeakerColor('SPEAKER_00');
    expect(color).toHaveProperty('bg');
    expect(color).toHaveProperty('text');
    expect(color.bg).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('is the same every time for the same speaker', () => {
    expect(getSpeakerColor('Alice')).toEqual(getSpeakerColor('Alice'));
  });

  it('gives a speaker it has not seen a color no one has yet', () => {
    initializeSpeakerColors(lines('Ana', 'Bruno'));
    const others = [getSpeakerColor('Ana').bg, getSpeakerColor('Bruno').bg];
    expect(others).not.toContain(getSpeakerColor('Carlos').bg);
  });

  it('falls back to the first palette color for empty labels', () => {
    initializeSpeakerColors(lines('Ana'));
    expect(getSpeakerColor(null)).toEqual(getSpeakerColor('Ana'));
    expect(getSpeakerColor(undefined)).toEqual(getSpeakerColor('Ana'));
  });
});

describe('getSpeakerBorderColor', () => {
  it('returns the background color of the mapped palette entry', () => {
    expect(getSpeakerBorderColor('SPEAKER_01')).toBe(getSpeakerColor('SPEAKER_01').bg);
  });
});

describe('initializeSpeakerColors', () => {
  it('handles missing or non-array input without throwing', () => {
    expect(() => initializeSpeakerColors(null)).not.toThrow();
    expect(() => initializeSpeakerColors(undefined)).not.toThrow();
  });

  it('gives the two speakers of a call clearly different colors (indigo and cyan)', () => {
    initializeSpeakerColors(lines('SPEAKER_00', 'SPEAKER_01', 'SPEAKER_00'));
    expect(getSpeakerColor('SPEAKER_00').bg).toBe('#3b5bdb');
    expect(getSpeakerColor('SPEAKER_01').bg).toBe('#0c8599');
  });

  it('never gives two speakers the same color, whatever their names', () => {
    // These pairs shared a color when it came from a hash of the name.
    for (const [a, b] of [
      ['Ana', 'Carlos'],
      ['Ana', 'Pedro'],
      ['Bruno', 'Maria'],
    ]) {
      initializeSpeakerColors(lines(a, b, a));
      expect(getSpeakerColor(a)).not.toEqual(getSpeakerColor(b));
    }
  });

  it('keeps each speaker its color when they are renamed', () => {
    initializeSpeakerColors(lines('SPEAKER_00', 'SPEAKER_01', 'SPEAKER_00'));
    const before = [getSpeakerColor('SPEAKER_00'), getSpeakerColor('SPEAKER_01')];
    initializeSpeakerColors(lines('Ana', 'Pedro', 'Ana'));
    expect([getSpeakerColor('Ana'), getSpeakerColor('Pedro')]).toEqual(before);
  });

  it('gives eight speakers eight different colors, and only then repeats', () => {
    const speakers = Array.from({ length: 9 }, (_, i) => `Speaker ${i}`);
    initializeSpeakerColors(lines(...speakers));
    const colors = speakers.map((s) => getSpeakerColor(s).bg);
    expect(new Set(colors.slice(0, 8)).size).toBe(8);
    expect(colors[8]).toBe(colors[0]);
  });
});
