import { Button } from '@govtechsg/sgds-react';
import { useTranslation } from 'react-i18next';
import { formatTime } from '../../utils/timeFormat';
import type { TranscriptSegment } from '../../types/api';

/**
 * The times a moved line was transcribed at, where the audio still has it.
 * Clicking plays it from there. Nothing is shown for a line never moved.
 */
export default function OriginalTimes({
  segment,
  onSeekToSegment,
}: {
  segment: TranscriptSegment;
  onSeekToSegment: (time: number) => void;
}) {
  const { t } = useTranslation();
  if (!segment.original) return null;
  const { start, end } = segment.original;

  return (
    <Button
      variant="link"
      size="sm"
      className="p-0 segment-original-times"
      onClick={(e) => {
        e.stopPropagation();
        onSeekToSegment(start);
      }}
      title={t('transcript.originalTimesHint')}
    >
      <small>
        {t('transcript.originalTimes', { start: formatTime(start), end: formatTime(end) })}
      </small>
    </Button>
  );
}
