import { useTranslation } from 'react-i18next';
import type { TranscriptSegment } from '../../types/api';
import { LOW_WORD_PROBABILITY, matchingWords } from '../../utils/wordConfidence';

/**
 * The segment's text, with the words the speech model was unsure of
 * underlined (their confidence in a tooltip) so a reviewer checks them
 * against the audio.
 */
export default function SegmentText({ segment }: { segment: TranscriptSegment }) {
  const { t } = useTranslation();
  const words = matchingWords(segment.words, segment.text);
  if (!words) return <>{segment.text}</>;
  return (
    <>
      {words.map((word, i) => {
        const text = i === 0 ? word.word.trimStart() : word.word;
        if (word.probability >= LOW_WORD_PROBABILITY) return text;
        const leading = text.match(/^\s*/)?.[0] ?? '';
        return (
          <span key={i}>
            {leading}
            <span
              className="low-confidence-word"
              title={t('transcript.wordConfidence', {
                percent: Math.round(word.probability * 100),
              })}
            >
              {text.slice(leading.length)}
            </span>
          </span>
        );
      })}
    </>
  );
}
