import { useState } from 'react';
import type { FormEvent } from 'react';
import { Alert, Button, Card, Form } from '@govtechsg/sgds-react';
import { KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AdminApiError, changeAdminPassword } from '../../services/adminApi';

const MIN_PASSWORD_LENGTH = 12;

interface AdminPasswordFormProps {
  onChanged: () => void;
  onUnauthorized: () => void;
}

export default function AdminPasswordForm({ onChanged, onUnauthorized }: AdminPasswordFormProps) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ variant: 'success' | 'danger'; text: string } | null>(
    null
  );

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== next;
  const canSubmit =
    current.length > 0 && next.length >= MIN_PASSWORD_LENGTH && confirm === next && !submitting;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setMessage(null);
    try {
      await changeAdminPassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setMessage({ variant: 'success', text: t('admin.password.success') });
      onChanged();
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401) {
        onUnauthorized();
        return;
      }
      const text =
        err instanceof AdminApiError && err.status === 403
          ? t('admin.password.wrongCurrent')
          : err instanceof Error
            ? err.message
            : t('errors.unknown');
      setMessage({ variant: 'danger', text });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="mb-4">
      <Card.Header>
        <h5 className="mb-0">{t('admin.password.title')}</h5>
      </Card.Header>
      <Card.Body>
        {message && (
          <Alert
            show
            variant={message.variant}
            role={message.variant === 'danger' ? 'alert' : 'status'}
          >
            {message.text}
          </Alert>
        )}
        <Form onSubmit={handleSubmit} noValidate>
          <Form.Group controlId="admin-current-password" className="mb-3">
            <Form.Label>{t('admin.password.current')}</Form.Label>
            <Form.Control
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Form.Group>
          <Form.Group controlId="admin-new-password" className="mb-3">
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
          <Form.Group controlId="admin-confirm-password" className="mb-3">
            <Form.Label>{t('admin.password.confirm')}</Form.Label>
            <Form.Control
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              isInvalid={mismatch}
            />
            {mismatch && (
              <div className="invalid-feedback d-block">{t('admin.password.mismatch')}</div>
            )}
          </Form.Group>
          <Button type="submit" variant="outline-primary" disabled={!canSubmit}>
            <KeyRound size={16} className="me-2" />
            {t('admin.password.submit')}
          </Button>
        </Form>
      </Card.Body>
    </Card>
  );
}
