import { useRef, useState, useEffect, useCallback } from 'react';
import type { ChangeEvent, MouseEvent, RefObject } from 'react';
import { Card, Button } from '@govtechsg/sgds-react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  SkipBack,
  SkipForward,
  ZoomIn,
  ZoomOut,
  Keyboard,
  Gauge,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import * as api from '../../services/api';
import { formatTime } from '../../utils/timeFormat';
import {
  ARROW_SEEK_SECONDS,
  DEFAULT_PLAYBACK_RATE,
  PLAYBACK_RATES,
  ZOOM_LEVELS,
  clampViewStart,
  followViewStart,
  formatPlaybackRate,
  isTypingTarget,
  stepPlaybackRate,
  stepZoom,
  viewSpan,
  zoomViewStart,
} from '../../utils/playerView';
import useWaveformPeaks from '../../hooks/useWaveformPeaks';
import AudioWaveform from './AudioWaveform';
import type { RangePeaks } from './AudioWaveform';

// Resolution of the player's waveform, independent of audio length (and of
// the zoom level: a zoomed view fetches this many peaks for its own range).
const WAVEFORM_BUCKETS = 300;
// Wait for the view to settle (e.g. while panning) before fetching its peaks.
const DETAIL_FETCH_DELAY_MS = 250;
const PLAYBACK_RATE_STORAGE_KEY = 'meetmemo-playback-rate';

const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];

function readStoredPlaybackRate(): number {
  try {
    const stored = Number(localStorage.getItem(PLAYBACK_RATE_STORAGE_KEY));
    return (PLAYBACK_RATES as readonly number[]).includes(stored) ? stored : DEFAULT_PLAYBACK_RATE;
  } catch {
    return DEFAULT_PLAYBACK_RATE;
  }
}

function storePlaybackRate(rate: number): void {
  try {
    localStorage.setItem(PLAYBACK_RATE_STORAGE_KEY, String(rate));
  } catch {
    // Storage unavailable (private mode, blocked): the choice just isn't remembered.
  }
}

export interface AudioPlayerHandle {
  seekTo: (time: number) => void;
}

interface AudioPlayerProps {
  jobId: string | null;
  onTimeUpdate?: (time: number) => void;
  currentSegmentRef?: RefObject<AudioPlayerHandle | null>;
}

/**
 * AudioPlayer component with playback controls and progress tracking.
 * Syncs with transcript segments via onTimeUpdate callback. Supports
 * playback speed, waveform zoom (following the playhead) and keyboard
 * shortcuts, which are listed in a panel toggled from the player.
 */
