export interface TimeInterval {
  start: number;
  end: number;
}

export interface SilenceGap {
  topPx: number;
  heightPx: number;
  durationSeconds: number;
}

export interface KanbanTimeline {
  toY: (time: number) => number;
  totalHeight: number;
  silences: SilenceGap[];
}

const MIN_GAP_PX = 8;
const MAX_GAP_PX = 160;
export const KANBAN_PX_PER_SECOND = 1.5;
export const KANBAN_MIN_BUBBLE_HEIGHT_PX = 72;
const SILENCE_LABEL_THRESHOLD_SECONDS = 20;

function compressGap(gapSeconds: number): number {
  if (gapSeconds <= 0) return 0;
  return Math.min(MAX_GAP_PX, Math.max(MIN_GAP_PX, gapSeconds * KANBAN_PX_PER_SECOND));
}

/**
 * Builds one time-to-pixel mapping shared by every speaker column, so a
 * given vertical offset means the same audio timestamp in every column -
 * not just within one speaker's own bubbles. Positioning bubbles by
 * stacking each column's own gaps (the previous approach) let columns drift
 * apart as their bubbles' rendered content heights differed, which is why
 * bubbles still didn't line up by real time across speakers. Silence where
 * nobody is speaking is compressed (so one long pause doesn't force a huge
 * scroll); time while at least one speaker is talking is not, so
 * overlapping turns keep their real relative timing.
 */
export function buildKanbanTimeline(
  segments: { start: number | string; end: number | string }[]
): KanbanTimeline {
  if (segments.length === 0) {
    return { toY: () => 0, totalHeight: 0, silences: [] };
  }

  const intervals: TimeInterval[] = segments
    .map((s) => ({ start: Number(s.start), end: Number(s.end) }))
    .sort((a, b) => a.start - b.start);

  const merged: TimeInterval[] = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }

  const offsetAtStart: number[] = [];
  const silences: SilenceGap[] = [];
  let cumulative = 0;
  let prevEnd = merged[0].start;

  merged.forEach((interval) => {
    const gapSeconds = interval.start - prevEnd;
    if (gapSeconds >= SILENCE_LABEL_THRESHOLD_SECONDS) {
      silences.push({
        topPx: cumulative,
        heightPx: compressGap(gapSeconds),
        durationSeconds: gapSeconds,
      });
    }
    cumulative += compressGap(gapSeconds);
    offsetAtStart.push(cumulative);
    cumulative += (interval.end - interval.start) * KANBAN_PX_PER_SECOND;
    prevEnd = interval.end;
  });

  const toY = (time: number): number => {
    let lo = 0;
    let hi = merged.length - 1;
    let idx = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (merged[mid].start <= time) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const interval = merged[idx];
    const clamped = Math.max(interval.start, Math.min(time, interval.end));
    return offsetAtStart[idx] + (clamped - interval.start) * KANBAN_PX_PER_SECOND;
  };

  return { toY, totalHeight: cumulative, silences };
}

/**
 * Resolves same-column overlap: bubbles are ordered by their natural
 * (time-based) top and pushed down just enough to clear a minimum-height
 * reservation for the bubble above. This is a heuristic floor, not a
 * measured height, so an unusually long bubble can still touch the next one
 * in rare, dense same-speaker exchanges.
 */
export function resolveColumnOverlap(
  naturalTops: number[],
  minHeightPx: number = KANBAN_MIN_BUBBLE_HEIGHT_PX
): number[] {
  const tops: number[] = [];
  let cursor = -Infinity;
  for (const naturalTop of naturalTops) {
    const top = Math.max(naturalTop, cursor);
    tops.push(top);
    cursor = top + minHeightPx;
  }
  return tops;
}
