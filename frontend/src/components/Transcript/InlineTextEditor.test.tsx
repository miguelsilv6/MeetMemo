import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import InlineTextEditor from './InlineTextEditor';

function renderEditor() {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const outside = { click: vi.fn(), keyDown: vi.fn(), pointerDown: vi.fn() };
  render(
    <div
      onClick={outside.click}
      onDoubleClick={outside.click}
      onKeyDown={outside.keyDown}
      onPointerDown={outside.pointerDown}
    >
      <InlineTextEditor text="Hello there" onSave={onSave} onCancel={onCancel} />
    </div>
  );
  return { field: screen.getByLabelText('Line text'), onSave, onCancel, outside };
}

describe('InlineTextEditor', () => {
  it('opens with the text, focused', () => {
    const { field } = renderEditor();
    expect(field).toHaveValue('Hello there');
    expect(field).toHaveFocus();
  });

  it('saves on Enter, and a new line with Shift+Enter does not', () => {
    const { field, onSave } = renderEditor();
    fireEvent.change(field, { target: { value: 'Hello, there' } });
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith('Hello, there');
  });

  it('cancels on Escape, and the blur that follows does not save', () => {
    const { field, onSave, onCancel } = renderEditor();
    fireEvent.change(field, { target: { value: 'changed' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    fireEvent.blur(field);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves once when the field is left', () => {
    const { field, onSave } = renderEditor();
    fireEvent.change(field, { target: { value: 'changed' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.blur(field);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('keeps clicks, keys and pointer presses from reaching the bubble', () => {
    const { field, outside } = renderEditor();
    fireEvent.click(field);
    fireEvent.doubleClick(field);
    fireEvent.pointerDown(field);
    fireEvent.keyDown(field, { key: ' ' });
    expect(outside.click).not.toHaveBeenCalled();
    expect(outside.pointerDown).not.toHaveBeenCalled();
    expect(outside.keyDown).not.toHaveBeenCalled();
  });
});
