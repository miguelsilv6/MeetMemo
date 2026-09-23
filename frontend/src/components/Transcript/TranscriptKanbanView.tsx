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
import { Badge, Button } from '@govtechsg/sgds-react';
import { Pencil, Play } from 'lucide-react';
import { getSpeakerColor, getSpeakerBorderColor } from '../../utils/speakerColors';
import { formatTime } from '../../utils/timeFormat';
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
}

/** A single draggable chat bubble inside a Kanban column. */
function KanbanBubble({
  indexed,
  displayText,
  isActive,
  handleEditText,
  onSeekToSegment,
}: {
  indexed: IndexedSegment;
  displayText?: string;
  isActive: boolean;
  handleEditText: (segment: TranscriptSegmentType, index: number) => void;
  onSeekToSegment: (time: number) => void;
}) {
  const { segment, index } = indexed;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: String(index),
    data: { index, speaker: segment.speaker },
  });

  const handlePlayFromHere = (e: SyntheticEvent) => {
    e.stopPropagation();
    onSeekToSegment(Number(segment.start));
  };

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`kanban-bubble mb-2 p-2 ${isActive ? 'kanban-bubble-active' : ''} ${
        isDragging ? 'kanban-bubble-dragging' : ''
      }`}
      style={{ borderColor: getSpeakerBorderColor(segment.speaker) }}
      onClick={handlePlayFromHere}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handlePlayFromHere(e);
      }}
    >
      <div className="d-flex justify-content-between align-items-center mb-1">
        <small className="text-muted kanban-bubble-timestamp">
          {formatTime(segment.start)} - {formatTime(segment.end)}
        </small>
        <div className="d-flex gap-1">
          <Button
            variant="link"
            size="sm"
            className="p-0 kanban-bubble-action"
            onClick={handlePlayFromHere}
            title="Play from here"
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
            title="Edit this segment"
            style={{ color: '#f0ad4e' }}
          >
            <Pencil size={12} />
          </Button>
        </div>
      </div>
      <p className="mb-0 small">{displayText ?? segment.text}</p>
    </div>
  );
}

/** A speaker column that segments can be dropped into to reassign the speaker. */
function KanbanColumn({
  speaker,
  bubbles,
  displayTextByIndex,
  activeSegmentIndex,
  handleEditText,
  onSeekToSegment,
}: {
  speaker: string;
  bubbles: IndexedSegment[];
  displayTextByIndex?: string[];
  activeSegmentIndex: number;
  handleEditText: (segment: TranscriptSegmentType, index: number) => void;
  onSeekToSegment: (time: number) => void;
}) {
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
        <small className="text-muted">{bubbles.length}</small>
      </div>
      <div className="kanban-column-body">
        {bubbles.length === 0 ? (
          <p className="text-muted small text-center py-4 mb-0">Drop here</p>
        ) : (
          bubbles.map((indexed) => (
            <KanbanBubble
              key={indexed.index}
              indexed={indexed}
              displayText={displayTextByIndex?.[indexed.index]}
              isActive={indexed.index === activeSegmentIndex}
              handleEditText={handleEditText}
              onSeekToSegment={onSeekToSegment}
            />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Kanban-style transcript view: one column per speaker, bubbles ordered by
 * timestamp within each column. Dragging a bubble to another column reassigns
 * that segment's speaker, so misattributed lines can be corrected in place.
 */
export default function TranscriptKanbanView({
  segments,
  displayTextByIndex,
  activeSegmentIndex,
  handleEditText,
  onSeekToSegment,
  onMoveSegmentSpeaker,
}: TranscriptKanbanViewProps) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Require a small drag distance before activating, so a plain click
      // (play-from-here / edit) is never swallowed as a drag gesture.
      activationConstraint: { distance: 8 },
    })
  );

  const speakers = useMemo(() => [...new Set(segments.map((s) => s.speaker))], [segments]);

  const columns = useMemo(() => {
    const bySpeaker = new Map<string, IndexedSegment[]>();
    speakers.forEach((speaker) => bySpeaker.set(speaker, []));
    segments.forEach((segment, index) => {
      bySpeaker.get(segment.speaker)?.push({ segment, index });
    });
    return bySpeaker;
  }, [segments, speakers]);

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

  if (speakers.length === 0) {
    return null;
  }

  return (
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
            displayTextByIndex={displayTextByIndex}
            activeSegmentIndex={activeSegmentIndex}
            handleEditText={handleEditText}
            onSeekToSegment={onSeekToSegment}
          />
        ))}
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
  );
}
