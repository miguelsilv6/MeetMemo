import { useEffect, useState } from 'react';
import * as api from '../services/api';
import type { WaveformPeak } from '../types/api';

interface UseWaveformPeaksResult {
  peaks: WaveformPeak[] | null;
  /** One envelope per channel (left first), when requested with `splitChannels`. */
  channelPeaks: WaveformPeak[][] | null;
  /** Number of channels in the recording, once known. */
  channels: number | null;
  /** The range `peaks` were computed for, which lags behind a changed range until it loads. */
  range: { start: number; end: number } | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches a downsampled waveform peak envelope for a time range (and, with
 * `splitChannels`, one per channel), for the audio player and the
 * split-segment scrubber. Requests are cancelled/ignored if the range
 * changes (or the hook unmounts) before the response arrives.
 */
export default function useWaveformPeaks(
  jobId: string | null,
  start: number,
  end: number,
  buckets = 100,
  splitChannels = false
): UseWaveformPeaksResult {
  const [peaks, setPeaks] = useState<WaveformPeak[] | null>(null);
  const [channelPeaks, setChannelPeaks] = useState<WaveformPeak[][] | null>(null);
  const [channels, setChannels] = useState<number | null>(null);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId || end <= start) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets state for an invalid/absent range; nothing to fetch
      setPeaks(null);
      setChannelPeaks(null);
      setRange(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .getWaveformPeaks(jobId, start, end, buckets, splitChannels)
      .then((response) => {
        if (cancelled) return;
        setPeaks(response.peaks);
        setChannelPeaks(response.channel_peaks ?? null);
        if (typeof response.channels === 'number') setChannels(response.channels);
        setRange({ start, end });
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setPeaks(null);
        setChannelPeaks(null);
        setRange(null);
        setError((err as Error).message || 'Failed to load waveform');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [jobId, start, end, buckets, splitChannels]);

  return { peaks, channelPeaks, channels, range, loading, error };
}
