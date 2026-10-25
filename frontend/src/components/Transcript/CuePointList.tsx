import { Alert, Button, Form } from '@govtechsg/sgds-react';
import { Bookmark, Trash2 } from 'lucide-react';
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
 * The audio's cue points under the player: click a time to jump there, type a
 * note (saved when leaving the field or on Enter; Escape cancels), or remove one.
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

  return (
    <div className="cue-point-list" data-testid="cue-point-list">
      <div className="d-flex align-items-center justify-content-between">
        <h6 className="mb-0 small fw-semibold">
          {t('cuePoints.title', { count: cuePoints.length })}
        </h6>
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
      {cuePoints.length === 0 ? (
        <p className="text-muted small mb-0 mt-1">{t('cuePoints.empty')}</p>
      ) : (
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
              <Form.Control
                // A new key when the saved note changes resets what was typed.
                key={`${cue.id}-${cue.updated_at}`}
                size="sm"
                className="cue-point-note"
                defaultValue={cue.note}
                maxLength={MAX_NOTE_LENGTH}
                placeholder={t('cuePoints.notePlaceholder')}
                aria-label={t('cuePoints.noteLabel', { time: formatTime(cue.position_seconds) })}
                autoFocus={cue.id === addedId}
                onBlur={(e) => onUpdateNote(cue.id, e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') {
                    e.currentTarget.value = cue.note;
                    e.currentTarget.blur();
                  }
                }}
              />
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
