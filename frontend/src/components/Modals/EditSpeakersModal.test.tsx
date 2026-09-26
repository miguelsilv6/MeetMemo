import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import EditSpeakersModal from './EditSpeakersModal';

function renderModal(overrides: Partial<ComponentProps<typeof EditSpeakersModal>> = {}) {
  const props = {
    show: true,
    onHide: vi.fn(),
    editingSpeakers: { SPEAKER_00: 'SPEAKER_00', SPEAKER_01: 'Ana' },
    setEditingSpeakers: vi.fn(),
    handleSaveSpeakers: vi.fn(),
    ...overrides,
  };
  render(<EditSpeakersModal {...props} />);
  return props;
}

describe('EditSpeakersModal', () => {
  it('shows one name field per speaker, filled with its current name', () => {
    renderModal();

    expect(screen.getByLabelText('SPEAKER_00')).toHaveValue('SPEAKER_00');
    expect(screen.getByLabelText('SPEAKER_01')).toHaveValue('Ana');
  });

  it('renames a speaker as the user types', () => {
    const props = renderModal();

    fireEvent.change(screen.getByLabelText('SPEAKER_00'), { target: { value: 'João Silva' } });

    expect(props.setEditingSpeakers).toHaveBeenCalledWith({
      SPEAKER_00: 'João Silva',
      SPEAKER_01: 'Ana',
    });
  });

  it('saves or cancels', () => {
    const props = renderModal();
    const dialog = screen.getByRole('dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: /save/i }));
    expect(props.handleSaveSpeakers).toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(props.onHide).toHaveBeenCalled();
  });

  it('offers no automatic name suggestions', () => {
    renderModal();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/suggestion/i)).not.toBeInTheDocument();
  });
});
