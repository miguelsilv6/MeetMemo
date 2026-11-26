import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProjectUploadCard from './ProjectUploadCard';
import * as api from '../../services/api';
import * as projectsApi from '../../services/projectsApi';

vi.mock('../../services/api', () => ({
  getPublicConfig: vi.fn().mockResolvedValue({ max_upload_mb: 100 }),
  uploadCallRecord: vi.fn(),
}));
vi.mock('../../services/projectsApi', () => ({ uploadProjectAudios: vi.fn() }));

function inFolder(path: string): File {
  const file = new File(['x'], path.slice(path.lastIndexOf('/') + 1));
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProjectUploadCard with a case folder', () => {
  it('uploads each product’s audio, then its TranslatedPRI.xml', async () => {
    vi.mocked(projectsApi.uploadProjectAudios).mockImplementation(async (_p, [file]) => [
      file.name === 'b.wav'
        ? { file_name: 'b.wav', status: 'duplicate', detail: 'old.wav' }
        : { file_name: file.name, status: 'queued', uuid: `uuid-${file.name}` },
    ]);
    vi.mocked(api.uploadCallRecord).mockImplementation(async (uuid) => {
      if (uuid === 'uuid-c.wav') throw new Error('Not a readable XML file');
      return {} as never;
    });
    const onUploaded = vi.fn();
    render(<ProjectUploadCard projectUuid="p1" onUploaded={onUploaded} />);
    const records = {
      a: inFolder('Caso/2414/TranslatedPRI.xml'),
      b: inFolder('Caso/2415/TranslatedPRI.xml'),
      c: inFolder('Caso/2416/TranslatedPRI.xml'),
    };

    fireEvent.change(screen.getByLabelText('Choose folder'), {
      target: {
        files: [
          inFolder('Caso/2414/__CLIENT__/a.wav'),
          records.a,
          inFolder('Caso/2414/RawData/a.vsf'),
          inFolder('Caso/2415/__CLIENT__/b.wav'),
          records.b,
          inFolder('Caso/2416/__CLIENT__/c.wav'),
          records.c,
          inFolder('Caso/2417/__CLIENT__/d.wav'), // no record
        ],
      },
    });

    await waitFor(() => expect(projectsApi.uploadProjectAudios).toHaveBeenCalledTimes(4));
    expect(
      vi.mocked(projectsApi.uploadProjectAudios).mock.calls.map(([, [file]]) => file.name)
    ).toEqual(['a.wav', 'b.wav', 'c.wav', 'd.wav']);
    // Only to the audios just created; never to the one already in the project.
    expect(api.uploadCallRecord).toHaveBeenCalledWith('uuid-a.wav', records.a);
    expect(api.uploadCallRecord).toHaveBeenCalledWith('uuid-c.wav', records.c);
    expect(api.uploadCallRecord).toHaveBeenCalledTimes(2);

    expect(await screen.findByText(/call data imported/)).toBeInTheDocument();
    expect(
      screen.getByText(/call data not attached \(the audio already existed\)/)
    ).toBeInTheDocument();
    expect(screen.getByText(/call data not imported: Not a readable XML file/)).toBeInTheDocument();
    expect(onUploaded).toHaveBeenCalledTimes(4);
  });

  it('says when the folder has no audio', async () => {
    render(<ProjectUploadCard projectUuid="p1" onUploaded={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Choose folder'), {
      target: { files: [inFolder('Caso/2414/TranslatedPRI.xml')] },
    });

    expect(await screen.findByText(/The chosen folder has no audio/)).toBeInTheDocument();
    expect(projectsApi.uploadProjectAudios).not.toHaveBeenCalled();
  });

  it('uploads chosen audio files as before, without call data', async () => {
    vi.mocked(projectsApi.uploadProjectAudios).mockResolvedValue([
      { file_name: 'a.wav', status: 'queued', uuid: 'u1' },
    ]);
    render(<ProjectUploadCard projectUuid="p1" onUploaded={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Choose one or more files'), {
      target: { files: [new File(['x'], 'a.wav')] },
    });

    expect(await screen.findByText('a.wav')).toBeInTheDocument();
    expect(api.uploadCallRecord).not.toHaveBeenCalled();
  });
});
