import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProjectAudioList from './ProjectAudioList';
import type { ProjectAudio } from '../../types/projects';

const audio = (overrides: Partial<ProjectAudio>): ProjectAudio => ({
  uuid: 'a1',
  file_name: 'e153c371.wav',
  status: 'completed',
  workflow_state: 'completed',
  progress: 100,
  queue_position: null,
  error_message: null,
  language: null,
  created_at: '2026-11-26T15:00:00Z',
  ...overrides,
});

describe('ProjectAudioList call data', () => {
  it('shows who called whom, when and for how long, for an audio with call data', () => {
    render(
      <ProjectAudioList
        audios={[
          audio({
            call: {
              caller: '351912052349',
              callee: '+351915592482',
              start: '17-11-2026 20:31:50',
              duration_seconds: 58,
            },
          }),
          audio({ uuid: 'a2', file_name: 'other.wav', call: null }),
        ]}
        onOpen={vi.fn()}
        onRetry={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const [line] = screen.getAllByTestId('audio-call');
    expect(line).toHaveTextContent('351912052349 → +351915592482 · 17-11-2026 20:31:50 · 0:58');
    expect(screen.getAllByTestId('audio-call')).toHaveLength(1); // not for the other audio
  });
});