export default function AudioPlayer({ jobId, onTimeUpdate, currentSegmentRef }: AudioPlayerProps) {
  const { t, i18n } = useTranslation();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(1);
  const [playbackRate, setPlaybackRate] = useState(readStoredPlaybackRate);
  const [zoom, setZoom] = useState<number>(1);
  const [viewStart, setViewStart] = useState(0);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Get audio URL
  const audioUrl = jobId ? api.getAudioUrl(jobId) : null;

  const span = viewSpan(duration, zoom);
  const viewEnd = viewStart + span;
  const isZoomed = zoom > 1;

  // Waveform peaks for the whole track (fetched once metadata gives us the
  // duration); falls back to the plain progress bar below while loading, on
  // error, or if there's nothing to show yet.
  const { peaks: waveformPeaks } = useWaveformPeaks(jobId, 0, duration, WAVEFORM_BUCKETS);

  // Detailed peaks for the zoomed view, fetched once the view stops moving.
  const [detailRange, setDetailRange] = useState<{ start: number; end: number } | null>(null);
  useEffect(() => {
    const timer = setTimeout(
      () => setDetailRange(isZoomed ? { start: viewStart, end: viewEnd } : null),
      DETAIL_FETCH_DELAY_MS
    );
    return () => clearTimeout(timer);
  }, [isZoomed, viewStart, viewEnd]);
  const { peaks: detailPeaksList, range: detailPeaksRange } = useWaveformPeaks(
    jobId,
    detailRange?.start ?? 0,
    detailRange?.end ?? 0,
    WAVEFORM_BUCKETS
  );
  const detailPeaks: RangePeaks | null =
    detailPeaksList && detailPeaksRange ? { ...detailPeaksRange, peaks: detailPeaksList } : null;

  // Keep the element's speed in sync (defaultPlaybackRate survives a reload of the source).
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.defaultPlaybackRate = playbackRate;
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Handle audio metadata loaded
  const handleLoadedMetadata = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
      setDuration(audioRef.current.duration);
      setIsLoading(false);
    }
  }, [playbackRate]);

  // Handle time update during playback (and after seeking): a zoomed view
  // follows the playhead.
  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      const time = audioRef.current.currentTime;
      setCurrentTime(time);
      setViewStart((start) => followViewStart(start, duration, zoom, time));
      if (onTimeUpdate) {
        onTimeUpdate(time);
      }
    }
  }, [onTimeUpdate, duration, zoom]);

  // Handle audio ended
  const handleEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);

  // Handle audio error
  const handleError = useCallback(() => {
    setError(t('audioPlayer.loadFailed'));
    setIsLoading(false);
  }, [t]);

  // Handle can play
  const handleCanPlay = useCallback(() => {
    setIsLoading(false);
    setError(null);
  }, []);

  // Toggle play/pause. isPlaying is driven authoritatively by the audio
  // element's onPlay/onPause handlers, so we don't set it optimistically here
  // (a rejected play() would otherwise leave isPlaying stuck true).
  const togglePlay = useCallback(() => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play().catch((err) => {
          console.error('Playback failed:', err);
          setError(t('audioPlayer.playbackFailed'));
        });
      }
    }
  }, [isPlaying, t]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  }, [isMuted]);

  // Seek to specific time
  const seekTo = useCallback(
    (time: number) => {
      if (audioRef.current) {
        audioRef.current.currentTime = Math.max(0, Math.min(time, duration));
      }
    },
    [duration]
  );

  // Handle progress bar click
  const handleProgressClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (progressRef.current && duration > 0) {
        const rect = progressRef.current.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const percentage = clickX / rect.width;
        const newTime = percentage * duration;
        seekTo(newTime);
      }
    },
    [duration, seekTo]
  );

  // Skip backward 10 seconds
  const skipBackward = useCallback(() => {
    seekTo(currentTime - 10);
  }, [currentTime, seekTo]);

  // Skip forward 10 seconds
  const skipForward = useCallback(() => {
    seekTo(currentTime + 10);
  }, [currentTime, seekTo]);

  // Handle volume change
  const handleVolumeChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
      audioRef.current.muted = newVolume === 0;
    }
    setIsMuted(newVolume === 0);
  }, []);

  const changePlaybackRate = useCallback((rate: number) => {
    setPlaybackRate(rate);
    storePlaybackRate(rate);
  }, []);

  // Zoom in (1) or out (-1), keeping `anchor` (default: the playhead) in place.
  const zoomBy = useCallback(
    (direction: 1 | -1, anchor: number = currentTime) => {
      const nextZoom = stepZoom(zoom, direction);
      if (nextZoom === zoom || duration <= 0) return;
      setViewStart(zoomViewStart(duration, viewStart, zoom, nextZoom, anchor));
      setZoom(nextZoom);
    },
    [zoom, duration, viewStart, currentTime]
  );

  const panBy = useCallback(
    (seconds: number) => {
      setViewStart((start) => clampViewStart(start + seconds, duration, zoom));
    },
    [duration, zoom]
  );

  // Relative seek from the element's own clock: React state only catches up
  // on the next timeupdate, so repeated key presses would otherwise stack
  // on a stale time.
  const seekBy = useCallback(
    (seconds: number) => seekTo((audioRef.current?.currentTime ?? 0) + seconds),
    [seekTo]
  );

  // Expose seekTo method for external segment clicks
  useEffect(() => {
    if (currentSegmentRef) {
      currentSegmentRef.current = { seekTo };
    }
  }, [currentSegmentRef, seekTo]);

  // Keyboard shortcuts. The listener is registered once and reads the latest
  // actions from a ref, so it isn't re-added on every time update.
  const shortcutActionsRef = useRef({
    togglePlay,
    seekBy: (seconds: number) => seekBy(seconds),
    stepRate: (direction: 1 | -1) => changePlaybackRate(stepPlaybackRate(playbackRate, direction)),
    zoomBy,
    enabled: !isLoading && !error,
  });
  useEffect(() => {
    shortcutActionsRef.current = {
      togglePlay,
      seekBy: (seconds: number) => seekBy(seconds),
      stepRate: (direction: 1 | -1) =>
        changePlaybackRate(stepPlaybackRate(playbackRate, direction)),
      zoomBy,
      enabled: !isLoading && !error,
    };
  });

  useEffect(() => {
    if (!jobId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const actions = shortcutActionsRef.current;
      if (!actions.enabled || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      // Leave the page alone while a dialog is open (e.g. editing a segment).
      if (document.querySelector('.modal.show')) return;

      switch (e.key) {
        case ' ':
          // A focused button already reacts to Space itself.
          if (e.target instanceof HTMLElement && e.target.closest('button, [role="button"]')) {
            return;
          }
          actions.togglePlay();
          break;
        case 'ArrowLeft':
          actions.seekBy(-ARROW_SEEK_SECONDS);
          break;
        case 'ArrowRight':
          actions.seekBy(ARROW_SEEK_SECONDS);
          break;
        case ',':
          actions.stepRate(-1);
          break;
        case '.':
          actions.stepRate(1);
          break;
        case '-':
          actions.zoomBy(-1);
          break;
        case '+':
        case '=':
          actions.zoomBy(1);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [jobId]);

  // Calculate progress percentage
  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (!jobId) {
    return null;
  }

  const keySpace = t('audioPlayer.keySpace');

  return (
    <Card className="audio-player-card mb-3">
      <Card.Body className="p-3">
        <div className="audio-player">
          {/* Hidden audio element */}
          <audio
            ref={audioRef}
            src={audioUrl ?? undefined}
            preload="metadata"
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onEnded={handleEnded}
            onError={handleError}
            onCanPlay={handleCanPlay}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />

          {/* Error display */}
          {error && <div className="audio-error text-danger small mb-2">{error}</div>}

          {/* Loading state */}
          {isLoading && !error && (
            <div className="audio-loading text-muted small mb-2">{t('audioPlayer.loading')}</div>
          )}

          {/* Progress: waveform when available, falling back to a plain bar */}
          {waveformPeaks && waveformPeaks.length > 0 ? (
            <div className="mb-2">
              <AudioWaveform
                peaks={waveformPeaks}
                duration={duration}
                currentTime={currentTime}
                onSeek={seekTo}
                viewStart={isZoomed ? viewStart : 0}
                viewEnd={isZoomed ? viewEnd : duration}
                detailPeaks={detailPeaks}
                onZoom={zoomBy}
                onPan={panBy}
              />
              {isZoomed && (
                <div className="audio-zoom-view d-flex align-items-center gap-2 mt-1">
                  <small className="text-muted audio-zoom-edge">{formatTime(viewStart)}</small>
                  <input
                    type="range"
                    className="audio-zoom-pan flex-grow-1"
                    min={0}
                    max={Math.max(0, duration - span)}
                    step={span / 100 || 1}
                    value={viewStart}
                    onChange={(e) => panBy(Number(e.target.value) - viewStart)}
                    aria-label={t('audioPlayer.panView')}
                    title={t('audioPlayer.viewRange', {
                      start: formatTime(viewStart),
                      end: formatTime(viewEnd),
                    })}
                  />
                  <small className="text-muted audio-zoom-edge">{formatTime(viewEnd)}</small>
                </div>
              )}
            </div>
          ) : (
            <div
              ref={progressRef}
              className="audio-progress-container"
              onClick={handleProgressClick}
              role="slider"
              aria-label={t('audioPlayer.progress')}
              aria-valuenow={currentTime}
              aria-valuemin={0}
              aria-valuemax={duration}
              tabIndex={0}
            >
              <div className="audio-progress-bar">
                <div className="audio-progress-fill" style={{ width: `${progressPercentage}%` }} />
                <div className="audio-progress-handle" style={{ left: `${progressPercentage}%` }} />
              </div>
            </div>
          )}

          {/* Time display */}
          <div className="audio-time-display d-flex justify-content-between mb-2">
            <small className="text-muted">{formatTime(currentTime)}</small>
            <small className="text-muted">{formatTime(duration)}</small>
          </div>

          {/* Controls */}
          <div className="audio-controls d-flex align-items-center justify-content-center gap-2">
            {/* Skip backward */}
            <Button
              variant="link"
              size="sm"
              className="audio-control-btn p-1"
              onClick={skipBackward}
              title={t('audioPlayer.skipBack')}
              disabled={isLoading}
            >
              <SkipBack size={18} />
            </Button>

            {/* Play/Pause */}
            <Button
              variant="primary"
              size="sm"
              className="audio-play-btn rounded-circle p-2"
              onClick={togglePlay}
              title={`${isPlaying ? t('audioPlayer.pause') : t('audioPlayer.play')} (${keySpace})`}
              disabled={isLoading || !!error}
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </Button>

            {/* Skip forward */}
            <Button
              variant="link"
              size="sm"
              className="audio-control-btn p-1"
              onClick={skipForward}
              title={t('audioPlayer.skipForward')}
              disabled={isLoading}
            >
              <SkipForward size={18} />
            </Button>

            {/* Volume control */}
            <div className="audio-volume-control d-flex align-items-center ms-3">
              <Button
                variant="link"
                size="sm"
                className="audio-control-btn p-1"
                onClick={toggleMute}
                title={isMuted ? t('audioPlayer.unmute') : t('audioPlayer.mute')}
              >
                {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </Button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="audio-volume-slider"
                aria-label={t('audioPlayer.volume')}
              />
            </div>
          </div>

          {/* Speed, zoom and shortcuts */}
          <div className="audio-tools d-flex flex-wrap align-items-center justify-content-center gap-3 mt-2">
            <label
              className={`audio-speed d-flex align-items-center gap-1 ${
                playbackRate !== DEFAULT_PLAYBACK_RATE ? 'audio-speed-changed' : ''
              }`}
              title={`${t('audioPlayer.playbackSpeed')} (, .)`}
            >
              <Gauge size={16} aria-hidden="true" />
              <select
                className="form-select form-select-sm audio-speed-select"
                value={playbackRate}
                onChange={(e) => changePlaybackRate(Number(e.target.value))}
                aria-label={t('audioPlayer.playbackSpeed')}
              >
                {PLAYBACK_RATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {formatPlaybackRate(rate, i18n.language)}
                  </option>
                ))}
              </select>
            </label>

            <div
              className="audio-zoom-controls d-flex align-items-center gap-1"
              role="group"
              aria-label={t('audioPlayer.zoomGroup')}
            >
              <Button
                variant="link"
                size="sm"
                className="audio-control-btn p-1"
                onClick={() => zoomBy(-1)}
                disabled={zoom <= 1 || duration <= 0}
                title={`${t('audioPlayer.zoomOut')} (−)`}
              >
                <ZoomOut size={18} />
              </Button>
              <small className="audio-zoom-level text-muted" aria-live="polite">
                {t('audioPlayer.zoomLevel', { level: zoom })}
              </small>
              <Button
                variant="link"
                size="sm"
                className="audio-control-btn p-1"
                onClick={() => zoomBy(1)}
                disabled={zoom >= MAX_ZOOM || duration <= 0}
                title={`${t('audioPlayer.zoomIn')} (+)`}
              >
                <ZoomIn size={18} />
              </Button>
            </div>

            <Button
              variant="link"
              size="sm"
              className={`audio-control-btn p-1 ${showShortcuts ? 'active' : ''}`}
              onClick={() => setShowShortcuts((shown) => !shown)}
              aria-expanded={showShortcuts}
              aria-controls="audio-shortcuts"
              title={t('audioPlayer.shortcuts')}
            >
              <Keyboard size={18} />
            </Button>
          </div>

          {showShortcuts && (
            <div id="audio-shortcuts" className="audio-shortcuts mt-2">
              <h6 className="audio-shortcuts-title">{t('audioPlayer.shortcuts')}</h6>
              <dl className="mb-1">
                <dt>
                  <kbd>{keySpace}</kbd>
                </dt>
                <dd>{t('audioPlayer.shortcutPlayPause')}</dd>
                <dt>
                  <kbd>←</kbd> <kbd>→</kbd>
                </dt>
                <dd>{t('audioPlayer.shortcutSeek', { seconds: ARROW_SEEK_SECONDS })}</dd>
                <dt>
                  <kbd>,</kbd> <kbd>.</kbd>
                </dt>
                <dd>{t('audioPlayer.shortcutSpeed')}</dd>
                <dt>
                  <kbd>−</kbd> <kbd>+</kbd>
                </dt>
                <dd>{t('audioPlayer.shortcutZoom')}</dd>
                <dt>
                  <kbd>Ctrl</kbd> + {t('audioPlayer.mouseWheel')}
                </dt>
                <dd>{t('audioPlayer.shortcutWheelZoom')}</dd>
                <dt>
                  <kbd>Shift</kbd> + {t('audioPlayer.mouseWheel')}
                </dt>
                <dd>{t('audioPlayer.shortcutWheelPan')}</dd>
              </dl>
              <small className="text-muted">{t('audioPlayer.shortcutsNote')}</small>
            </div>
          )}
        </div>
      </Card.Body>
    </Card>
  );
}
