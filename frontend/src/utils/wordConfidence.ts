import type { TFunction } from 'i18next';
import type { TranscriptSegment, TranscriptWord } from '../types/api';

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

/** How many of the segment's words (while they still spell its text) the model was unsure of. */
export function doubtfulWordCount(segment: TranscriptSegment): number {
  const words = matchingWords(segment.words, segment.text);
  return words ? words.filter((w) => w.probability < LOW_WORD_PROBABILITY).length : 0;
}

/**
 * Why a line should be checked against the audio, or null when it need not:
 * the whole line is doubtful (the model's own signals for it), or some of
 * its words are.
 */
export function reviewHint(segment: TranscriptSegment, t: TFunction): string | null {
  if (segment.low_confidence) return t('transcript.lowConfidenceHint');
  const count = doubtfulWordCount(segment);
  return count > 0 ? t('transcript.lowConfidenceWords', { count }) : null;
}
