import { describe, it, expect } from 'vitest';
import i18n from '../i18n';
import { doubtfulWordCount, reviewHint } from './wordConfidence';
import type { TranscriptSegment } from '../types/api';

const t = i18n.t.bind(i18n);
const word = (text: string, probability: number) => ({ start: 0, end: 1, word: text, probability });
const line = (extra: Partial<TranscriptSegment> = {}): TranscriptSegment => ({
  speaker: 'SPEAKER_00',
  start: 0,
  end: 2,
  text: 'Hello there friend',
  words: [word(' Hello', 0.9), word(' there', 0.37), word(' friend', 0.42)],
  ...extra,
});

describe('doubtfulWordCount', () => {
  it('counts the words below the threshold while they spell the text', () => {
    expect(doubtfulWordCount(line())).toBe(2);
    expect(doubtfulWordCount(line({ text: 'Hello there pal' }))).toBe(0); // edited
    expect(doubtfulWordCount(line({ words: undefined }))).toBe(0);
  });
});

describe('reviewHint', () => {
  it('says why a line should be checked, or nothing', () => {
    expect(reviewHint(line(), t)).toBe('2 words with low confidence: check them against the audio');
    expect(reviewHint(line({ words: [word(' Hello there friend', 0.3)] }), t)).toBe(
      '1 word with low confidence: check it against the audio'
    );
    expect(reviewHint(line({ low_confidence: true }), t)).toBe(
      'Low confidence: check this line against the audio'
    );
    expect(reviewHint(line({ words: [word(' Hello there friend', 0.9)] }), t)).toBeNull();
    expect(reviewHint(line({ text: 'edited' }), t)).toBeNull();
  });
});
