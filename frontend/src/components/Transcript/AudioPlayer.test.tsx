import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import AudioPlayer from './AudioPlayer';
import * as api from '../../services/api';

vi.mock('../../services/api');

function setDuration(container: HTMLElement, seconds: number) {
  const audio = container.querySelector('audio') as HTMLAudioElement;
  Object.defineProperty(audio, 'duration', { value: seconds, configurable: true });
  fireEvent.loadedMetadata(audio);
}

// jsdom's <audio> has no real media pipeline, so a plain `currentTime = x`
// assignment is silently dropped; back it with a real value so the setter
// actually sticks and can be asserted on.
function makeCurrentTimeSettable(audio: HTMLAudioElement) {
  let value = 0;
  Object.defineProperty(audio, 'currentTime', {
    get: () => value,
    set: (v: number) => {
      value = v;
    },
    configurable: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getAudioUrl).mockReturnValue('/api/v1/jobs/job1/audio');
});

describe('AudioPlayer', () => {
  it('renders nothing without a jobId', () => {
    const { container } = render(<AudioPlayer jobId={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the waveform once peaks load, replacing the plain progress bar', async () => {
    vi.mocked(api.getWaveformPeaks).mockResolvedValue({
      peaks: [
        { min: -0.5, max: 0.5 },
        { min: -0.2, max: 0.3 },
      ],
    });
    const { container } = render(<AudioPlayer jobId="job1" />);
    setDuration(container, 120);

    await waitFor(() =>
      expect(container.querySelector('canvas.audio-waveform')).toBeInTheDocument()
    );
    expect(container.querySelector('.audio-progress-container')).not.toBeInTheDocument();
  });

  it('falls back to the plain progress bar when there are no peaks', async () => {
    vi.mocked(api.getWaveformPeaks).mockResolvedValue({ peaks: [] });
    const { container } = render(<AudioPlayer jobId="job1" />);
    setDuration(container, 120);

    await waitFor(() => expect(api.getWaveformPeaks).toHaveBeenCalled());
    expect(container.querySelector('.audio-progress-container')).toBeInTheDocument();
    expect(container.querySelector('canvas.audio-waveform')).not.toBeInTheDocument();
  });

  it('falls back to the plain progress bar while peaks are still loading', () => {
    vi.mocked(api.getWaveformPeaks).mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = render(<AudioPlayer jobId="job1" />);
    setDuration(container, 120);

    expect(container.querySelector('.audio-progress-container')).toBeInTheDocument();
    expect(container.querySelector('canvas.audio-waveform')).not.toBeInTheDocument();
  });
});

describe('AudioPlayer waveform seeking', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 48,
      left: 0,
      top: 0,
      right: 800,
      bottom: 48,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('seeking via the waveform updates the underlying audio element', async () => {
    vi.mocked(api.getWaveformPeaks).mockResolvedValue({
      peaks: [
        { min: -0.5, max: 0.5 },
        { min: -0.2, max: 0.3 },
      ],
    });
    const { container } = render(<AudioPlayer jobId="job1" />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    makeCurrentTimeSettable(audio);
    setDuration(container, 100);

    await waitFor(() =>
      expect(container.querySelector('canvas.audio-waveform')).toBeInTheDocument()
    );
    const canvas = container.querySelector('canvas.audio-waveform') as HTMLElement;
    fireEvent.pointerDown(canvas, { clientX: 400, pointerId: 1 });

    expect(audio.currentTime).toBe(50);
  });
});
