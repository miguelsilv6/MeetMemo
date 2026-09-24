export type ConfidenceVariant = 'success' | 'warning' | 'danger';

const HIGH_CONFIDENCE_THRESHOLD = 0.8;
const MEDIUM_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Maps a 0-1 confidence probability to a Bootstrap-style color variant, so
 * it can be shown as an at-a-glance colored badge instead of a bare number.
 *
 * @example
 * getConfidenceVariant(0.92) // 'success'
 * getConfidenceVariant(0.65) // 'warning'
 * getConfidenceVariant(0.30) // 'danger'
 */
export function getConfidenceVariant(probability: number): ConfidenceVariant {
  if (probability >= HIGH_CONFIDENCE_THRESHOLD) return 'success';
  if (probability >= MEDIUM_CONFIDENCE_THRESHOLD) return 'warning';
  return 'danger';
}
