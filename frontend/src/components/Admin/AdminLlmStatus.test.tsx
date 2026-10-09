import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminLlmStatus from './AdminLlmStatus';
import * as adminApi from '../../services/adminApi';
import type { LlmStatus } from '../../types/admin';
import { formatDateTime } from '../../utils/projectDates';

vi.mock('../../services/adminApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/adminApi')>();
  return { ...actual, getLlmStatus: vi.fn() };
});

const ollama: LlmStatus = {
  url: 'http://ollama:11434',
  configured_model: 'qwen3:1.7b',
  reachable: true,
  server: 'ollama',
  version: '0.12.3',
  latency_ms: 35,
  model_available: true,
  model_loaded: true,
  available_models: [
    { name: 'qwen3:1.7b', size: 1_400_000_000, parameter_size: '2.0B', quantization: 'Q4_K_M' },
    { name: 'llama3.2:latest', size: 2_000_000_000 },
  ],
  loaded_models: [
    {
      name: 'qwen3:1.7b',
      size: 2_100_000_000,
      size_vram: 0,
      expires_at: '2026-10-09T01:10:00Z',
    },
  ],
  error: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AdminLlmStatus', () => {
  it('checks the server when its tab opens, not before', async () => {
    vi.mocked(adminApi.getLlmStatus).mockResolvedValue(ollama);
    const { rerender } = render(<AdminLlmStatus active={false} onUnauthorized={vi.fn()} />);
    expect(adminApi.getLlmStatus).not.toHaveBeenCalled();

    rerender(<AdminLlmStatus active onUnauthorized={vi.fn()} />);
    expect(await screen.findByText('Available')).toHaveClass('bg-success');
    expect(adminApi.getLlmStatus).toHaveBeenCalledTimes(1);
  });

  it('shows the Ollama server, the configured model and what is loaded', async () => {
    vi.mocked(adminApi.getLlmStatus).mockResolvedValue(ollama);
    render(<AdminLlmStatus active onUnauthorized={vi.fn()} />);

    expect(await screen.findByText('Ollama 0.12.3')).toBeInTheDocument();
    expect(screen.getByText('answers in 35 ms')).toBeInTheDocument();
    expect(screen.getByText('http://ollama:11434')).toBeInTheDocument();
    expect(screen.getByText('installed')).toHaveClass('bg-success');
    expect(screen.getByText('loaded in memory')).toHaveClass('bg-success');
    const row = screen.getAllByText('qwen3:1.7b')[1].closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('2.1 GB');
    expect(row).toHaveTextContent('0 MB'); // on CPU: nothing in VRAM
    expect(row).toHaveTextContent(formatDateTime('2026-10-09T01:10:00Z', 'en'));
    expect(screen.getByText('2 models installed on the server')).toBeInTheDocument();

    vi.mocked(adminApi.getLlmStatus).mockResolvedValue({ ...ollama, loaded_models: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText(/No model loaded/)).toBeInTheDocument();
    expect(adminApi.getLlmStatus).toHaveBeenCalledTimes(2);
  });

  it('reports a server that is down and a model that is missing', async () => {
    vi.mocked(adminApi.getLlmStatus).mockResolvedValue({
      ...ollama,
      reachable: false,
      server: null,
      version: null,
      latency_ms: null,
      model_available: null,
      model_loaded: null,
      available_models: [],
      loaded_models: null,
      error: 'Connection refused or host unreachable.',
    });
    render(<AdminLlmStatus active onUnauthorized={vi.fn()} />);

    expect(await screen.findByText('Unavailable')).toHaveClass('bg-danger');
    expect(screen.getByText('Connection refused or host unreachable.')).toBeInTheDocument();
  });

  it('says what an OpenAI-compatible server cannot tell', async () => {
    vi.mocked(adminApi.getLlmStatus).mockResolvedValue({
      ...ollama,
      server: 'openai',
      version: null,
      model_available: false,
      model_loaded: null,
      loaded_models: null,
      available_models: [{ name: 'other-model', size: null }],
    });
    render(<AdminLlmStatus active onUnauthorized={vi.fn()} />);

    expect(await screen.findByText('OpenAI-compatible (not Ollama)')).toBeInTheDocument();
    expect(screen.getByText('not installed')).toHaveClass('bg-danger');
    expect(screen.getByText(/does not say which models are loaded/)).toBeInTheDocument();
  });

  it('asks to sign in again when the session expired', async () => {
    const onUnauthorized = vi.fn();
    vi.mocked(adminApi.getLlmStatus).mockRejectedValue(
      new adminApi.AdminApiError(401, 'Not authenticated')
    );
    render(<AdminLlmStatus active onUnauthorized={onUnauthorized} />);
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalled());
  });
});
