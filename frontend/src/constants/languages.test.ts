import { describe, it, expect } from 'vitest';
import { getLanguageName } from './languages';

describe('getLanguageName', () => {
  it('resolves a known code to its display name', () => {
    expect(getLanguageName('pt')).toBe('Portuguese');
    expect(getLanguageName('en')).toBe('English');
  });

  it('falls back to the raw code for an unrecognized language', () => {
    expect(getLanguageName('xx')).toBe('xx');
  });

  it('returns Unknown for a missing code', () => {
    expect(getLanguageName(null)).toBe('Unknown');
    expect(getLanguageName(undefined)).toBe('Unknown');
    expect(getLanguageName('')).toBe('Unknown');
  });
});
