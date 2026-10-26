// Speaker color mapping — a different color for each speaker of the transcript

import type { TranscriptSegment } from '../types/api';

export interface SpeakerColor {
  bg: string;
  text: string;
}

// A curated palette of blue/purple hues with good contrast on white and dark
// backgrounds, ordered so that colors next to each other are easy to tell apart
// (a call between two speakers gets indigo and cyan).
const SPEAKER_PALETTE: SpeakerColor[] = [
  { bg: '#3b5bdb', text: '#fff' }, // indigo
  { bg: '#0c8599', text: '#fff' }, // cyan
  { bg: '#ae3ec9', text: '#fff' }, // purple
  { bg: '#1c7ed6', text: '#fff' }, // blue
  { bg: '#5f3dc4', text: '#fff' }, // deep violet
  { bg: '#1098ad', text: '#fff' }, // teal-blue
  { bg: '#862e9c', text: '#fff' }, // deep purple
  { bg: '#7048e8', text: '#fff' }, // violet
];

// Each speaker's place in the palette.
const speakerColorMap = new Map<string, number>();

// The first palette entry no speaker has yet; once all are taken they repeat in order.
function nextColorIndex(): number {
  const taken = new Set(speakerColorMap.values());
  for (let i = 0; i < SPEAKER_PALETTE.length; i++) {
    if (!taken.has(i)) return i;
  }
  return speakerColorMap.size % SPEAKER_PALETTE.length;
}

export function getSpeakerColor(speakerLabel: string | null | undefined): SpeakerColor {
  if (!speakerLabel) return SPEAKER_PALETTE[0];

  let index = speakerColorMap.get(speakerLabel);
  if (index === undefined) {
    index = nextColorIndex();
    speakerColorMap.set(speakerLabel, index);
  }
  return SPEAKER_PALETTE[index];
}

/**
 * Give the transcript's speakers their colors in the order they first speak:
 * no two share a color (up to the palette's eight), and renaming a speaker
 * keeps its color, since the order of the lines does not change.
 */
export function initializeSpeakerColors(segments: TranscriptSegment[] | null | undefined): void {
  if (!segments || !Array.isArray(segments)) return;

  speakerColorMap.clear();
  for (const segment of segments) {
    if (segment.speaker) getSpeakerColor(segment.speaker);
  }
}

export function getSpeakerBorderColor(speakerLabel: string | null | undefined): string {
  return getSpeakerColor(speakerLabel).bg;
}
