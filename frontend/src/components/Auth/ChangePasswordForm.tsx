import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Alert, Button, Form } from '@govtechsg/sgds-react';
import { KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { changePassword } from '../../services/authApi';
import type { ApiError } from '../../types/api';

export const MIN_PASSWORD_LENGTH = 12;

interface ChangePasswordFormProps {
  onChanged: () => void;
  /** Extra buttons next to submit (e.g. Cancel in a modal). */
  secondaryAction?: ReactNode;
}

/** Change the signed-in user's password (other sessions are signed out). */
export default function ChangePasswordForm({
  onChanged,
  secondaryAction,
}: ChangePasswordFormProps) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== next;
  const canSubmit =
    current.length > 0 && next.length >= MIN_PASSWORD_LENGTH && confirm === next && !submitting;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await changePassword(current, next);
      onChanged();
    } catch (err) {
      setError(
        (err as ApiError).status === 403
          ? t('admin.password.wrongCurrent')
          : (err as Error).message || t('errors.unknown')
      );
      setSubmitting(false);
    }
  };

  return (
    <Form onSubmit={handleSubmit} noValidate>
      {error && (
        <Alert show variant="danger" role="alert">
          {error}
        </Alert>
      )}
      <Form.Group controlId="user-password-current" className="mb-3">
        <Form.Label>{t('admin.password.current')}</Form.Label>
        <Form.Control
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </Form.Group>
      <Form.Group controlId="user-password-new" className="mb-3">
        <Form.Label>{t('admin.password.new')}</Form.Label>
        <Form.Control
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          isInvalid={tooShort}
        />
        {tooShort && (
          <div className="invalid-feedback d-block">
            {t('admin.password.tooShort', { min: MIN_PASSWORD_LENGTH })}
          </div>
        )}
      </Form.Group>
      <Form.Group controlId="user-password-confirm" className="mb-3">
        <Form.Label>{t('admin.password.confirm')}</Form.Label>
        <Form.Control
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          isInvalid={mismatch}
        />
        {mismatch && <div className="invalid-feedback d-block">{t('admin.password.mismatch')}</div>}
      </Form.Group>
      <div className="d-flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          <KeyRound size={16} className="me-2" />
          {t('admin.password.submit')}
        </Button>
        {secondaryAction}
      </div>
    </Form>
  );
}
