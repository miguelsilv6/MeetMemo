import { useState } from 'react';
import type { FormEvent } from 'react';
import { Alert, Button, Card, Form } from '@govtechsg/sgds-react';
import { LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AdminApiError, adminLogin } from '../../services/adminApi';

interface AdminLoginProps {
  onLoggedIn: (username: string) => void;
}

export default function AdminLogin({ onLoggedIn }: AdminLoginProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { username: loggedIn } = await adminLogin(username, password);
      setPassword('');
      onLoggedIn(loggedIn);
    } catch (err) {
      const status = err instanceof AdminApiError ? err.status : 0;
      if (status === 401) setError(t('admin.login.invalid'));
      else if (status === 429) setError(t('admin.login.tooMany'));
      else setError(err instanceof Error ? err.message : t('errors.unknown'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="admin-login mx-auto">
      <Card.Header>
        <h5 className="mb-0">{t('admin.login.title')}</h5>
      </Card.Header>
      <Card.Body>
        {error && (
          <Alert show variant="danger" role="alert">
            {error}
          </Alert>
        )}
        <Form onSubmit={handleSubmit}>
          <Form.Group controlId="admin-username" className="mb-3">
            <Form.Label>{t('admin.login.username')}</Form.Label>
            <Form.Control
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
          </Form.Group>
          <Form.Group controlId="admin-password" className="mb-3">
            <Form.Label>{t('admin.login.password')}</Form.Label>
            <Form.Control
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Form.Group>
          <Button type="submit" variant="primary" className="w-100" disabled={submitting}>
            <LogIn size={16} className="me-2" />
            {submitting ? t('admin.login.submitting') : t('admin.login.submit')}
          </Button>
        </Form>
      </Card.Body>
    </Card>
  );
}
