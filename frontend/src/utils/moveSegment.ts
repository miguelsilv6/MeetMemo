import type { TranscriptSegment } from '../types/api';

/** Where a dropped segment goes relative to the bubble it was dropped on. */
export type DropPlacement = 'before' | 'after';

// The shortest a moved line is made when it does not fit between its neighbours.
const MIN_LENGTH_SECONDS = 1;

const round = (seconds: number) => Math.round(seconds * 100) / 100;

/**
 * The segments after moving one next to another (e.g. dragged in the Kanban
 * view to between two lines of another speaker), or null when nothing changes.
 *
 * The moved segment takes the target's speaker. Lines read in time order, so
 * when it does not already fall between its new neighbours in that speaker's
 * column, it gets new times there: it starts where the line above ends and
 * keeps its length, shortened (to a second at least) if the line below starts
 * sooner. Its words are re-timed into the new span, and its first speaker and
 * times are kept in `original` (the audio still has it at those times).
 */
export function moveSegmentNextTo(
  segments: TranscriptSegment[],
  index: number,
  targetIndex: number,
  placement: DropPlacement
): TranscriptSegment[] | null {
  const moving = segments[index];
  const target = segments[targetIndex];
  if (!moving || !target || index === targetIndex) return null;

  // The target speaker's column without the moved line, in display order.
  const column = segments
    .map((segment, i) => ({ segment, i }))
    .filter(({ segment, i }) => i !== index && segment.speaker === target.speaker)
    .sort((a, b) => Number(a.segment.start) - Number(b.segment.start) || a.i - b.i);
  const position = column.findIndex(({ i }) => i === targetIndex);
  const prev = placement === 'before' ? column[position - 1] : column[position];
  const next = placement === 'before' ? column[position] : column[position + 1];

  const start = Number(moving.start);
  const end = Number(moving.end);
  const fits =
    (!prev ||
      Number(prev.segment.start) < start ||
      (Number(prev.segment.start) === start && prev.i < index)) &&
    (!next ||
      start < Number(next.segment.start) ||
      (start === Number(next.segment.start) && index < next.i));
  if (fits) {
    if (moving.speaker === target.speaker) return null;
    const updated = [...segments];
    updated[index] = { ...moving, speaker: target.speaker };
    return updated;
  }

  const length = Math.max(end - start, 0);
  let newStart: number;
  let newEnd: number;
  if (prev && next) {
    newStart = Math.min(Number(prev.segment.end), Number(next.segment.start));
    newEnd = Math.min(newStart + length, Number(next.segment.start));
  } else if (prev) {
    newStart = Number(prev.segment.end);
    newEnd = newStart + length;
  } else {
    newEnd = Number(next!.segment.start);
    newStart = Math.max(newEnd - length, 0);
  }
  // Never squeezed to nothing: it keeps at least a second (or its own length)
  // to hear and highlight, overlapping the next line if there is no room.
  newEnd = Math.max(newEnd, newStart + Math.min(length, MIN_LENGTH_SECONDS));
  newStart = round(newStart);
  newEnd = round(newEnd);

  const scale = length > 0 ? (newEnd - newStart) / length : 0;
  const retime = (t: number) => round(newStart + (t - start) * scale);
  const moved: TranscriptSegment = {
    ...moving,
    speaker: target.speaker,
    start: newStart,
    end: newEnd,
    original: moving.original ?? { speaker: moving.speaker, start, end },
    ...(moving.words
      ? { words: moving.words.map((w) => ({ ...w, start: retime(w.start), end: retime(w.end) })) }
      : {}),
  };

  // Back into the array in time order, between its new neighbours.
  const rest = segments.filter((_, i) => i !== index);
  const shift = (i: number) => (i > index ? i - 1 : i);
  const low = prev ? shift(prev.i) + 1 : 0;
  const high = next ? shift(next.i) : rest.length;
  let at = Math.min(low, high);
  while (at < high && Number(rest[at].start) <= newStart) at++;
  rest.splice(at, 0, moved);
  return rest;
}
