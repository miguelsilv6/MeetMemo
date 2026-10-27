// Extending when an audio or project is deleted (the administrator): the
// bounds the server enforces, and the values of a date-and-time field.

const DAY_MS = 24 * 60 * 60 * 1000;

/** The furthest anything can be extended, from now (as on the server). */
export const MAX_EXTENSION_DAYS = 365;

/** Quick choices, in days after the later of the current expiry and now. */
export const EXTENSION_SHORTCUTS_DAYS = [7, 30];

/** A time (ms) as the value of an <input type="datetime-local">, in local time. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The time (ms) an <input type="datetime-local"> value stands for, or NaN. */
export function fromLocalInput(value: string): number {
  return value ? new Date(value).getTime() : NaN;
}

/** What a new expiry may be: after both the current one and now, at most a year from now. */
export function extensionBounds(currentIso: string, now: number = Date.now()) {
  const current = new Date(currentIso).getTime();
  return {
    after: Math.max(current, now),
    max: now + MAX_EXTENSION_DAYS * DAY_MS,
  };
}

/** `days` after `from`, but never past `max`. */
export function addDaysCapped(from: number, days: number, max: number): number {
  return Math.min(from + days * DAY_MS, max);
}

/** Why `chosen` cannot be the new expiry ('mustBeLater' | 'tooFar'), or null. */
export function extensionProblem(
  chosen: number,
  currentIso: string,
  now: number = Date.now()
): 'mustBeLater' | 'tooFar' | null {
  const { after, max } = extensionBounds(currentIso, now);
  if (Number.isNaN(chosen) || chosen <= after) return 'mustBeLater';
  if (chosen > max) return 'tooFar';
  return null;
}
