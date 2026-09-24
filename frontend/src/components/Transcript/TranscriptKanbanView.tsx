import { useMemo, useState } from 'react';
import type { SyntheticEvent } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { Badge, Button, Form } from '@govtechsg/sgds-react';
import { AlertTriangle, Pencil, Play, Plus, Scissors, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getSpeakerColor, getSpeakerBorderColor } from '../../utils/speakerColors';
import { formatTime } from '../../utils/timeFormat';
import {
  buildKanbanTimeline,
  resolveColumnOverlap,
  KANBAN_MIN_BUBBLE_HEIGHT_PX,
} from '../../utils/kanbanTimeline';
import type { SilenceGap } from '../../utils/kanbanTimeline';
import RemoveSpeakerModal from '../Modals/RemoveSpeakerModal';
import type { TranscriptSegment as TranscriptSegmentType } from '../../types/api';

interface IndexedSegment {
  segment: TranscriptSegmentType;
  index: number;
}

interface TranscriptKanbanViewProps {
  segments: TranscriptSegmentType[];
  /** Translated text to render instead of each segment's original text, by index. */
  displayTextByIndex?: string[];
  activeSegmentIndex: number;
  handleEditText: (segment: TranscriptSegmentType, index: number) => void;
  onSeekToSegment: (time: number) => void;
  onMoveSegmentSpeaker: (index: number, newSpeaker: string) => void;
  onBulkMoveSegments: (indices: number[], newSpeaker: string) => void;
  onDeleteSegments: (indices: number[]) => void;
  onInsertSegmentAfter: (index: number) => void;
  onSplitSegment: (segment: TranscriptSegmentType, index: number) => void;
  /** When true, bubbles render as checkbox rows for bulk actions instead of their normal controls/drag handle. */
  selectMode?: boolean;
  selectedIndices?: Set<number>;
  onToggleSelect?: (index: number) => void;
}

