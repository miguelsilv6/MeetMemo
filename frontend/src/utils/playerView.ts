// Pure helpers for the audio player's playback speed and waveform zoom.

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export const DEFAULT_PLAYBACK_RATE = 1;
export const ZOOM_LEVELS = [1, 2, 4, 8, 16] as const;

/** Seconds moved by the ←/→ shortcuts. */
export const ARROW_SEEK_SECONDS = 5;

/** Portion of the view kept behind the playhead when the view jumps to follow it. */
const FOLLOW_LEAD_RATIO = 0.1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The next playback rate up (direction 1) or down (-1), clamped to the list. */
export function stepPlaybackRate(rate: number, direction: 1 | -1): number {
  const index = PLAYBACK_RATES.findIndex((r) => r === rate);
  const current = index === -1 ? PLAYBACK_RATES.indexOf(DEFAULT_PLAYBACK_RATE) : index;
  return PLAYBACK_RATES[clamp(current + direction, 0, PLAYBACK_RATES.length - 1)];
}

/** The next zoom level in (direction 1) or out (-1), clamped to the list. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const index = ZOOM_LEVELS.findIndex((z) => z === zoom);
  const current = index === -1 ? 0 : index;
  return ZOOM_LEVELS[clamp(current + direction, 0, ZOOM_LEVELS.length - 1)];
}

/** Length in seconds of the visible part of the track at a zoom level. */
export function viewSpan(duration: number, zoom: number): number {
  return duration > 0 ? duration / Math.max(1, zoom) : 0;
}

/** Clamps a view start so the whole view stays inside the track. */
export function clampViewStart(start: number, duration: number, zoom: number): number {
  return clamp(start, 0, Math.max(0, duration - viewSpan(duration, zoom)));
}

/**
 * The view start after changing zoom, keeping `anchor` (a time, e.g. the
 * playhead or the point under the mouse) at the same place on screen.
 */
export function zoomViewStart(
  duration: number,
  start: number,
  fromZoom: number,
  toZoom: number,
  anchor: number
): number {
  const fromSpan = viewSpan(duration, fromZoom);
  const toSpan = viewSpan(duration, toZoom);
  const anchorRatio = fromSpan > 0 ? clamp((anchor - start) / fromSpan, 0, 1) : 0;
  return clampViewStart(anchor - anchorRatio * toSpan, duration, toZoom);
}

/**
 * The view start that keeps `time` visible: unchanged while it is on screen,
 * otherwise jumped so `time` sits just after the left edge (like turning a
 * page), which keeps the view still for most of the playback.
 */
export function followViewStart(
  start: number,
  duration: number,
  zoom: number,
  time: number
): number {
  const span = viewSpan(duration, zoom);
  if (time >= start && time <= start + span) return start;
  return clampViewStart(time - span * FOLLOW_LEAD_RATIO, duration, zoom);
}

/**
 * The slice of whole-track overview peaks covering [start, end], for drawing a
 * zoomed view immediately while its detailed peaks are still loading.
 */
export function slicePeaks<T>(peaks: T[], duration: number, start: number, end: number): T[] {
  if (duration <= 0 || peaks.length === 0) return peaks;
  const from = Math.floor((start / duration) * peaks.length);
  const to = Math.ceil((end / duration) * peaks.length);
  return peaks.slice(clamp(from, 0, peaks.length - 1), clamp(to, from + 1, peaks.length));
}

/** Formats a playback rate for display, e.g. 0.75 → "0,75×" in Portuguese. */
export function formatPlaybackRate(rate: number, locale: string): string {
  return `${rate.toLocaleString(locale)}×`;
}

/**
 * True when a keyboard shortcut should be ignored because the key belongs to
 * what has focus: typing in a field, or a control that handles the key itself.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
