import { useState } from 'react';
import { useTranslation as useI18n } from 'react-i18next';
import * as api from '../services/api';
import type { TranscriptSegment } from '../types/api';
import type { SetError } from '../types/ui';

/** Segments requested per call: each call stays well inside the LLM timeout. */
export const TRANSLATION_BLOCK_SIZE = 15;

export interface TranslationProgress {
  done: number;
  total: number;
}

/**
 * Custom hook for on-demand transcript translation into European Portuguese.
 *
 * The transcript is translated block by block (TRANSLATION_BLOCK_SIZE segments
 * per request), reporting progress as it goes. The backend keeps finished
 * blocks, so retrying after a failure resumes instead of starting over.
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
      const collected: TranscriptSegment[] = [];
      let total = segments.length;
      setTranslationProgress({ done: 0, total });
      while (collected.length < total) {
        const result = await api.translateTranscript(
          jobId,
          collected.length,
          TRANSLATION_BLOCK_SIZE
        );
        const block = result.segments ?? [];
        if (typeof result.total === 'number') total = result.total;
        if (block.length === 0) break;
        collected.push(...block);
        setTranslationProgress({ done: Math.min(collected.length, total), total });
      }
      setTranslatedSegments(collected);
      setTranslatedFor(segments);
      setShowTranslation(true);
    } catch (err) {
      setError((err as Error).message || t('errors.translateTranscript'));
    } finally {
      setTranslating(false);
      setTranslationProgress(null);
    }
  };

  return {
    translatedSegments: showTranslation ? translatedSegments : null,
    translating,
    translationProgress,
    showTranslation,
    handleToggleTranslation,
  };
}
