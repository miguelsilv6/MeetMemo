import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CuePointList from './CuePointList';
import type { CuePoint } from '../../types/api';

const cue = (id: number, position: number, note = ''): CuePoint => ({
  id,
  position_seconds: position,
  note,
  created_by: 'ana',
  created_at: '2026-10-25T10:00:00Z',
  updated_at: '2026-10-25T10:00:00Z',
});

function renderList(overrides: Partial<ComponentProps<typeof CuePointList>> = {}) {
  const props = {
    cuePoints: [cue(1, 12, 'menciona a morada'), cue(2, 75)],
    addedId: null,
    error: null,
    onAdd: vi.fn(),
    onSeek: vi.fn(),
    onUpdateNote: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  };
  return { ...render(<CuePointList {...props} />), props };
}

describe('CuePointList', () => {
  it('explains how to add one while there are none', () => {
    const { props } = renderList({ cuePoints: [] });
    expect(screen.getByText(/Press M while listening/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Mark/ }));
    expect(props.onAdd).toHaveBeenCalled();
  });

  it('jumps to a cue point from its time', () => {
    const { props } = renderList();
    fireEvent.click(screen.getByRole('button', { name: '1:15' }));
    expect(props.onSeek).toHaveBeenCalledWith(75);
  });

  it('saves a note when leaving the field or on Enter', () => {
    const { props } = renderList();
    const note = screen.getByLabelText('Note for the cue point at 1:15');
    fireEvent.change(note, { target: { value: 'pede dinheiro' } });
    fireEvent.keyDown(note, { key: 'Enter' });
    fireEvent.blur(note);
    expect(props.onUpdateNote).toHaveBeenLastCalledWith(2, 'pede dinheiro');
  });

  it('Escape puts the saved note back', () => {
    const { props } = renderList();
    const note = screen.getByLabelText('Note for the cue point at 0:12') as HTMLInputElement;
    fireEvent.change(note, { target: { value: 'typo' } });
    fireEvent.keyDown(note, { key: 'Escape' });
    fireEvent.blur(note);
    expect(note.value).toBe('menciona a morada');
    expect(props.onUpdateNote).toHaveBeenLastCalledWith(1, 'menciona a morada');
  });

  it('removes a cue point', () => {
    const { props } = renderList();
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove cue point' })[1]);
    expect(props.onRemove).toHaveBeenCalledWith(2);
  });

  it('focuses the note of the cue point just added', () => {
    renderList({ addedId: 2 });
    expect(screen.getByLabelText('Note for the cue point at 1:15')).toHaveFocus();
  });
});
