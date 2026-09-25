import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import EditSpeakersModal from './EditSpeakersModal';

function renderModal(overrides: Partial<ComponentProps<typeof EditSpeakersModal>> = {}) {
  const props = {
    show: true,
    onHide: vi.fn(),
    editingSpeakers: { SPEAKER_00: 'SPEAKER_00', SPEAKER_01: 'SPEAKER_01' },
    setEditingSpeakers: vi.fn(),
    handleSaveSpeakers: vi.fn(),
    identifyingSpeakers: false,
    speakerSuggestions: { SPEAKER_00: 'Ana Costa', SPEAKER_01: 'Cannot be determined' },
    handleAcceptSuggestion: vi.fn(),
    handleRejectSuggestion: vi.fn(),
    ...overrides,
  };
  render(<EditSpeakersModal {...props} />);
  return props;
}

describe('EditSpeakersModal', () => {
  it('shows an AI suggestion for each speaker', () => {
    renderModal();

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toHaveTextContent('SPEAKER_00: Ana Costa');
    expect(alerts[1]).toHaveTextContent('SPEAKER_01: Cannot be determined');
  });

  it('accepts or dismisses a suggestion', () => {
    const props = renderModal();
    const [suggestion, undetermined] = screen.getAllByRole('alert');

    fireEvent.click(within(suggestion).getByTitle('Accept this suggestion'));
    expect(props.handleAcceptSuggestion).toHaveBeenCalledWith('SPEAKER_00', 'Ana Costa');

    // An undetermined suggestion can only be dismissed.
    expect(within(undetermined).queryByTitle('Accept this suggestion')).not.toBeInTheDocument();
    fireEvent.click(within(undetermined).getByTitle(/dismiss/i));
    expect(props.handleRejectSuggestion).toHaveBeenCalledWith('SPEAKER_01');
  });

  it('shows no suggestions section when there are none', () => {
    renderModal({ speakerSuggestions: null });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
