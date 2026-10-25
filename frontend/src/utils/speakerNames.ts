import type { TranscriptSegment } from '../types/api';

/** A label diarization gave a speaker (SPEAKER_00, SPEAKER_01…), not a name. */
const DEFAULT_SPEAKER_LABEL = /^SPEAKER_\d+$/;

/** Whether any speaker still has the label diarization gave it instead of a name. */
export function hasDefaultSpeakerNames(segments: TranscriptSegment[] | undefined): boolean {
  return (segments ?? []).some((segment) => DEFAULT_SPEAKER_LABEL.test(segment.speaker));
}
