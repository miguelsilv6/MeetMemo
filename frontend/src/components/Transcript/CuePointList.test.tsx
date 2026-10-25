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
  it('adds one with the button; an empty list has no text of its own', () => {
    const { props } = renderList({ cuePoints: [] });
    expect(screen.queryByText(/Press M while listening/)).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Mark$/ }));
    expect(props.onAdd).toHaveBeenCalled();
  });

  it('explains how to use cue points behind the "?"', () => {
    renderList();
    const help = screen.getByRole('button', { name: 'How to use cue points' });
    expect(help).toHaveAttribute('title', expect.stringMatching(/^Press M while listening/));
    expect(help).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(help);
    expect(help).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/^Press M while listening/, { selector: 'p' })).toBeInTheDocument();

    fireEvent.click(help);
    expect(
      screen.queryByText(/^Press M while listening/, { selector: 'p' })
    ).not.toBeInTheDocument();
  });

  it('jumps to a cue point from its time', () => {
    const { props } = renderList();
    fireEvent.click(screen.getByRole('button', { name: '1:15' }));
    expect(props.onSeek).toHaveBeenCalledWith(75);
  });

  it('shows each note as text, with no fields until one is edited', () => {
    renderList();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'menciona a morada' })).toBeInTheDocument();
    // A cue point without a note says so.
    expect(screen.getByRole('button', { name: 'No note' })).toHaveClass('cue-point-note-empty');
  });

  it('edits a note from the pencil or the note itself, saving on Enter', () => {
    const { props } = renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Note for the cue point at 1:15' }));
    const field = screen.getByRole('textbox', { name: 'Note for the cue point at 1:15' });
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: 'pede dinheiro' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(props.onUpdateNote).toHaveBeenCalledTimes(1);
    expect(props.onUpdateNote).toHaveBeenLastCalledWith(2, 'pede dinheiro');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'menciona a morada' }));
    expect(screen.getByRole('textbox')).toHaveValue('menciona a morada');
  });

  it('saves with ✓ or when leaving the field', () => {
    const { props } = renderList();
    fireEvent.click(screen.getByRole('button', { name: 'menciona a morada' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'morada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the note' }));
    expect(props.onUpdateNote).toHaveBeenLastCalledWith(1, 'morada');

    fireEvent.click(screen.getByRole('button', { name: 'No note' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'pausa longa' } });
    fireEvent.blur(screen.getByRole('textbox'));
    expect(props.onUpdateNote).toHaveBeenLastCalledWith(2, 'pausa longa');
  });

  it('Escape or ✗ leaves the note as it was', () => {
    const { props } = renderList();
    fireEvent.click(screen.getByRole('button', { name: 'menciona a morada' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'typo' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(props.onUpdateNote).toHaveBeenLastCalledWith(1, 'menciona a morada');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'menciona a morada' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'typo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onUpdateNote).toHaveBeenLastCalledWith(1, 'menciona a morada');
  });

  it('edits one note at a time', () => {
    renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Note for the cue point at 0:12' }));
    fireEvent.click(screen.getByRole('button', { name: 'Note for the cue point at 1:15' }));
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(
      screen.getByRole('textbox', { name: 'Note for the cue point at 1:15' })
    ).toBeInTheDocument();
  });

  it('removes a cue point', () => {
    const { props } = renderList();
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove cue point' })[1]);
    expect(props.onRemove).toHaveBeenCalledWith(2);
  });

  it('opens the note of the cue point just added', () => {
    renderList({ addedId: 2 });
    expect(screen.getByRole('textbox', { name: 'Note for the cue point at 1:15' })).toHaveFocus();
  });
});
