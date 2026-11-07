// How long a task still takes, as the server estimates it (eta_seconds, and
// eta_at when it is done), in words. No estimate yet (the server has no
// timings for it): still being worked out; nothing left: finishing.
import type { TFunction } from 'i18next';

/** "less than 1 min", "4 min", "1 h 20 min". */
export function etaDuration(seconds: number, t: TFunction): string {
  if (seconds < 60) return t('eta.lessThanMinute');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('eta.minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? t('eta.hoursMinutes', { hours, minutes: rest }) : t('eta.hours', { count: hours });
}

/** When it is done: the time today, else the day and time. */
export function etaClock(at: string, locale: string, now: Date = new Date()): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return time;
  return `${date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })} ${time}`;
}

/**
 * The estimate in words: "About 4 min left (done around 14:32)", or the
 * `compact` "≈ 4 min" for a button (under a minute: "Less than 1 min left …", "< 1 min").
 */
export function etaText(
  seconds: number | null | undefined,
  at: string | null | undefined,
  t: TFunction,
  locale: string,
  { compact = false, now = new Date() }: { compact?: boolean; now?: Date } = {}
): string {
  if (seconds === null || seconds === undefined) return t('eta.calculating');
  if (seconds <= 0) return t('eta.finishing');
  const soon = seconds < 60;
  if (compact || !at) {
    return soon
      ? t('eta.compactUnderMinute')
      : t('eta.compact', { duration: etaDuration(seconds, t) });
  }
  const time = etaClock(at, locale, now);
  if (soon) return t('eta.remainingUnderMinute', { time });
  return t('eta.remaining', { duration: etaDuration(seconds, t), time });
}
