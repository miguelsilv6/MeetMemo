import { Button } from '@govtechsg/sgds-react';
import { useTranslation } from 'react-i18next';
import { formatTime } from '../../utils/timeFormat';
import type { TranscriptSegment } from '../../types/api';

/**
 * The times a moved line was transcribed at, where the audio still has it,
 * and each line merged into it, at the times it was transcribed. Clicking one
 * plays it from there. Nothing is shown for a line never moved or merged into.
 */
export default function OriginalTimes({
  segment,
  onSeekToSegment,
}: {
  segment: TranscriptSegment;
  onSeekToSegment: (time: number) => void;
}) {
  const { t } = useTranslation();
  const times = [
    ...(segment.original
      ? [
          {
            key: 'original',
            ...segment.original,
            label: 'transcript.originalTimes',
            hint: 'transcript.originalTimesHint',
            text: undefined as string | undefined,
          },
        ]
      : []),
    ...(segment.merged ?? []).map((line, i) => ({
      key: `merged-${i}`,
      ...line,
      label: 'transcript.mergedFrom',
      hint: 'transcript.mergedFromHint',
    })),
  ];
  if (times.length === 0) return null;

  return (
    <>
      {times.map(({ key, start, end, label, hint, text }) => (
        <Button
          key={key}
          variant="link"
          size="sm"
          className="p-0 segment-original-times"
          onClick={(e) => {
            e.stopPropagation();
            onSeekToSegment(start);
          }}
          title={text ? `${t(hint)}\n“${text}”` : t(hint)}
        >
          <small>{t(label, { start: formatTime(start), end: formatTime(end) })}</small>
        </Button>
      ))}
    </>
  );
}
