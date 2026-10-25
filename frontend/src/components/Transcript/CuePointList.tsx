import { useState } from 'react';
import type { MouseEvent } from 'react';
import { Alert, Button, Form } from '@govtechsg/sgds-react';
import { Bookmark, Check, CircleQuestionMark, Pencil, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatTime } from '../../utils/timeFormat';
import type { CuePoint } from '../../types/api';

interface CuePointListProps {
  cuePoints: CuePoint[];
  /** The cue point just added: its note gets the focus. */
  addedId: number | null;
  error: string | null;
  onAdd: () => void;
  onSeek: (time: number) => void;
  onUpdateNote: (id: number, note: string) => void;
  onRemove: (id: number) => void;
}

const MAX_NOTE_LENGTH = 500;

/**
 * The audio's cue points under the player: click a time to jump there, read
 * each note, edit it in place (click it or the pencil), or remove a cue point.
 * A cue point just added opens for its note. How to use them is behind a "?"
 * next to the title.
 */
export default function CuePointList({
  cuePoints,
  addedId,
  error,
  onAdd,
  onSeek,
  onUpdateNote,
  onRemove,
}: CuePointListProps) {
  const { t } = useTranslation();
  const [showHelp, setShowHelp] = useState(false);
  // The cue point whose note is being edited (one at a time); a new one opens too.
  const [editingId, setEditingId] = useState<number | null>(null);
  const editing = editingId ?? addedId;

  // Leave the editor: saving a note the same as before saves nothing.
  const finishEditing = (cue: CuePoint, note: string) => {
    setEditingId(null);
    onUpdateNote(cue.id, note);
  };

  return (
    <div className="cue-point-list" data-testid="cue-point-list">
      <div className="d-flex align-items-center justify-content-between">
        <div className="d-flex align-items-center gap-1">
          <h6 className="mb-0 small fw-semibold">
            {t('cuePoints.title', { count: cuePoints.length })}
          </h6>
          <Button
            variant="link"
            size="sm"
            className="p-0 cue-point-help-btn"
            onClick={() => setShowHelp((shown) => !shown)}
            title={t('cuePoints.help')}
            aria-label={t('cuePoints.helpLabel')}
            aria-expanded={showHelp}
            aria-controls="cue-point-help"
          >
            <CircleQuestionMark size={14} />
          </Button>
        </div>
        <Button
          variant="outline-secondary"
          size="sm"
          onClick={onAdd}
          title={t('cuePoints.addHint')}
        >
          <Bookmark size={14} className="me-1" />
          {t('cuePoints.add')}
        </Button>
      </div>
      {error && (
        <Alert show variant="danger" className="py-1 px-2 mt-2 mb-0 small">
          {error}
        </Alert>
      )}
      {showHelp && (
        <p id="cue-point-help" className="text-muted small mb-0 mt-1">
          {t('cuePoints.help')}
        </p>
      )}
      {cuePoints.length > 0 && (
        <ul className="list-unstyled mb-0 mt-1">
          {cuePoints.map((cue) => (
            <li key={cue.id} className="cue-point-row">
              <Button
                variant="link"
                size="sm"
                className="p-0 cue-point-time"
                onClick={() => onSeek(cue.position_seconds)}
                title={t('cuePoints.jump')}
              >
                {formatTime(cue.position_seconds)}
              </Button>
              {editing === cue.id ? (
                <NoteEditor
                  cue={cue}
                  onSave={(note) => finishEditing(cue, note)}
                  onCancel={() => finishEditing(cue, cue.note)}
                />
              ) : (
                <>
                  <button
                    type="button"
                    className={`cue-point-note-text ${cue.note ? '' : 'cue-point-note-empty'}`}
                    onClick={() => setEditingId(cue.id)}
                    title={cue.note || t('cuePoints.editNote')}
                  >
                    {cue.note || t('cuePoints.noNote')}
                  </button>
                  <Button
                    variant="link"
                    size="sm"
                    className="p-0 cue-point-edit-btn"
                    onClick={() => setEditingId(cue.id)}
                    title={t('cuePoints.editNote')}
                    aria-label={t('cuePoints.noteLabel', {
                      time: formatTime(cue.position_seconds),
                    })}
                  >
                    <Pencil size={14} />
                  </Button>
                </>
              )}
              <Button
                variant="link"
                size="sm"
                className="p-0"
                onClick={() => onRemove(cue.id)}
                title={t('cuePoints.remove')}
                aria-label={t('cuePoints.remove')}
                style={{ color: 'var(--mm-danger, #dc3545)' }}
              >
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The note of one cue point being edited: Enter or ✓ saves, Escape or ✗
 * cancels, and leaving the field saves too (nothing typed is lost).
 */
function NoteEditor({
  cue,
  onSave,
  onCancel,
}: {
  cue: CuePoint;
  onSave: (note: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState(cue.note);
  // Saved or cancelled already: the blur that follows must not save again.
  const [done, setDone] = useState(false);
  const finish = (save: boolean) => {
    if (done) return;
    setDone(true);
    if (save) onSave(note);
    else onCancel();
  };
  // The buttons act before the field loses the focus.
  const keepFocus = (e: MouseEvent) => e.preventDefault();

  return (
    <div className="cue-point-editor">
      <Form.Control
        size="sm"
        className="cue-point-note"
        value={note}
        maxLength={MAX_NOTE_LENGTH}
        placeholder={t('cuePoints.notePlaceholder')}
        aria-label={t('cuePoints.noteLabel', { time: formatTime(cue.position_seconds) })}
        autoFocus
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(true);
          if (e.key === 'Escape') finish(false);
        }}
      />
      <Button
        variant="link"
        size="sm"
        className="p-0 cue-point-editor-btn"
        onMouseDown={keepFocus}
        onClick={() => finish(true)}
        title={t('cuePoints.saveNote')}
        aria-label={t('cuePoints.saveNote')}
      >
        <Check size={16} />
      </Button>
      <Button
        variant="link"
        size="sm"
        className="p-0 cue-point-editor-btn"
        onMouseDown={keepFocus}
        onClick={() => finish(false)}
        title={t('cuePoints.cancelEdit')}
        aria-label={t('cuePoints.cancelEdit')}
      >
        <X size={16} />
      </Button>
    </div>
  );
}
