import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import FileUploadCard from './FileUploadCard';

function renderCard(overrides: Partial<Parameters<typeof FileUploadCard>[0]> = {}) {
  const props = {
    uploading: false,
    fileInputRef: createRef<HTMLInputElement>(),
    handleFileSelect: vi.fn(),
    handleDragOver: vi.fn(),
    handleDrop: vi.fn(),
    selectedLanguage: null,
    onLanguageChange: vi.fn(),
    ...overrides,
  };
  render(<FileUploadCard {...props} />);
  return props;
}

describe('FileUploadCard', () => {
  it('renders the language selector with an auto-detect default', () => {
    renderCard();
    expect(screen.getByText('Auto-detect')).toBeInTheDocument();
    expect(screen.getByText('English')).toBeInTheDocument();
  });

  it('reports a chosen language (and maps the empty option to null)', () => {
    const onLanguageChange = renderCard().onLanguageChange;
    const select = screen.getAllByRole('combobox')[0];

    fireEvent.change(select, { target: { value: 'es' } });
    expect(onLanguageChange).toHaveBeenCalledWith('es');

    fireEvent.change(select, { target: { value: '' } });
    expect(onLanguageChange).toHaveBeenCalledWith(null);
  });

  it('forwards a selected file to the handler', () => {
    const { handleFileSelect } = renderCard();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'meeting.mp3', { type: 'audio/mpeg' });

    fireEvent.change(input, { target: { files: [file] } });
    expect(handleFileSelect).toHaveBeenCalledTimes(1);
  });

  it('shows the upload limit set in the admin panel', () => {
    renderCard({ maxUploadMb: 250 });
    expect(
      screen.getByText('Supports MP3, WAV, M4A, WEBM, FLAC, OGG, AAC (max 250 MB)')
    ).toBeInTheDocument();
  });

  it('reports how many people speak, or automatic', () => {
    const onSpeakersChange = vi.fn();
    renderCard({ onSpeakersChange });
    const select = screen.getByLabelText('Number of speakers');
    expect(select).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Automatic' })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: '2' } });
    expect(onSpeakersChange).toHaveBeenCalledWith(2);
    fireEvent.change(select, { target: { value: '' } });
    expect(onSpeakersChange).toHaveBeenCalledWith(null);
  });
});
