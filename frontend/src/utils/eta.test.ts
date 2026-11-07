import { describe, it, expect } from 'vitest';
import i18n from '../i18n';
import { etaClock, etaDuration, etaText } from './eta';

const t = i18n.t.bind(i18n);
const NOW = new Date(2026, 10, 7, 14, 28);
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

describe('eta', () => {
  it('says how long in minutes, then hours and minutes', () => {
    expect(etaDuration(20, t)).toBe('less than 1 min');
    expect(etaDuration(4 * 60 + 10, t)).toBe('4 min');
    expect(etaDuration(80 * 60, t)).toBe('1 h 20 min');
    expect(etaDuration(120 * 60, t)).toBe('2 h');
  });

  it('says when it is done: the time today, else the day too', () => {
    expect(etaClock(at(4), 'en-GB', NOW)).toBe('14:32');
    expect(etaClock(at(24 * 60), 'en-GB', NOW)).toBe('08/11 14:28');
  });

  it('says the time left and when it is done', () => {
    expect(etaText(240, at(4), t, 'en-GB', { now: NOW })).toBe(
      'About 4 min left (done around 14:32)'
    );
    expect(etaText(240, at(4), t, 'en-GB', { compact: true, now: NOW })).toBe('≈ 4 min');
  });

  it('says less than a minute plainly', () => {
    expect(etaText(40, at(1), t, 'en-GB', { now: NOW })).toBe(
      'Less than 1 min left (done around 14:29)'
    );
    expect(etaText(40, at(1), i18n.getFixedT('pt'), 'pt-PT', { now: NOW })).toBe(
      'Falta menos de 1 min (termina por volta das 14:29)'
    );
    expect(etaText(40, at(1), t, 'en-GB', { compact: true, now: NOW })).toBe('< 1 min');
  });

  it('says when there is no estimate yet, or nothing left', () => {
    expect(etaText(null, null, t, 'en-GB')).toBe('Working out the time left…');
    expect(etaText(undefined, undefined, t, 'en-GB')).toBe('Working out the time left…');
    expect(etaText(0, at(0), t, 'en-GB')).toBe('Finishing…');
  });
});
