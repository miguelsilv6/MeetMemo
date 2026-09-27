import { describe, it, expect } from 'vitest';
import { exceedsUploadLimit, sizeInMb } from './uploadLimit';

const MIB = 1024 * 1024;
const blob = (bytes: number) => ({ size: bytes }) as Blob;

describe('upload limit', () => {
  it('accepts files up to the limit and refuses larger ones', () => {
    expect(exceedsUploadLimit(blob(100 * MIB), 100)).toBe(false);
    expect(exceedsUploadLimit(blob(100 * MIB + 1), 100)).toBe(true);
  });

  it('never refuses while the limit is unknown (the server still checks)', () => {
    expect(exceedsUploadLimit(blob(10_000 * MIB), null)).toBe(false);
  });

  it('describes sizes in MB', () => {
    expect(sizeInMb(blob(157.3 * MIB))).toBe('157.3');
  });
});
