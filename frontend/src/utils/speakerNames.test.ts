import { describe, it, expect } from 'vitest';
import { hasDefaultSpeakerNames } from './speakerNames';

const line = (speaker: string) => ({ speaker, start: 0, end: 1, text: 'x' });

describe('hasDefaultSpeakerNames', () => {
  it('is true while any speaker keeps a SPEAKER_xx label', () => {
    expect(hasDefaultSpeakerNames([line('Ana'), line('SPEAKER_01')])).toBe(true);
    expect(hasDefaultSpeakerNames([line('SPEAKER_10')])).toBe(true);
  });

  it('is false once every speaker has a name', () => {
    expect(hasDefaultSpeakerNames([line('Ana'), line('Bruno')])).toBe(false);
    // Only the exact label counts, not a name that merely contains it.
    expect(hasDefaultSpeakerNames([line('SPEAKER_01 (Bruno)'), line('speaker_00')])).toBe(false);
  });

  it('is false without segments', () => {
    expect(hasDefaultSpeakerNames(undefined)).toBe(false);
    expect(hasDefaultSpeakerNames([])).toBe(false);
  });
});
