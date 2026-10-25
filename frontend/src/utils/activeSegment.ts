import type { TranscriptSegment } from '../types/api';

/**
 * The segment to highlight at a playback time.
 *
 * On a call transcribed per channel the two speakers' segments overlap in
 * time, so several can contain the same moment. The one that started last is
 * the speaker who just began talking: picking the first would keep a long
 * segment highlighted while the other speaker's lines go by.
 */
export function findActiveSegmentIndex(
  segments: TranscriptSegment[] | undefined,
  currentTime: number
): number {
  if (!segments || segments.length === 0) return -1;

  let active = -1;
  let activeStart = -Infinity;
  segments.forEach((segment, i) => {
    const start = Number(segment.start);
    const end = Number(segment.end);
    if (currentTime >= start && currentTime < end && start >= activeStart) {
      active = i;
      activeStart = start;
    }
  });
  if (active !== -1) return active;

  // If past the last segment, return last segment
  const lastEnd = Number(segments[segments.length - 1].end);
  if (currentTime >= lastEnd) {
    return segments.length - 1;
  }

  return -1;
}
