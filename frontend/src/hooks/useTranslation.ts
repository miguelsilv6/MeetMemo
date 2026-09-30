import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation as useI18n } from 'react-i18next';
import * as api from '../services/api';
import type { TranscriptSegment, TranslateResponse, TranslationEngine } from '../types/api';
import type { SetError } from '../types/ui';
import { LLM_POLL_MS, isTaskActive, llmTaskError, sleep } from '../utils/llmTasks';

export interface TranslationProgress {
  done: number;
  total: number;
  /** Still waiting in the server's queue, behind `position` other tasks. */
  queued?: boolean;
  position?: number | null;
  /** NLLB-200 is being downloaded/loaded before translating (first use). */
  preparing?: boolean;
}

const isReady = (response: TranslateResponse) =>
  response.status === 'original' || response.status === 'cached';

/**
 * Custom hook for on-demand transcript translation into European Portuguese.
 *
 * The server translates in the background (a task it runs block by block,
 * saving each block): asking starts or rejoins that task, and the hook polls
 * its progress until the translation is ready. No request waits on the
 * language model, so no proxy timeout can cut it, and leaving the page does
 * not stop it: opening the transcript again picks the progress back up.
 *
 * Translations are cached in component state keyed by the exact `segments`
 * array they were generated from; if the transcript changes (e.g. a segment is
 * edited), the cached translation is treated as stale and refetched on the
 * next toggle. The backend caches translations on disk as well, so re-fetching
 * an unchanged transcript is cheap.
 */
export default function useTranslation(jobId: string | null, setError: SetError) {
  const { t } = useI18n();
  const [translatedSegments, setTranslatedSegments] = useState<TranscriptSegment[] | null>(null);
  const [translatedFor, setTranslatedFor] = useState<TranscriptSegment[] | undefined>(undefined);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translationProgress, setTranslationProgress] = useState<TranslationProgress | null>(null);
  const [translationEngine, setTranslationEngine] = useState<TranslationEngine | null>(null);
  // Bumped whenever the job changes, so a poll for the previous one stops.
  const generation = useRef(0);

  const progressOf = (response: TranslateResponse): TranslationProgress => {
    const task = response.task;
    return {
      done: task?.progress_done ?? 0,
      total: task?.progress_total || response.total || 0,
      queued: task?.status === 'queued',
      position: task?.queue_position ?? null,
      preparing: response.engine === 'nllb' && task?.status === 'running' && !task.progress_total,
    };
  };

  /**
   * Poll the translation task until it ends. Returns the response once the
   * translation is ready, or null if it failed (the error is shown), ended
   * without one, or the job changed meanwhile.
   */
  const follow = useCallback(
    async (uuid: string, first: TranslateResponse): Promise<TranslateResponse | null> => {
      const mine = generation.current;
      let response = first;
      setTranslating(true);
      try {
        while (isTaskActive(response.task) && !isReady(response)) {
          setTranslationProgress(progressOf(response));
          await sleep(LLM_POLL_MS);
          if (generation.current !== mine) return null;
          response = await api.getTranslation(uuid);
          if (generation.current !== mine) return null;
        }
        if (isReady(response)) return response;
        if (response.task?.status === 'error') setError(llmTaskError(response.task, t));
        return null;
      } finally {
        if (generation.current === mine) {
          setTranslating(false);
          setTranslationProgress(null);
        }
      }
    },
    [setError, t]
  );

  // Opening a transcript whose translation is still being made shows its
  // progress again (it is not shown by itself when it ends: one click does).
  // Only the job matters here (follow changes with setError's identity).
  const followRef = useRef(follow);
  useEffect(() => {
    followRef.current = follow;
  }, [follow]);
  useEffect(() => {
    generation.current += 1;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when the job changes
    setTranslating(false);
    setTranslationProgress(null);
    if (!jobId) return;
    const mine = generation.current;
    const resume = async () => {
      try {
        const response = await api.getTranslation(jobId);
        if (generation.current === mine && isTaskActive(response?.task)) {
          await followRef.current(jobId, response);
        }
      } catch {
        // No transcript yet, or no access: nothing to resume.
      }
    };
    resume();
  }, [jobId]);

  const handleToggleTranslation = async (segments: TranscriptSegment[] | undefined) => {
    if (showTranslation) {
      setShowTranslation(false);
      return;
    }

    const isStale = translatedFor !== segments;
    if (translatedSegments && !isStale) {
      setShowTranslation(true);
      return;
    }

    if (!jobId || !segments || segments.length === 0) return;

    try {
      setTranslating(true);
      setError(null);
      const response = await follow(jobId, await api.translateTranscript(jobId));
      if (!response) return;
      setTranslatedSegments(response.segments ?? []);
      setTranslationEngine(response.engine ?? 'llm');
      setTranslatedFor(segments);
      setShowTranslation(true);
    } catch (err) {
      setError((err as Error).message || t('errors.translateTranscript'));
      setTranslating(false);
      setTranslationProgress(null);
    }
  };

  return {
    translatedSegments: showTranslation ? translatedSegments : null,
    translating,
    translationProgress,
    translationEngine: showTranslation ? translationEngine : null,
    showTranslation,
    handleToggleTranslation,
  };
}
