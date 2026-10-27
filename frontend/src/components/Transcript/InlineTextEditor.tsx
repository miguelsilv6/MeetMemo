import { useLayoutEffect, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * A line's text edited right in its bubble (opened with a double click):
 * Enter saves, Shift+Enter starts a new line, Escape cancels, and leaving the
 * field saves too (nothing typed is lost). Clicks, keys and pointer presses
 * stay in the field, so the bubble does not play, seek or start a drag.
 */
export default function InlineTextEditor({
  text,
  onSave,
  onCancel,
}: {
  text: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(text);
  // Saved or cancelled already: the blur that follows must not save again.
  const [done, setDone] = useState(false);
  const field = useRef<HTMLTextAreaElement | null>(null);

  const finish = (save: boolean) => {
    if (done) return;
    setDone(true);
    if (save) onSave(value);
    else onCancel();
  };

  // As tall as its text, so it reads like the bubble it replaces.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const stop = (e: SyntheticEvent) => e.stopPropagation();

  return (
    <textarea
      ref={field}
      className="inline-text-editor form-control form-control-sm"
      value={value}
      rows={1}
      aria-label={t('transcript.inlineTextLabel')}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          finish(true);
        }
        if (e.key === 'Escape') finish(false);
      }}
      onClick={stop}
      onDoubleClick={stop}
      onPointerDown={stop}
      onMouseDown={stop}
    />
  );
}
