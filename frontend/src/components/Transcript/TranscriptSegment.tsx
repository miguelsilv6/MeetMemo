import { useRef, useEffect, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { Badge, Button, Form } from '@govtechsg/sgds-react';
import { AlertTriangle, Pencil, Play, Plus, Scissors, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getSpeakerColor, getSpeakerBorderColor } from '../../utils/speakerColors';
import { formatTime } from '../../utils/timeFormat';
import type { TranscriptSegment as TranscriptSegmentType } from '../../types/api';
import { reviewHint } from '../../utils/wordConfidence';
import SegmentText from './SegmentText';
import OriginalTimes from './OriginalTimes';
import InlineTextEditor from './InlineTextEditor';

interface TranscriptSegmentProps {
  segment: TranscriptSegmentType;
  /** Text to render instead of `segment.text` (e.g. an active translation). */
  displayText?: string;
  index: number;
  /** Opens the full editor (text, times and speaker): the pencil button. */
  handleEditText: (segment: TranscriptSegmentType, index: number) => void;
  /** Saves a new text edited right in the bubble (double click); without it, a double click opens the full editor. */
  onUpdateText?: (index: number, text: string) => void;
  isActive: boolean;
  onSeekToSegment: (time: number) => void;
  onInsertSegmentAfter: (index: number) => void;
  onSplitSegment: (segment: TranscriptSegmentType, index: number) => void;
  /** Asks to delete this segment; the caller confirms before deleting. */
  onDeleteSegment?: (index: number) => void;
  /** When true, the segment renders as a checkbox row for bulk actions instead of its normal controls. */
  selectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (index: number) => void;
}

export default function TranscriptSegment({
  segment,
  displayText,
  index,
  handleEditText,
  onUpdateText,
  isActive,
  onSeekToSegment,
  onInsertSegmentAfter,
  onSplitSegment,
  onDeleteSegment,
  selectMode = false,
  isSelected = false,
  onToggleSelect,
}: TranscriptSegmentProps) {
  const { t } = useTranslation();
  const segmentRef = useRef<HTMLDivElement | null>(null);
  // The whole line, or some of its words, to check against the audio.
  const review = reviewHint(segment, t);
  const [editingText, setEditingText] = useState(false);

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

  const handleClick = selectMode ? () => onToggleSelect?.(index) : handlePlayFromHere;

  return (
    <div
      ref={segmentRef}
      className={`transcript-segment mb-3 p-3 border-start border-3 ${isActive ? 'transcript-segment-active' : ''} ${selectMode ? 'transcript-segment-selectable' : ''} ${isSelected ? 'transcript-segment-selected' : ''} ${review ? 'transcript-segment-low-confidence' : ''}`}
      style={{ borderColor: getSpeakerBorderColor(segment.speaker) }}
      onClick={handleClick}
      onDoubleClick={
        selectMode
          ? undefined
          : (e) => {
              e.stopPropagation();
              if (onUpdateText) setEditingText(true);
              else handleEditText(segment, index);
            }
      }
      title={selectMode || editingText ? undefined : t('transcript.editHint')}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleClick(e);
        }
      }}
    >
      <div className="d-flex justify-content-between align-items-center mb-2">
        <div className="d-flex align-items-center gap-2">
          {selectMode && (
            <Form.Check
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect?.(index)}
              onClick={(e) => e.stopPropagation()}
              aria-label={t('transcript.selectSegment')}
            />
          )}
          <Badge
            style={{
              backgroundColor: getSpeakerColor(segment.speaker).bg,
              color: getSpeakerColor(segment.speaker).text,
            }}
          >
            {segment.speaker}
          </Badge>
          {review && (
            <Badge bg="warning" title={review}>
              <AlertTriangle size={12} className="me-1" />
              {t('transcript.lowConfidence')}
            </Badge>
          )}
          {isActive && (
            <span className="audio-playing-indicator" title={t('transcript.currentlyPlaying')}>
              <span className="audio-playing-dot"></span>
            </span>
          )}
        </div>
        {!selectMode && (
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
            <OriginalTimes segment={segment} onSeekToSegment={onSeekToSegment} />
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
            {onDeleteSegment && (
              <Button
                variant="link"
                size="sm"
                className="p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteSegment(index);
                }}
                title={t('transcript.deleteSegment')}
                style={{ color: 'var(--mm-danger, #dc3545)' }}
              >
                <Trash2 size={14} />
              </Button>
            )}
          </div>
        )}
      </div>
      {editingText && onUpdateText ? (
        <InlineTextEditor
          text={segment.text}
          onSave={(text) => {
            setEditingText(false);
            onUpdateText(index, text);
          }}
          onCancel={() => setEditingText(false)}
        />
      ) : (
        <p className="mb-0">{displayText ?? <SegmentText segment={segment} />}</p>
      )}
    </div>
  );
}
