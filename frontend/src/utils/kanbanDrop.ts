import { pointerWithin, rectIntersection } from '@dnd-kit/core';
import type { Collision, CollisionDetection, DragEndEvent, DragMoveEvent } from '@dnd-kit/core';
import type { DropPlacement } from './moveSegment';

// Dropping a dragged Kanban bubble: which column, and which bubble it goes
// before or after. Bubbles register as droppables with
// `{ type: 'segment', index, speaker }` and columns with `{ type: 'column', speaker }`.

/** Where a dragged bubble would land: its column (speaker), and the bubble it goes next to. */
export interface DropTarget {
  speaker: string;
  index: number | null;
  placement: DropPlacement;
}

/**
 * Pointer over a column: the column says who the line is said by, and the
 * height says where it goes in the conversation. Its place is next to the
 * bubble nearest the pointer, in any column (before it in its upper half,
 * after it in its lower half), so a line can go between two lines of another
 * speaker, or in the gap between them, while staying in its own column. With
 * no other bubble at all, it is just the column.
 */
export const nearestDropPoint: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const pointer = args.pointerCoordinates;
  const column = hits.find((hit) => hit.data?.droppableContainer.data.current?.type === 'column');
  if (!pointer || !column) return hits.length > 0 ? hits : rectIntersection(args);

  const speaker = column.data?.droppableContainer.data.current?.speaker;
  const activeIndex = Number(args.active.id);
  let best: Collision | null = null;
  let bestDistance = Infinity;
  for (const container of args.droppableContainers) {
    const data = container.data.current;
    if (data?.type !== 'segment' || data.index === activeIndex) continue;
    const rect = args.droppableRects.get(container.id);
    if (!rect) continue;
    const distance = Math.max(rect.top - pointer.y, pointer.y - rect.bottom, 0);
    if (distance < bestDistance) {
      bestDistance = distance;
      const placement: DropPlacement = pointer.y < rect.top + rect.height / 2 ? 'before' : 'after';
      best = {
        id: container.id,
        data: { droppableContainer: container, value: distance, placement, speaker },
      };
    }
  }
  return best ? [best] : [column];
};

/** The drop target an event's collision points to, or null when off every column. */
export function dropTargetOf(event: DragMoveEvent | DragEndEvent): DropTarget | null {
  const collision = event.collisions?.[0];
  const data = collision?.data?.droppableContainer.data.current;
  if (data?.type === 'segment') {
    return {
      speaker: collision?.data?.speaker ?? data.speaker,
      index: data.index,
      placement: collision?.data?.placement,
    };
  }
  if (data?.type === 'column') return { speaker: data.speaker, index: null, placement: 'after' };
  return null;
}
