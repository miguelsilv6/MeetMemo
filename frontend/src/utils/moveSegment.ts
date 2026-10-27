import type { MergedLine, TranscriptSegment } from '../types/api';

/** Where a dropped segment goes relative to the bubble it was dropped on. */
export type DropPlacement = 'before' | 'after';

// The shortest a moved line is made when it does not fit between its neighbours.
const MIN_LENGTH_SECONDS = 1;

const round = (seconds: number) => Math.round(seconds * 100) / 100;

/**
 * The segments after moving one before or after another (e.g. dragged in the
 * Kanban view to between two lines), or null when nothing changes.
 *
 * The moved segment takes `speaker` (the column it was dropped in, which may
 * be its own) and its place in the conversation next to the target, whoever
 * says the target. Lines read in time order, so when it does not already fall
 * between its new neighbours, it gets new times there: it starts where the
 * line above ends and keeps its length, shortened (to a second at least) if
 * the line below starts sooner. Its words are re-timed into the new span, and
 * its first speaker and times are kept in `original` (the audio still has it
 * at those times).
 */
export function moveSegmentNextTo(
  segments: TranscriptSegment[],
  index: number,
  targetIndex: number,
  placement: DropPlacement,
  speaker: string
): TranscriptSegment[] | null {
  const moving = segments[index];
  const target = segments[targetIndex];
  if (!moving || !target || index === targetIndex) return null;

  // The conversation without the moved line, in display order (every speaker).
  const lines = segments
    .map((segment, i) => ({ segment, i }))
    .filter(({ i }) => i !== index)
    .sort((a, b) => Number(a.segment.start) - Number(b.segment.start) || a.i - b.i);
  const position = lines.findIndex(({ i }) => i === targetIndex);
  const prev = placement === 'before' ? lines[position - 1] : lines[position];
  const next = placement === 'before' ? lines[position] : lines[position + 1];

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
    if (moving.speaker === speaker) return null;
    const updated = [...segments];
    updated[index] = { ...moving, speaker };
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
    speaker,
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

/**
 * The segments after merging one into another (e.g. dragged onto the middle
 * of another bubble in the Kanban view), or null when it is the same one.
 *
 * The target keeps its place and speaker; the moved line's text goes after
 * its own. When no other line starts between the two, the merged line spans
 * both. Otherwise it keeps the target's start and grows by the moved line's
 * length (a second at least), but not past the start of the target's next
 * line; the moved words are re-timed into that added span. The moved line's
 * speaker, times (as transcribed) and text are kept in `merged`.
 */
export function mergeSegmentInto(
  segments: TranscriptSegment[],
  index: number,
  targetIndex: number
): TranscriptSegment[] | null {
  const moving = segments[index];
  const target = segments[targetIndex];
  if (!moving || !target || index === targetIndex) return null;

  const targetStart = Number(target.start);
  const targetEnd = Number(target.end);
  const start = Number(moving.start);
  const end = Number(moving.end);
  const length = Math.max(end - start, 0);
  const others = segments.filter((_, i) => i !== index && i !== targetIndex);
  const low = Math.min(start, targetStart);
  const high = Math.max(start, targetStart);
  const adjacent = !others.some((s) => Number(s.start) > low && Number(s.start) < high);

  let newStart: number;
  let newEnd: number;
  let words = moving.words;
  if (adjacent) {
    newStart = Math.min(targetStart, start);
    newEnd = Math.max(targetEnd, end);
  } else {
    newStart = targetStart;
    const nextStart = Math.min(
      ...others.map((s) => Number(s.start)).filter((t) => t > targetStart),
      Infinity
    );
    newEnd = Math.max(targetEnd, Math.min(targetEnd + length, nextStart));
    newEnd = Math.max(newEnd, targetEnd + Math.min(length, MIN_LENGTH_SECONDS));
    const scale = length > 0 ? (newEnd - targetEnd) / length : 0;
    const retime = (t: number) => round(targetEnd + (t - start) * scale);
    words = moving.words?.map((w) => ({ ...w, start: retime(w.start), end: retime(w.end) }));
  }

  const mergedLine: MergedLine = {
    speaker: moving.original?.speaker ?? moving.speaker,
    start: moving.original?.start ?? start,
    end: moving.original?.end ?? end,
    text: moving.text.trim(),
  };
  const merged: TranscriptSegment = {
    ...target,
    start: round(newStart),
    end: round(newEnd),
    text: `${target.text.trim()} ${moving.text.trim()}`.trim(),
    merged: [...(target.merged ?? []), mergedLine, ...(moving.merged ?? [])],
    ...(target.low_confidence || moving.low_confidence ? { low_confidence: true } : {}),
    ...(target.words || words ? { words: [...(target.words ?? []), ...(words ?? [])] } : {}),
  };

  const updated = [...segments];
  updated[targetIndex] = merged;
  updated.splice(index, 1);
  return updated;
}
