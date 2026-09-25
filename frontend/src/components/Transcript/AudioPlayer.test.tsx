import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

describe('AudioPlayer speed, zoom and shortcuts', () => {
  const PEAKS = [
    { min: -0.5, max: 0.5 },
    { min: -0.2, max: 0.3 },
  ];

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.getWaveformPeaks).mockResolvedValue({ peaks: PEAKS });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('.modal.show').forEach((el) => el.remove());
  });

  async function renderLoaded(duration = 120) {
    const view = render(<AudioPlayer jobId="job1" />);
    const audio = view.container.querySelector('audio') as HTMLAudioElement;
    makeCurrentTimeSettable(audio);
    setDuration(view.container, duration);
    await waitFor(() =>
      expect(view.container.querySelector('canvas.audio-waveform')).toBeInTheDocument()
    );
    return { ...view, audio };
  }

  function playTo(audio: HTMLAudioElement, time: number) {
    audio.currentTime = time;
    fireEvent.timeUpdate(audio);
  }

  it('changes the playback speed and remembers it', async () => {
    const { audio } = await renderLoaded();
    const select = screen.getByLabelText('Playback speed');

    fireEvent.change(select, { target: { value: '1.5' } });

    expect(audio.playbackRate).toBe(1.5);
    expect(localStorage.getItem('meetmemo-playback-rate')).toBe('1.5');
    expect(select.closest('.audio-speed')).toHaveClass('audio-speed-changed');
  });

  it('starts at the remembered playback speed', async () => {
    localStorage.setItem('meetmemo-playback-rate', '0.75');
    const { audio } = await renderLoaded();

    expect(screen.getByLabelText('Playback speed')).toHaveValue('0.75');
    expect(audio.playbackRate).toBe(0.75);
  });

  it('zooms the waveform, shows the visible range and loads its detailed peaks', async () => {
    await renderLoaded(120);
    expect(screen.getByText('Zoom 1×')).toBeInTheDocument();
    expect(screen.queryByLabelText('Move the zoomed waveform')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Zoom in on the waveform (+)'));

    expect(screen.getByText('Zoom 2×')).toBeInTheDocument();
    expect(screen.getByLabelText('Move the zoomed waveform')).toBeInTheDocument();
    expect(screen.getByTitle('Showing 0:00 – 1:00')).toBeInTheDocument();
    await waitFor(() => expect(api.getWaveformPeaks).toHaveBeenCalledWith('job1', 0, 60, 300));

    fireEvent.click(screen.getByTitle('Zoom out of the waveform (−)'));
    expect(screen.getByText('Zoom 1×')).toBeInTheDocument();
    expect(screen.queryByLabelText('Move the zoomed waveform')).not.toBeInTheDocument();
  });

  it('keeps the playhead in view while playing', async () => {
    const { audio } = await renderLoaded(120);
    fireEvent.click(screen.getByTitle('Zoom in on the waveform (+)'));
    fireEvent.click(screen.getByTitle('Zoom in on the waveform (+)'));
    expect(screen.getByText('Zoom 4×')).toBeInTheDocument();

    playTo(audio, 20);
    expect(screen.getByTitle('Showing 0:00 – 0:30')).toBeInTheDocument();

    playTo(audio, 50);
    expect(screen.getByTitle('Showing 0:47 – 1:17')).toBeInTheDocument();
  });

  it('pans the zoomed view with its slider without moving playback', async () => {
    const { audio } = await renderLoaded(120);
    fireEvent.click(screen.getByTitle('Zoom in on the waveform (+)'));

    fireEvent.change(screen.getByLabelText('Move the zoomed waveform'), {
      target: { value: '30' },
    });

    expect(screen.getByTitle('Showing 0:30 – 1:30')).toBeInTheDocument();
    expect(audio.currentTime).toBe(0);
  });

  it('supports keyboard shortcuts for play, seek, speed and zoom', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const { audio } = await renderLoaded(120);
    playTo(audio, 30);

    fireEvent.keyDown(document.body, { key: ' ' });
    expect(play).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(audio.currentTime).toBe(35);
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(audio.currentTime).toBe(30);

    fireEvent.keyDown(document.body, { key: '.' });
    expect(audio.playbackRate).toBe(1.25);
    fireEvent.keyDown(document.body, { key: ',' });
    fireEvent.keyDown(document.body, { key: ',' });
    expect(audio.playbackRate).toBe(0.75);

    fireEvent.keyDown(document.body, { key: '+' });
    expect(screen.getByText('Zoom 2×')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: '-' });
    expect(screen.getByText('Zoom 1×')).toBeInTheDocument();
  });

  it('ignores shortcuts while typing or while a dialog is open', async () => {
    const { audio } = await renderLoaded(120);
    playTo(audio, 30);
    const field = document.createElement('input');
    document.body.appendChild(field);

    fireEvent.keyDown(field, { key: 'ArrowRight' });
    fireEvent.keyDown(field, { key: '.' });
    expect(audio.currentTime).toBe(30);
    expect(audio.playbackRate).toBe(1);
    field.remove();

    const dialog = document.createElement('div');
    dialog.className = 'modal show';
    document.body.appendChild(dialog);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(audio.currentTime).toBe(30);
  });

  it('lists the shortcuts in a panel toggled from the player', async () => {
    await renderLoaded();
    const toggle = screen.getByTitle('Keyboard shortcuts');
    expect(screen.queryByText('Play / pause')).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Play / pause')).toBeInTheDocument();
    expect(screen.getByText('Back / forward 5 seconds')).toBeInTheDocument();
    expect(screen.getByText('Slower / faster')).toBeInTheDocument();
    expect(screen.getByText('Space')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByText('Play / pause')).not.toBeInTheDocument();
  });

  it('shows the Space shortcut in the play button tooltip', async () => {
    await renderLoaded();
    expect(screen.getByTitle('Play (Space)')).toBeInTheDocument();
  });
});
