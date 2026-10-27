import { describe, it, expect } from 'vitest';
import {
  addDaysCapped,
  extensionBounds,
  extensionProblem,
  fromLocalInput,
  toLocalInput,
} from './expiryDates';

const DAY = 24 * 3600 * 1000;
const NOW = new Date(2026, 9, 27, 12, 0).getTime();

describe('expiryDates', () => {
  it('reads back the local date and time it writes for the date field', () => {
    expect(toLocalInput(NOW)).toBe('2026-10-27T12:00');
    expect(fromLocalInput('2026-10-27T12:00')).toBe(NOW);
    expect(fromLocalInput('')).toBeNaN();
  });

  it('extends from the later of the current expiry and now, at most a year ahead', () => {
    const soon = new Date(NOW + 3 * 3600 * 1000).toISOString();
    expect(extensionBounds(soon, NOW)).toEqual({
      after: NOW + 3 * 3600 * 1000,
      max: NOW + 365 * DAY,
    });
    const past = new Date(NOW - DAY).toISOString();
    expect(extensionBounds(past, NOW).after).toBe(NOW);
    expect(addDaysCapped(NOW, 7, NOW + 365 * DAY)).toBe(NOW + 7 * DAY);
    expect(addDaysCapped(NOW + 360 * DAY, 30, NOW + 365 * DAY)).toBe(NOW + 365 * DAY);
  });

  it('says why a date cannot be the new expiry', () => {
    const current = new Date(NOW + DAY).toISOString();
    expect(extensionProblem(NOW + 2 * DAY, current, NOW)).toBeNull();
    expect(extensionProblem(NOW + DAY, current, NOW)).toBe('mustBeLater');
    expect(extensionProblem(NaN, current, NOW)).toBe('mustBeLater');
    expect(extensionProblem(NOW + 366 * DAY, current, NOW)).toBe('tooFar');
  });
});
