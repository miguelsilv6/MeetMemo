import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as api from '../services/api';
import type { CuePoint } from '../types/api';

const byPosition = (a: CuePoint, b: CuePoint) =>
  a.position_seconds - b.position_seconds || a.id - b.id;

/**
 * An audio's cue points (marked instants with a note), kept on the server.
 * Adding waits for the server (it gives the id); changing a note and removing
 * show at once and are undone if the server refuses.
 */
export default function useCuePoints(jobId: string | null) {
  const { t } = useTranslation();
  const [cuePoints, setCuePoints] = useState<CuePoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The cue point just added, whose note the list opens for typing.
  const [addedId, setAddedId] = useState<number | null>(null);
  // Only for the load error, so switching language does not load them again.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- another audio starts empty until its cue points load
    setCuePoints([]);
    setError(null);
    if (!jobId) return;
    api
      .listCuePoints(jobId)
      .then((loaded) => {
        if (!cancelled) setCuePoints([...loaded].sort(byPosition));
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || tRef.current('cuePoints.errors.load'));
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const addCuePoint = useCallback(
    async (positionSeconds: number) => {
      if (!jobId) return;
      try {
        setError(null);
        const created = await api.createCuePoint(jobId, Math.max(0, positionSeconds));
        setCuePoints((prev) => [...prev, created].sort(byPosition));
        setAddedId(created.id);
      } catch (err) {
        setError((err as Error).message || t('cuePoints.errors.save'));
      }
    },
    [jobId, t]
  );

  const updateNote = useCallback(
    async (id: number, note: string) => {
      // The new cue point's note was left: it no longer takes the focus.
      setAddedId(null);
      if (!jobId) return;
      const current = cuePoints.find((c) => c.id === id);
      const trimmed = note.trim();
      if (!current || current.note === trimmed) return;
      setCuePoints((prev) => prev.map((c) => (c.id === id ? { ...c, note: trimmed } : c)));
      try {
        setError(null);
        const saved = await api.updateCuePoint(jobId, id, note);
        setCuePoints((prev) => prev.map((c) => (c.id === id ? saved : c)));
      } catch (err) {
        // Only this note goes back, so other changes made meanwhile stay.
        setCuePoints((prev) =>
          prev.map((c) => (c.id === id && c.note === trimmed ? { ...c, note: current.note } : c))
        );
        setError((err as Error).message || t('cuePoints.errors.save'));
      }
    },
    [jobId, cuePoints, t]
  );

  const removeCuePoint = useCallback(
    async (id: number) => {
      if (!jobId) return;
      const removed = cuePoints.find((c) => c.id === id);
      if (!removed) return;
      setCuePoints((prev) => prev.filter((c) => c.id !== id));
      try {
        setError(null);
        await api.deleteCuePoint(jobId, id);
      } catch (err) {
        // Only this cue point comes back, so others removed meanwhile stay gone.
        setCuePoints((prev) =>
          prev.some((c) => c.id === id) ? prev : [...prev, removed].sort(byPosition)
        );
        setError((err as Error).message || t('cuePoints.errors.delete'));
      }
    },
    [jobId, cuePoints, t]
  );

  return { cuePoints, error, addedId, addCuePoint, updateNote, removeCuePoint };
}
