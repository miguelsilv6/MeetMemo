import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useFileUpload from './useFileUpload';
import * as api from '../services/api';

vi.mock('../services/api');

function setup() {
  const setError = vi.fn();
  const setCurrentStep = vi.fn();
  const setProcessingProgress = vi.fn();
  const setJobId = vi.fn();
  const setTranscriptWithColors = vi.fn();
  const startPolling = vi.fn();
  const hook = renderHook(() =>
    useFileUpload(
      setError,
      setCurrentStep,
      setProcessingProgress,
      setJobId,
      setTranscriptWithColors,
      startPolling
    )
  );
  return { hook, setError, setCurrentStep, setJobId, startPolling, setTranscriptWithColors };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useFileUpload.handleUpload', () => {
  it('uploads a file and starts polling when the backend accepts it (202)', async () => {
    vi.mocked(api.uploadAudio).mockResolvedValue({ uuid: 'new-job', status_code: 202 });
    const { hook, setJobId, startPolling } = setup();
    const file = new File(['x'], 'meeting.mp3', { type: 'audio/mpeg' });

    await act(async () => {
      await hook.result.current.handleUpload(file);
    });

    expect(api.uploadAudio).toHaveBeenCalledWith(file, null, 'auto');
    expect(setJobId).toHaveBeenCalledWith('new-job');
    expect(startPolling).toHaveBeenCalledWith('new-job');
  });

  it('resumes an existing job without re-uploading', async () => {
    const { hook, setJobId, startPolling } = setup();

    await act(async () => {
      await hook.result.current.handleUpload(null, 'existing-job');
    });

    expect(api.uploadAudio).not.toHaveBeenCalled();
    expect(setJobId).toHaveBeenCalledWith('existing-job');
    expect(startPolling).toHaveBeenCalledWith('existing-job');
  });

  it('passes the selected language to the upload', async () => {
    vi.mocked(api.uploadAudio).mockResolvedValue({ uuid: 'j', status_code: 202 });
    const { hook } = setup();
    const file = new File(['x'], 'meeting.mp3');

    act(() => {
      hook.result.current.setSelectedLanguage('es');
    });
    await act(async () => {
      await hook.result.current.handleUpload(file);
    });

    expect(api.uploadAudio).toHaveBeenCalledWith(file, null, 'es');
  });

  it('preselects the admin default language until the user picks one', async () => {
    vi.mocked(api.uploadAudio).mockResolvedValue({ uuid: 'j', status_code: 202 });
    const { hook } = setup();

    act(() => hook.result.current.applyDefaultLanguage('pt'));
    expect(hook.result.current.selectedLanguage).toBe('pt');

    // An explicit "Auto-detect" choice sticks, and is sent as 'auto'.
    act(() => hook.result.current.setSelectedLanguage(null));
    act(() => hook.result.current.applyDefaultLanguage('pt'));
    expect(hook.result.current.selectedLanguage).toBeNull();

    const file = new File(['x'], 'call.wav');
    await act(async () => {
      await hook.result.current.handleUpload(file);
    });
    expect(api.uploadAudio).toHaveBeenCalledWith(file, null, 'auto');
  });

  it('normalizes the transcript on immediate completion (200)', async () => {
    vi.mocked(api.uploadAudio).mockResolvedValue({
      uuid: 'j',
      status_code: 200,
      transcript: {
        full_transcript: JSON.stringify([{ speaker: 'SPEAKER_00', start: 0, end: 1, text: 'hi' }]),
      },
    });
    const { hook, setTranscriptWithColors } = setup();
    const file = new File(['x'], 'meeting.mp3');

    await act(async () => {
      await hook.result.current.handleUpload(file);
    });

    expect(setTranscriptWithColors).toHaveBeenCalledWith(
      expect.objectContaining({
        segments: [{ speaker: 'SPEAKER_00', start: 0, end: 1, text: 'hi' }],
      })
    );
  });

  it('reports an error and returns to the upload step on failure', async () => {
    vi.mocked(api.uploadAudio).mockRejectedValue(new Error('too big'));
    const { hook, setError, setCurrentStep } = setup();
    const file = new File(['x'], 'meeting.mp3');

    await act(async () => {
      await hook.result.current.handleUpload(file);
    });

    expect(setError).toHaveBeenCalledWith('too big');
    expect(setCurrentStep).toHaveBeenCalledWith('upload');
  });
});
