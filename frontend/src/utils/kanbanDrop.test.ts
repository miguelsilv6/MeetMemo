import { describe, it, expect } from 'vitest';
import type { CollisionDetection, DragEndEvent } from '@dnd-kit/core';
import { dropTargetOf, nearestDropPoint } from './kanbanDrop';

type Args = Parameters<CollisionDetection>[0];

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

// Two columns 200px wide; A has bubbles at y 0-40 and 100-140, B one at 300-340.
const layout = [
  { id: 'A', data: { type: 'column', speaker: 'A' }, rect: rect(0, 0, 200, 1000) },
  { id: 'B', data: { type: 'column', speaker: 'B' }, rect: rect(200, 0, 200, 1000) },
  { id: 'C', data: { type: 'column', speaker: 'C' }, rect: rect(400, 0, 200, 1000) },
  {
    id: 'segment-0',
    data: { type: 'segment', index: 0, speaker: 'A' },
    rect: rect(10, 0, 180, 40),
  },
  {
    id: 'segment-1',
    data: { type: 'segment', index: 1, speaker: 'A' },
    rect: rect(10, 100, 180, 40),
  },
  {
    id: 'segment-2',
    data: { type: 'segment', index: 2, speaker: 'B' },
    rect: rect(210, 300, 180, 40),
  },
];

function detect(x: number, y: number, activeIndex = 2, items = layout) {
  const containers = items.map(({ id, data }) => ({ id, data: { current: data } }));
  return nearestDropPoint({
    active: { id: String(activeIndex) },
    collisionRect: rect(x - 5, y - 5, 10, 10),
    droppableRects: new Map(items.map(({ id, rect: r }) => [id, r])),
    droppableContainers: containers,
    pointerCoordinates: { x, y },
  } as unknown as Args);
}

const targetAt = (x: number, y: number, activeIndex?: number, items?: typeof layout) =>
  dropTargetOf({ collisions: detect(x, y, activeIndex, items) } as unknown as DragEndEvent);

describe('nearestDropPoint', () => {
  it('goes before a bubble in its upper half and after it in its lower half', () => {
    expect(targetAt(100, 105)).toEqual({ speaker: 'A', index: 1, placement: 'before' });
    expect(targetAt(100, 135)).toEqual({ speaker: 'A', index: 1, placement: 'after' });
  });

  it('in the gap between two bubbles, goes next to the nearest one', () => {
    expect(targetAt(100, 50)).toEqual({ speaker: 'A', index: 0, placement: 'after' });
    expect(targetAt(100, 90)).toEqual({ speaker: 'A', index: 1, placement: 'before' });
  });

  it("places by the height of another column's bubbles, keeping the column's speaker", () => {
    // B's bubble dragged within B's column to the height between A's two bubbles.
    expect(targetAt(300, 60, 2)).toEqual({ speaker: 'B', index: 0, placement: 'after' });
    expect(targetAt(300, 90, 2)).toEqual({ speaker: 'B', index: 1, placement: 'before' });
    // An empty column too.
    expect(targetAt(500, 110, 2)).toEqual({ speaker: 'C', index: 1, placement: 'before' });
  });

  it('never targets the dragged bubble itself', () => {
    expect(targetAt(300, 320, 2)).toEqual({ speaker: 'B', index: 1, placement: 'after' });
    expect(targetAt(100, 20, 0)).toEqual({ speaker: 'A', index: 1, placement: 'before' });
  });

  it('is just the column when there is no other bubble', () => {
    const alone = layout.filter(({ id }) => id !== 'segment-0' && id !== 'segment-1');
    expect(targetAt(500, 400, 2, alone)).toEqual({ speaker: 'C', index: null, placement: 'after' });
  });

  it('is nothing off every column', () => {
    expect(targetAt(900, 400)).toBeNull();
  });
});
