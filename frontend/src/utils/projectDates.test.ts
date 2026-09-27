import { describe, it, expect } from 'vitest';
import { daysUntil, expiresSoon, formatDateTime } from './projectDates';

const NOW = Date.parse('2026-09-27T12:00:00Z');

describe('project dates', () => {
  it('counts whole days left, rounding up and never below zero', () => {
    expect(daysUntil('2026-10-04T12:00:00Z', NOW)).toBe(7);
    expect(daysUntil('2026-10-04T11:00:00Z', NOW)).toBe(7);
    expect(daysUntil('2026-09-27T13:00:00Z', NOW)).toBe(1);
    expect(daysUntil('2026-09-26T12:00:00Z', NOW)).toBe(0);
    expect(daysUntil('not a date', NOW)).toBe(0);
  });

  it('flags a project with less than a day left', () => {
    expect(expiresSoon('2026-09-28T11:00:00Z', NOW)).toBe(true);
    expect(expiresSoon('2026-09-29T12:00:00Z', NOW)).toBe(false);
  });

  it('formats a local date and time, keeping unparseable input', () => {
    expect(formatDateTime('2026-10-04T12:05:00Z', 'pt-PT')).toMatch(/04\/10\/2026/);
    expect(formatDateTime('garbage', 'pt-PT')).toBe('garbage');
  });
});
