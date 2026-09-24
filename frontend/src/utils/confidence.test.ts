import { describe, it, expect } from 'vitest';
import { getConfidenceVariant } from './confidence';

describe('getConfidenceVariant', () => {
  it('returns "success" for high confidence (>= 0.8)', () => {
    expect(getConfidenceVariant(0.8)).toBe('success');
    expect(getConfidenceVariant(0.95)).toBe('success');
    expect(getConfidenceVariant(1)).toBe('success');
  });

  it('returns "warning" for medium confidence (0.5 - 0.79)', () => {
    expect(getConfidenceVariant(0.5)).toBe('warning');
    expect(getConfidenceVariant(0.65)).toBe('warning');
    expect(getConfidenceVariant(0.79)).toBe('warning');
  });

  it('returns "danger" for low confidence (< 0.5)', () => {
    expect(getConfidenceVariant(0.49)).toBe('danger');
    expect(getConfidenceVariant(0.1)).toBe('danger');
    expect(getConfidenceVariant(0)).toBe('danger');
  });
});