/** A single draggable chat bubble inside a Kanban column. */
function KanbanBubble({
  indexed,
  displayText,
  isActive,
  speakers,
  handleEditText,
  onSeekToSegment,
  onMoveSegmentSpeaker,
  onInsertSegmentAfter,
  onSplitSegment,
  selectMode,
  isSelected,
  onToggleSelect,
}: {
  indexed: IndexedSegment;
  displayText?: string;
  isActive: boolean;
  speakers: string[];
  handleEditText: (segment: TranscriptSegmentType, index: number) => void;
  onSeekToSegment: (time: number) => void;
  onMoveSegmentSpeaker: (index: number, newSpeaker: string) => void;
  onInsertSegmentAfter: (index: number) => void;
  onSplitSegment: (segment: TranscriptSegmentType, index: number) => void;
  selectMode: boolean;
  isSelected: boolean;
  onToggleSelect?: (index: number) => void;
}) {
  const { t } = useTranslation();
  const { segment, index } = indexed;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: String(index),
    data: { index, speaker: segment.speaker },
    disabled: selectMode,
  });

  const handlePlayFromHere = (e: SyntheticEvent) => {
    e.stopPropagation();
    onSeekToSegment(Number(segment.start));
  };

  const handleClick = selectMode ? () => onToggleSelect?.(index) : handlePlayFromHere;

  return (
    <div
      ref={setNodeRef}
      {...(selectMode ? {} : listeners)}
      {...(selectMode ? {} : attributes)}
      className={`kanban-bubble p-2 ${isActive ? 'kanban-bubble-active' : ''} ${
        isDragging ? 'kanban-bubble-dragging' : ''
      } ${selectMode ? 'kanban-bubble-selectable' : ''} ${isSelected ? 'kanban-bubble-selected' : ''}`}
      style={{ borderColor: getSpeakerBorderColor(segment.speaker) }}
      onClick={handleClick}
      onDoubleClick={
        selectMode
          ? undefined
          : (e) => {
              e.stopPropagation();
              handleEditText(segment, index);
            }
      }
      title={selectMode ? undefined : t('transcript.editHint')}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleClick(e);
      }}
    >
      <div className="d-flex justify-content-between align-items-center mb-1">
        <div className="d-flex align-items-center gap-1">
          {selectMode && (
            <Form.Check
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect?.(index)}
              onClick={(e) => e.stopPropagation()}
              aria-label={t('transcript.selectSegment')}
            />
          )}
          <small className="text-muted kanban-bubble-timestamp">
            {formatTime(segment.start)} - {formatTime(segment.end)}
          </small>
          {segment.low_confidence && (
            <span
              className="d-inline-flex text-warning"
              role="img"
              title={t('transcript.lowConfidenceHint')}
              aria-label={t('transcript.lowConfidenceHint')}
            >
              <AlertTriangle size={12} />
            </span>
          )}
        </div>
        {!selectMode && (
          <div className="d-flex gap-1">
            <Button
              variant="link"
              size="sm"
              className="p-0 kanban-bubble-action"
              onClick={handlePlayFromHere}
              title={t('transcript.playFromHere')}
              style={{ color: 'var(--primary)' }}
            >
              <Play size={12} />
            </Button>
            <Button
              variant="link"
              size="sm"
              className="p-0 kanban-bubble-action"
              onClick={(e) => {
                e.stopPropagation();
                handleEditText(segment, index);
              }}
              title={t('transcript.editThisSegment')}
              style={{ color: '#f0ad4e' }}
            >
              <Pencil size={12} />
            </Button>
            <Button
              variant="link"
              size="sm"
              className="p-0 kanban-bubble-action"
              onClick={(e) => {
                e.stopPropagation();
                onInsertSegmentAfter(index);
              }}
              title={t('transcript.insertSegmentAfter')}
              style={{ color: 'var(--text-secondary)' }}
            >
              <Plus size={12} />
            </Button>
            <Button
              variant="link"
              size="sm"
              className="p-0 kanban-bubble-action"
              onClick={(e) => {
                e.stopPropagation();
                onSplitSegment(segment, index);
              }}
              title={t('transcript.splitSegment')}
              style={{ color: 'var(--text-secondary)' }}
            >
              <Scissors size={12} />
            </Button>
          </div>
        )}
      </div>
      <p className="mb-0 small">{displayText ?? segment.text}</p>
      {!selectMode && speakers.length > 1 && (
        <select
          className="form-select form-select-sm kanban-bubble-speaker-select kanban-bubble-action mt-1"
          aria-label={t('kanban.moveToSpeaker')}
          title={t('kanban.moveToSpeakerHint')}
          value={segment.speaker}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const newSpeaker = e.target.value;
            if (newSpeaker !== segment.speaker) {
              onMoveSegmentSpeaker(index, newSpeaker);
            }
          }}
        >
          {speakers.map((speaker) => (
            <option key={speaker} value={speaker}>
              {speaker}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** A speaker column that segments can be dropped into to reassign the speaker. */
function KanbanColumn({
  speaker,
  bubbles,
  tops,
  columnHeight,
  silences,
  displayTextByIndex,
  activeSegmentIndex,
  speakers,
  handleEditText,
  onSeekToSegment,
  onMoveSegmentSpeaker,
  onRequestRemoveSpeaker,
  onInsertSegmentAfter,
  onSplitSegment,
  selectMode,
  selectedIndices,
  onToggleSelect,
}: {
  speaker: string;
  bubbles: IndexedSegment[];
  /** Resolved top offset (px) for each bubble, aligned by index with `bubbles`, on the timeline shared by every column. */
  tops: number[];
  /** Shared height (px) applied to every column, so they all span the same timeline extent. */
  columnHeight: number;
  /** Real conversation-wide silences (nobody speaking), positioned on the same shared timeline. */
  silences: SilenceGap[];
  displayTextByIndex?: string[];
  activeSegmentIndex: number;
  speakers: string[];
  handleEditText: (segment: TranscriptSegmentType, index: number) => void;
  onSeekToSegment: (time: number) => void;
  onMoveSegmentSpeaker: (index: number, newSpeaker: string) => void;
  onRequestRemoveSpeaker: (speaker: string) => void;
  onInsertSegmentAfter: (index: number) => void;
  onSplitSegment: (segment: TranscriptSegmentType, index: number) => void;
  selectMode: boolean;
  selectedIndices: Set<number>;
  onToggleSelect?: (index: number) => void;
}) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: speaker });
  const color = getSpeakerColor(speaker);

  return (
    <div
      ref={setNodeRef}
      className={`kanban-column ${isOver ? 'kanban-column-over' : ''}`}
      style={{ borderTopColor: color.bg }}
    >
      <div className="kanban-column-header d-flex align-items-center justify-content-between">
        <Badge
          title={speaker}
          className="text-truncate"
          style={{ backgroundColor: color.bg, color: color.text, maxWidth: '100%' }}
        >
          {speaker}
        </Badge>
        <div className="d-flex align-items-center gap-1">
          <small className="text-muted">{bubbles.length}</small>
          {!selectMode && (
            <Button
              variant="link"
              size="sm"
              className="p-0 kanban-column-remove-btn"
              onClick={() => onRequestRemoveSpeaker(speaker)}
              title={t('kanban.removeSpeaker', { speaker })}
              style={{ color: 'var(--mm-danger, #dc3545)' }}
            >
              <X size={16} />
            </Button>
          )}
        </div>
      </div>
      <div
        className="kanban-column-body"
        style={bubbles.length > 0 ? { position: 'relative', height: columnHeight } : undefined}
      >
        {bubbles.length === 0 ? (
          <p className="text-muted small text-center py-4 mb-0">{t('kanban.dropHere')}</p>
        ) : (
          <>
            {silences.map((silence, i) => (
              <div
                key={i}
                className="kanban-gap-label text-muted small text-center d-flex align-items-center justify-content-center"
                style={{
                  position: 'absolute',
                  top: silence.topPx,
                  left: 0,
                  right: 0,
                  height: silence.heightPx,
                }}
              >
                {t('kanban.silenceGap', { duration: formatTime(silence.durationSeconds) })}
              </div>
            ))}
            {bubbles.map((indexed, i) => (
              <div
                key={indexed.index}
                style={{ position: 'absolute', top: tops[i], left: 0, right: 0 }}
              >
                <KanbanBubble
                  indexed={indexed}
                  displayText={displayTextByIndex?.[indexed.index]}
                  isActive={indexed.index === activeSegmentIndex}
                  speakers={speakers}
                  handleEditText={handleEditText}
                  onSeekToSegment={onSeekToSegment}
                  onMoveSegmentSpeaker={onMoveSegmentSpeaker}
                  onInsertSegmentAfter={onInsertSegmentAfter}
                  onSplitSegment={onSplitSegment}
                  selectMode={selectMode}
                  isSelected={selectedIndices.has(indexed.index)}
                  onToggleSelect={onToggleSelect}
                />
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/** Trailing card that lets the user add a new, initially empty, speaker column. */
function AddSpeakerColumn({ onAdd }: { onAdd: (name: string) => void }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');

  const commit = () => {
    const trimmed = name.trim();
    if (trimmed) onAdd(trimmed);
    setName('');
    setEditing(false);
  };

  if (!editing) {
    return (
      <button type="button" className="kanban-add-column" onClick={() => setEditing(true)}>
        <Plus size={16} className="me-1" />
        {t('kanban.addSpeaker')}
      </button>
    );
  }

  return (
    <div className="kanban-add-column kanban-add-column-editing">
      <Form.Control
        autoFocus
        size="sm"
        placeholder={t('kanban.speakerNamePlaceholder')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setName('');
            setEditing(false);
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}

/**
 * Kanban-style transcript view: one column per speaker, bubbles ordered by
 * timestamp within each column. Dragging a bubble to another column reassigns
 * that segment's speaker, so misattributed lines can be corrected in place.
 * Speakers can also be added (an empty column to drag/move lines into) or
 * removed (moving or deleting their lines first).
 */
export default function TranscriptKanbanView({
  segments,
  displayTextByIndex,
  activeSegmentIndex,
  handleEditText,
  onSeekToSegment,
  onMoveSegmentSpeaker,
  onBulkMoveSegments,
  onDeleteSegments,
  onInsertSegmentAfter,
  onSplitSegment,
  selectMode = false,
  selectedIndices = new Set<number>(),
  onToggleSelect,
}: TranscriptKanbanViewProps) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  // Speakers added via "Add speaker" that have no segments yet. Purely a UI
  // placeholder — there is nothing to persist until a segment actually moves
  // into one, so this does not survive a reload.
  const [extraSpeakers, setExtraSpeakers] = useState<string[]>([]);
  const [removingSpeaker, setRemovingSpeaker] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Require a small drag distance before activating, so a plain click
      // (play-from-here / edit) is never swallowed as a drag gesture.
      activationConstraint: { distance: 8 },
    })
  );

  const dataSpeakers = useMemo(() => [...new Set(segments.map((s) => s.speaker))], [segments]);
  const speakers = useMemo(
    () => [...dataSpeakers, ...extraSpeakers.filter((s) => !dataSpeakers.includes(s))],
    [dataSpeakers, extraSpeakers]
  );

  const columns = useMemo(() => {
    const bySpeaker = new Map<string, IndexedSegment[]>();
    speakers.forEach((speaker) => bySpeaker.set(speaker, []));
    segments.forEach((segment, index) => {
      bySpeaker.get(segment.speaker)?.push({ segment, index });
    });
    return bySpeaker;
  }, [segments, speakers]);

  // One time-to-pixel mapping shared by every column, so a bubble's vertical
  // position reflects its real audio timestamp regardless of speaker.
  const timeline = useMemo(() => buildKanbanTimeline(segments), [segments]);

  const columnTops = useMemo(() => {
    const layouts = new Map<string, number[]>();
    columns.forEach((bubbles, speaker) => {
      const naturalTops = bubbles.map((b) => timeline.toY(Number(b.segment.start)));
      layouts.set(speaker, resolveColumnOverlap(naturalTops));
    });
    return layouts;
  }, [columns, timeline]);

  // Every column shares the same height, so a column with fewer/shorter
  // bubbles doesn't just end early — the shared timeline stays consistent.
  const boardHeight = useMemo(() => {
    let max = timeline.totalHeight;
    columnTops.forEach((tops) => {
      if (tops.length > 0) {
        max = Math.max(max, tops[tops.length - 1] + KANBAN_MIN_BUBBLE_HEIGHT_PX);
      }
    });
    return max;
  }, [columnTops, timeline]);

  const draggingSegment = draggingIndex !== null ? segments[draggingIndex] : null;

  const handleDragStart = (event: DragStartEvent) => {
    setDraggingIndex(Number(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingIndex(null);
    const { active, over } = event;
    if (!over) return;

    const index = Number(active.id);
    const targetSpeaker = String(over.id);
    const sourceSpeaker = active.data.current?.speaker;

    if (targetSpeaker && targetSpeaker !== sourceSpeaker) {
      onMoveSegmentSpeaker(index, targetSpeaker);
    }
  };

  const handleAddSpeaker = (name: string) => {
    const alreadyExists = speakers.some((s) => s.toLowerCase() === name.toLowerCase());
    if (alreadyExists) return;
    setExtraSpeakers((prev) => [...prev, name]);
  };

  const removingBubbles = removingSpeaker ? (columns.get(removingSpeaker) ?? []) : [];
  const removingIndices = removingBubbles.map((b) => b.index);
  const otherSpeakers = removingSpeaker ? speakers.filter((s) => s !== removingSpeaker) : [];

  const closeRemoveModal = () => setRemovingSpeaker(null);

  const handleRequestRemoveSpeaker = (speaker: string) => {
    const bubbles = columns.get(speaker) ?? [];
    if (bubbles.length === 0) {
      // Nothing to lose — just drop the empty placeholder column.
      setExtraSpeakers((prev) => prev.filter((s) => s !== speaker));
      return;
    }
    setRemovingSpeaker(speaker);
  };

  if (segments.length === 0) {
    return null;
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDraggingIndex(null)}
      >
        <div className="kanban-board">
          {speakers.map((speaker) => (
            <KanbanColumn
              key={speaker}
              speaker={speaker}
              bubbles={columns.get(speaker) ?? []}
              tops={columnTops.get(speaker) ?? []}
              columnHeight={boardHeight}
              silences={timeline.silences}
              displayTextByIndex={displayTextByIndex}
              activeSegmentIndex={activeSegmentIndex}
              speakers={speakers}
              handleEditText={handleEditText}
              onSeekToSegment={onSeekToSegment}
              onMoveSegmentSpeaker={onMoveSegmentSpeaker}
              onRequestRemoveSpeaker={handleRequestRemoveSpeaker}
              onInsertSegmentAfter={onInsertSegmentAfter}
              onSplitSegment={onSplitSegment}
              selectMode={selectMode}
              selectedIndices={selectedIndices}
              onToggleSelect={onToggleSelect}
            />
          ))}
          {!selectMode && <AddSpeakerColumn onAdd={handleAddSpeaker} />}
        </div>
        <DragOverlay>
          {draggingSegment ? (
            <div
              className="kanban-bubble kanban-bubble-overlay p-2"
              style={{ borderColor: getSpeakerBorderColor(draggingSegment.speaker) }}
            >
              <p className="mb-0 small">
                {(draggingIndex !== null && displayTextByIndex?.[draggingIndex]) ??
                  draggingSegment.text}
              </p>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <RemoveSpeakerModal
        key={removingSpeaker ?? 'none'}
        show={removingSpeaker !== null}
        onHide={closeRemoveModal}
        speaker={removingSpeaker}
        segmentCount={removingIndices.length}
        otherSpeakers={otherSpeakers}
        onMove={(targetSpeaker) => {
          onBulkMoveSegments(removingIndices, targetSpeaker);
          closeRemoveModal();
        }}
        onDelete={() => {
          onDeleteSegments(removingIndices);
          closeRemoveModal();
        }}
      />
    </>
  );
}
