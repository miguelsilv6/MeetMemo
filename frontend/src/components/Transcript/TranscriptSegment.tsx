import { useRef, useEffect } from 'react';
import type { SyntheticEvent } from 'react';
import { Badge, Button } from '@govtechsg/sgds-react';
import { Pencil, Play, Plus, Scissors } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getSpeakerColor, getSpeakerBorderColor } from '../../utils/speakerColors';
import { formatTime } from '../../utils/timeFormat';
import type { TranscriptSegment as TranscriptSegmentType } from '../../types/api';

interface TranscriptSegmentProps {
  segment: TranscriptSegmentType;
  /** Text to render instead of `segment.text` (e.g. an active translation). */
  displayText?: string;
  index: number;
  handleEditText: (segment: TranscriptSegmentType, index: number) => void;
  isActive: boolean;
  onSeekToSegment: (time: number) => void;
  onInsertSegmentAfter: (index: number) => void;
  onSplitSegment: (segment: TranscriptSegmentType, index: number) => void;
}

export default function TranscriptSegment({
  segment,
  displayText,
  index,
  handleEditText,
  isActive,
  onSeekToSegment,
  onInsertSegmentAfter,
  onSplitSegment,
}: TranscriptSegmentProps) {
  const { t } = useTranslation();
  const segmentRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to active segment
  useEffect(() => {
    if (isActive && segmentRef.current) {
      // Respect user's motion preference for accessibility
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      segmentRef.current.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'nearest',
      });
    }
  }, [isActive]);

  const handlePlayFromHere = (e: SyntheticEvent) => {
    e.stopPropagation();
    if (onSeekToSegment) {
      onSeekToSegment(Number(segment.start));
    }
  };

  return (
    <div
      ref={segmentRef}
      className={`transcript-segment mb-3 p-3 border-start border-3 ${isActive ? 'transcript-segment-active' : ''}`}
      style={{ borderColor: getSpeakerBorderColor(segment.speaker) }}
      onClick={handlePlayFromHere}
      onDoubleClick={(e) => {
        e.stopPropagation();
        handleEditText(segment, index);
      }}
      title={t('transcript.editHint')}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handlePlayFromHere(e);
        }
      }}
    >
      <div className="d-flex justify-content-between align-items-center mb-2">
        <div className="d-flex align-items-center gap-2">
          <Badge
            style={{
              backgroundColor: getSpeakerColor(segment.speaker).bg,
              color: getSpeakerColor(segment.speaker).text,
            }}
          >
            {segment.speaker}
          </Badge>
          {isActive && (
            <span className="audio-playing-indicator" title={t('transcript.currentlyPlaying')}>
              <span className="audio-playing-dot"></span>
            </span>
          )}
        </div>
        <div className="d-flex gap-2 align-items-center">
          <Button
            variant="link"
            size="sm"
            className="p-0 segment-play-btn"
            onClick={handlePlayFromHere}
            title={t('transcript.playFromHere')}
            style={{ color: 'var(--primary)' }}
          >
            <Play size={14} />
          </Button>
          <small className="text-muted segment-timestamp">
            {formatTime(segment.start)} - {formatTime(segment.end)}
          </small>
          <Button
            variant="link"
            size="sm"
            className="p-0"
            onClick={(e) => {
              e.stopPropagation();
              handleEditText(segment, index);
            }}
            title={t('transcript.editThisSegment')}
            style={{ color: '#f0ad4e' }}
          >
            <Pencil size={14} />
          </Button>
          <Button
            variant="link"
            size="sm"
            className="p-0"
            onClick={(e) => {
              e.stopPropagation();
              onInsertSegmentAfter(index);
            }}
            title={t('transcript.insertSegmentAfter')}
            style={{ color: 'var(--text-secondary)' }}
          >
            <Plus size={14} />
          </Button>
          <Button
            variant="link"
            size="sm"
            className="p-0"
            onClick={(e) => {
              e.stopPropagation();
              onSplitSegment(segment, index);
            }}
            title={t('transcript.splitSegment')}
            style={{ color: 'var(--text-secondary)' }}
          >
            <Scissors size={14} />
          </Button>
        </div>
      </div>
      <p className="mb-0">{displayText ?? segment.text}</p>
    </div>
  );
}
