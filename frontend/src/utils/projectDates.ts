// Dates shown for projects: when they were created and when they are deleted.

const DAY_MS = 24 * 60 * 60 * 1000;

const DATE_TIME: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

/** A timestamp as a local date and time, e.g. "04/10/2026, 14:05". */
export function formatDateTime(iso: string, locale: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(locale, DATE_TIME);
}

/** Whole days until `iso` (rounded up, never negative). */
export function daysUntil(iso: string, now: number = Date.now()): number {
  const ms = new Date(iso).getTime() - now;
  return Number.isNaN(ms) ? 0 : Math.max(0, Math.ceil(ms / DAY_MS));
}

/** Less than a day left: the project is about to be deleted. */
export function expiresSoon(iso: string, now: number = Date.now()): boolean {
  return new Date(iso).getTime() - now < DAY_MS;
}
