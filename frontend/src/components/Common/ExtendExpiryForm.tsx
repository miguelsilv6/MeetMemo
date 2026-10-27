import { useState } from 'react';
import { Alert, Button, Form } from '@govtechsg/sgds-react';
import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../utils/projectDates';
import {
  EXTENSION_SHORTCUTS_DAYS,
  addDaysCapped,
  extensionBounds,
  extensionProblem,
  fromLocalInput,
  toLocalInput,
} from '../../utils/expiryDates';

interface ExtendExpiryFormProps {
  /** When it is deleted now (ISO). */
  currentExpiry: string;
  /** Saves the new date (ISO); rejects with the reason it could not. */
  onSave: (expiresAt: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * The administrator choosing a later date for an audio or project to be
 * deleted: a date and time, or +7 / +30 days, at most a year from now.
 */
export default function ExtendExpiryForm({
  currentExpiry,
  onSave,
  onCancel,
}: ExtendExpiryFormProps) {
  const { t, i18n } = useTranslation();
  const [now] = useState(() => Date.now());
  const { after, max } = extensionBounds(currentExpiry, now);
  const [value, setValue] = useState(() =>
    toLocalInput(addDaysCapped(after, EXTENSION_SHORTCUTS_DAYS[0], max))
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const chosen = fromLocalInput(value);
    const problem = extensionProblem(chosen, currentExpiry, now);
    if (problem) {
      setError(t(`expiry.${problem}`));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(new Date(chosen).toISOString());
    } catch (err) {
      setError((err as Error).message || t('expiry.failed'));
      setBusy(false);
    }
  };

  return (
    <div className="extend-expiry-form" data-testid="extend-expiry-form">
      <p className="small mb-2">
        {t('expiry.current', { date: formatDateTime(currentExpiry, i18n.language) })}
      </p>
      <Form.Group className="mb-2" controlId="extend-expiry-date">
        <Form.Label className="small mb-1">{t('expiry.newDate')}</Form.Label>
        <Form.Control
          type="datetime-local"
          size="sm"
          value={value}
          min={toLocalInput(after)}
          max={toLocalInput(max)}
          disabled={busy}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
        />
      </Form.Group>
      <div className="d-flex flex-wrap gap-2 mb-2">
        {EXTENSION_SHORTCUTS_DAYS.map((days) => (
          <Button
            key={days}
            variant="outline-secondary"
            size="sm"
            disabled={busy}
            onClick={() => {
              setValue(toLocalInput(addDaysCapped(after, days, max)));
              setError(null);
            }}
          >
            {t('expiry.plusDays', { count: days })}
          </Button>
        ))}
      </div>
      <p className="small text-muted mb-2">{t('expiry.hint')}</p>
      {error && (
        <Alert show variant="danger" className="py-2 px-3 small mb-2" role="alert">
          {error}
        </Alert>
      )}
      <div className="d-flex gap-2">
        <Button variant="primary" size="sm" onClick={save} disabled={busy}>
          <CalendarClock size={14} className="me-1" />
          {busy ? t('expiry.saving') : t('expiry.save')}
        </Button>
        <Button variant="outline-secondary" size="sm" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}
