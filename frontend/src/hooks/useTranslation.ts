import { useState } from 'react';
import { useTranslation as useI18n } from 'react-i18next';
import * as api from '../services/api';
import type { TranscriptSegment } from '../types/api';
import type { SetError } from '../types/ui';

/**
 * Custom hook for on-demand transcript translation (default target: Portuguese).
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
      const result = await api.translateTranscript(jobId, 'pt');
      setTranslatedSegments(result.segments ?? null);
      setTranslatedFor(segments);
      setShowTranslation(true);
    } catch (err) {
      setError((err as Error).message || t('errors.translateTranscript'));
    } finally {
      setTranslating(false);
    }
  };

  return {
    translatedSegments: showTranslation ? translatedSegments : null,
    translating,
    showTranslation,
    handleToggleTranslation,
  };
}
