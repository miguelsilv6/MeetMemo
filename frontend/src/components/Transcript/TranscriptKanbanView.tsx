import { useMemo, useState } from 'react';
import type { CSSProperties, SyntheticEvent } from 'react';
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
import { AlertTriangle, Pencil, Play, Plus, Scissors, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getSpeakerColor } from '../../utils/speakerColors';
import { formatTime } from '../../utils/timeFormat';
import { buildKanbanRows } from '../../utils/kanbanRows';
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
  /** Asks to delete one segment; the caller confirms before deleting. */
  onRequestDeleteSegment?: (index: number) => void;
  /** When true, bubbles render as checkbox rows for bulk actions instead of their normal controls/drag handle. */
  selectMode?: boolean;
  selectedIndices?: Set<number>;
  onToggleSelect?: (index: number) => void;
}

const MIN_COLUMN_WIDTH_PX = 220;
const ADD_COLUMN_WIDTH_PX = 200;
// Grid row 1 holds the sticky column headers; transcript rows start at 2.
const FIRST_CONTENT_ROW = 2;

/** A single draggable speech bubble, with its time and actions underneath. */
function KanbanBubble({
  indexed,
  displayText,
  isActive,
  handleEditText,
  onSeekToSegment,
  onInsertSegmentAfter,
  onSplitSegment,
  onRequestDeleteSegment,
  selectMode,
  isSelected,
  onToggleSelect,
}: {
  indexed: IndexedSegment;
  displayText?: string;
  isActive: boolean;
  handleEditText: (segment: TranscriptSegmentType, index: number) => void;
  onSeekToSegment: (time: number) => void;
  onInsertSegmentAfter: (index: number) => void;
  onSplitSegment: (segment: TranscriptSegmentType, index: number) => void;
  onRequestDeleteSegment?: (index: number) => void;
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
      className={`kanban-bubble ${isActive ? 'kanban-bubble-active' : ''} ${
        isDragging ? 'kanban-bubble-dragging' : ''
      } ${selectMode ? 'kanban-bubble-selectable' : ''} ${isSelected ? 'kanban-bubble-selected' : ''}`}
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
      <div className="kanban-bubble-text">
        <p className="mb-0">{displayText ?? segment.text}</p>
      </div>
      <div className="kanban-bubble-meta d-flex flex-wrap align-items-center gap-1">
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
        {!selectMode && (
          <>
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
            {onRequestDeleteSegment && (
              <Button
                variant="link"
                size="sm"
                className="p-0 kanban-bubble-action"
                onClick={(e) => {
                  e.stopPropagation();
                  onRequestDeleteSegment(index);
                }}
                title={t('transcript.deleteSegment')}
                style={{ color: 'var(--mm-danger, #dc3545)' }}
              >
                <Trash2 size={12} />
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Sticky header cell naming a speaker column, with its bubble count and remove action. */
function KanbanColumnHeader({
  speaker,
  count,
  selectMode,
  onRequestRemoveSpeaker,
  style,
}: {
  speaker: string;
  count: number;
  selectMode: boolean;
  onRequestRemoveSpeaker: (speaker: string) => void;
  style: CSSProperties;
}) {
  const { t } = useTranslation();
  const color = getSpeakerColor(speaker);

  return (
    <div
      className="kanban-column-header d-flex align-items-center justify-content-between"
      style={{ ...style, borderBottomColor: color.bg }}
    >
      <Badge
        title={speaker}
        className="text-truncate"
        style={{ backgroundColor: color.bg, color: color.text, maxWidth: '100%' }}
      >
        {speaker}
      </Badge>
      <div className="d-flex align-items-center gap-1">
        <small className="text-muted">{count}</small>
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
  );
}

/**
 * A speaker column's full-height background, which is also its drop target:
 * dragging a bubble anywhere over it reassigns the segment to that speaker.
 */
function KanbanColumnDropZone({
  speaker,
  isFirst,
  isEmpty,
  style,
}: {
  speaker: string;
  isFirst: boolean;
  isEmpty: boolean;
  style: CSSProperties;
}) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: speaker });

  return (
    <div
      ref={setNodeRef}
      className={`kanban-column ${isFirst ? 'kanban-column-first' : ''} ${
        isOver ? 'kanban-column-over' : ''
      }`}
      style={style}
    >
      {isEmpty && (
        <p className="kanban-column-empty text-muted small mb-0">{t('kanban.dropHere')}</p>
      )}
    </div>
  );
}

/** Header cell that lets the user add a new, initially empty, speaker column. */
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
 * Kanban-style transcript view: one column per speaker, and one row per
 * segment in chronological order, so the conversation reads top to bottom
 * across columns and no two lines ever sit side by side. Dragging a bubble
 * to another column reassigns that segment's speaker. Speakers can also be
 * added (an empty column to drag/move lines into) or removed (moving or
 * deleting their lines first).
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
  onRequestDeleteSegment,
  selectMode = false,
  selectedIndices = new Set<number>(),
  onToggleSelect,
}: TranscriptKanbanViewProps) {
  const { t } = useTranslation();
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

  const rows = useMemo(() => buildKanbanRows(segments), [segments]);

  // Columns in order of who speaks first, so the conversation starts on the left.
  const dataSpeakers = useMemo(
    () => [
      ...new Set(
        rows.flatMap((row) => (row.kind === 'segment' ? [segments[row.index].speaker] : []))
      ),
    ],
    [rows, segments]
  );
  const speakers = useMemo(
    () => [...dataSpeakers, ...extraSpeakers.filter((s) => !dataSpeakers.includes(s))],
    [dataSpeakers, extraSpeakers]
  );

  const segmentCountBySpeaker = useMemo(() => {
    const counts = new Map<string, number>();
    segments.forEach((s) => counts.set(s.speaker, (counts.get(s.speaker) ?? 0) + 1));
    return counts;
  }, [segments]);

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

  const removingIndices = removingSpeaker
    ? segments.flatMap((s, index) => (s.speaker === removingSpeaker ? [index] : []))
    : [];
  const otherSpeakers = removingSpeaker ? speakers.filter((s) => s !== removingSpeaker) : [];

  const closeRemoveModal = () => setRemovingSpeaker(null);

  const handleRequestRemoveSpeaker = (speaker: string) => {
    if ((segmentCountBySpeaker.get(speaker) ?? 0) === 0) {
      // Nothing to lose — just drop the empty placeholder column.
      setExtraSpeakers((prev) => prev.filter((s) => s !== speaker));
      return;
    }
    setRemovingSpeaker(speaker);
  };

  if (segments.length === 0) {
    return null;
  }

  const contentRowSpan = `${FIRST_CONTENT_ROW} / span ${Math.max(rows.length, 1)}`;
  const gridTemplateColumns =
    `repeat(${speakers.length}, minmax(${MIN_COLUMN_WIDTH_PX}px, 1fr))` +
    (selectMode ? '' : ` ${ADD_COLUMN_WIDTH_PX}px`);

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDraggingIndex(null)}
      >
        <div className="kanban-board" style={{ gridTemplateColumns }}>
          {speakers.map((speaker, column) => (
            <KanbanColumnHeader
              key={`header-${speaker}`}
              speaker={speaker}
              count={segmentCountBySpeaker.get(speaker) ?? 0}
              selectMode={selectMode}
              onRequestRemoveSpeaker={handleRequestRemoveSpeaker}
              style={{ gridColumn: column + 1, gridRow: 1 }}
            />
          ))}
          {!selectMode && (
            <div
              className="kanban-column-header kanban-add-column-cell"
              style={{ gridColumn: speakers.length + 1, gridRow: 1 }}
            >
              <AddSpeakerColumn onAdd={handleAddSpeaker} />
            </div>
          )}

          {speakers.map((speaker, column) => (
            <KanbanColumnDropZone
              key={`zone-${speaker}`}
              speaker={speaker}
              isFirst={column === 0}
              isEmpty={(segmentCountBySpeaker.get(speaker) ?? 0) === 0}
              style={{ gridColumn: column + 1, gridRow: contentRowSpan }}
            />
          ))}

          {rows.map((row, position) => {
            const gridRow = FIRST_CONTENT_ROW + position;
            if (row.kind === 'silence') {
              return (
                <div
                  key={`silence-${position}`}
                  className="kanban-gap-label text-muted"
                  style={{ gridColumn: `1 / span ${speakers.length}`, gridRow }}
                >
                  {t('kanban.silenceGap', { duration: formatTime(row.durationSeconds) })}
                </div>
              );
            }
            const segment = segments[row.index];
            return (
              <div
                key={row.index}
                className="kanban-cell"
                style={{ gridColumn: speakers.indexOf(segment.speaker) + 1, gridRow }}
              >
                <KanbanBubble
                  indexed={{ segment, index: row.index }}
                  displayText={displayTextByIndex?.[row.index]}
                  isActive={row.index === activeSegmentIndex}
                  handleEditText={handleEditText}
                  onSeekToSegment={onSeekToSegment}
                  onInsertSegmentAfter={onInsertSegmentAfter}
                  onSplitSegment={onSplitSegment}
                  onRequestDeleteSegment={onRequestDeleteSegment}
                  selectMode={selectMode}
                  isSelected={selectedIndices.has(row.index)}
                  onToggleSelect={onToggleSelect}
                />
              </div>
            );
          })}
        </div>
        <DragOverlay>
          {draggingSegment ? (
            <div className="kanban-bubble kanban-bubble-overlay">
              <div className="kanban-bubble-text">
                <p className="mb-0">
                  {(draggingIndex !== null && displayTextByIndex?.[draggingIndex]) ??
                    draggingSegment.text}
                </p>
              </div>
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
