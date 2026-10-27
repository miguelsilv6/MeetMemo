import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../services/api';
import type { ApiError, TranscriptSegment } from '../types/api';

/** Where the transcript's edits stand with the server. */
export type SaveState = 'saved' | 'saving' | 'pending' | 'failed';

// Waits before saving again after a failure that may pass (the last repeats).
export const RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 30000];

/**
 * Whether a failed save may work if tried again: no answer (network), the
 * server's own trouble (5xx), a timeout or too many requests, or an expired
 * session (it works again once signed back in).
 */
export function isTransientSaveError(err: unknown): boolean {
  const status = (err as ApiError | undefined)?.status;
  return (
    status === undefined || status >= 500 || status === 408 || status === 429 || status === 401
  );
}

/**
 * Saves transcript edits on the server without ever dropping one: the newest
 * version of each audio's transcript waits here (in memory only) until the
 * server has it. One request at a time; edits made meanwhile are sent next
 * (each request saves the whole transcript, so the newest version is enough).
 * A failure that may pass is tried again after a growing wait, or as soon as
 * the network is back; any other failure waits for `retryNow`. While anything
 * is unsaved, leaving or reloading the page asks first.
 */
export default function useTranscriptSaver() {
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  /** When the next attempt is due (ms since epoch), while waiting to try again. */
  const [retryAt, setRetryAt] = useState<number | null>(null);

  // The newest unsaved version of each audio's transcript.
  const pending = useRef(new Map<string, TranscriptSegment[]>());
  const inFlight = useRef(false);
  // The version being sent, while a request is under way.
  const sending = useRef<{ jobId: string; segments: TranscriptSegment[] } | null>(null);
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `flush` callers, told whether everything got saved.
  const waiters = useRef<((saved: boolean) => void)[]>([]);

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setRetryAt(null);
  };

  const settle = (saved: boolean) => {
    waiters.current.splice(0).forEach((resolve) => resolve(saved));
  };

  // Sends what is unsaved, one request at a time, until nothing is left or
  // an attempt fails (then it is tried again later, or on `retryNow`).
  const sendRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const send = useCallback(async (): Promise<void> => {
    while (!inFlight.current) {
      const next = pending.current.entries().next();
      if (next.done) return;
      const [jobId, segments] = next.value;

      clearTimer();
      inFlight.current = true;
      sending.current = { jobId, segments };
      setSaveState('saving');
      try {
        await api.updateTranscript(jobId, segments);
        failures.current = 0;
        if (pending.current.get(jobId) === segments) pending.current.delete(jobId);
        if (pending.current.size === 0) {
          setSaveState('saved');
          setSaveError(null);
          settle(true);
        }
      } catch (err) {
        setSaveError((err as Error).message);
        settle(false);
        // Unless a newer version of it was queued meanwhile (sent next), wait.
        if (pending.current.get(jobId) === segments) {
          if (isTransientSaveError(err)) {
            const delay = RETRY_DELAYS_MS[Math.min(failures.current, RETRY_DELAYS_MS.length - 1)];
            failures.current += 1;
            setSaveState('pending');
            setRetryAt(Date.now() + delay);
            timer.current = setTimeout(() => void sendRef.current(), delay);
          } else {
            setSaveState('failed');
          }
          inFlight.current = false;
          sending.current = null;
          return;
        }
      }
      inFlight.current = false;
      sending.current = null;
    }
  }, []);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  /** Keep this version of an audio's transcript until the server has it. */
  const queueSave = useCallback(
    (jobId: string, segments: TranscriptSegment[]) => {
      pending.current.set(jobId, segments);
      if (!inFlight.current) void send();
    },
    [send]
  );

  /**
   * Change what is still to be saved for an audio (e.g. speakers renamed on the
   * server meanwhile), so a late save does not undo that change: the version
   * waiting, or else a copy of the one being sent, saved after it.
   */
  const updatePending = useCallback(
    (jobId: string, update: (segments: TranscriptSegment[]) => TranscriptSegment[]) => {
      const waiting = pending.current.get(jobId);
      if (waiting) {
        pending.current.set(jobId, update(waiting));
      } else if (sending.current?.jobId === jobId) {
        pending.current.set(jobId, update(sending.current.segments));
      }
    },
    []
  );

  /** Try again now (after a failure, or instead of waiting for the next attempt). */
  const retryNow = useCallback(() => {
    if (!inFlight.current) void send();
  }, [send]);

  /** Wait for what is unsaved to be saved: true once it is, false if an attempt fails. */
  const flush = useCallback((): Promise<boolean> => {
    if (pending.current.size === 0 && !inFlight.current) return Promise.resolve(true);
    const done = new Promise<boolean>((resolve) => waiters.current.push(resolve));
    if (!inFlight.current) void send();
    return done;
  }, [send]);

  // Back online: try at once rather than waiting for the next attempt.
  useEffect(() => {
    const onOnline = () => {
      if (pending.current.size > 0 && !inFlight.current) void send();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [send]);

  // Leaving or reloading the page with edits not yet on the server asks first.
  useEffect(() => {
    if (saveState === 'saved') return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [saveState]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    []
  );

  return { saveState, saveError, retryAt, queueSave, updatePending, retryNow, flush };
}
