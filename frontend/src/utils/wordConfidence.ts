import type { TranscriptWord } from '../types/api';

/** Words the speech model was less than this sure of are highlighted for review. */
export const LOW_WORD_PROBABILITY = 0.5;

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * The segment's words, if they still spell its text. Once a segment is edited
 * (or split) its words no longer match, and the plain text is shown instead.
 */
export function matchingWords(
  words: TranscriptWord[] | undefined,
  text: string
): TranscriptWord[] | null {
  if (!words || words.length === 0) return null;
  return squash(words.map((w) => w.word).join('')) === squash(text) ? words : null;
}
