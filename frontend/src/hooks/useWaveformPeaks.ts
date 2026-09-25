import { useEffect, useState } from 'react';
import * as api from '../services/api';
import type { WaveformPeak } from '../types/api';

interface UseWaveformPeaksResult {
  peaks: WaveformPeak[] | null;
  /** The range `peaks` were computed for, which lags behind a changed range until it loads. */
  range: { start: number; end: number } | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches a downsampled waveform peak envelope for a time range, for the
 * split-segment scrubber. Requests are cancelled/ignored if the range
 * changes (or the hook unmounts) before the response arrives.
 */
export default function useWaveformPeaks(
  jobId: string | null,
  start: number,
  end: number,
  buckets = 100
): UseWaveformPeaksResult {
  const [peaks, setPeaks] = useState<WaveformPeak[] | null>(null);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId || end <= start) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets state for an invalid/absent range; nothing to fetch
      setPeaks(null);
      setRange(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .getWaveformPeaks(jobId, start, end, buckets)
      .then((response) => {
        if (cancelled) return;
        setPeaks(response.peaks);
        setRange({ start, end });
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setPeaks(null);
        setRange(null);
        setError((err as Error).message || 'Failed to load waveform');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [jobId, start, end, buckets]);

  return { peaks, range, loading, error };
}
