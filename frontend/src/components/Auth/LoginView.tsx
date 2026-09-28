import { useState } from 'react';
import type { FormEvent } from 'react';
import { Alert, Button, Card, Form } from '@govtechsg/sgds-react';
import { LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { login } from '../../services/authApi';
import type { ApiError } from '../../types/api';
import type { Me } from '../../types/auth';

interface LoginViewProps {
  onSignedIn: (me: Me) => void;
}

/** Sign-in for user accounts (created by the administrator; there is no sign-up). */
export default function LoginView({ onSignedIn }: LoginViewProps) {
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
      const me = await login(username.trim(), password);
      setPassword('');
      onSignedIn(me);
    } catch (err) {
      const status = (err as ApiError).status;
      if (status === 401) setError(t('auth.login.invalid'));
      else if (status === 429) setError(t('auth.login.tooMany'));
      else setError((err as Error).message || t('errors.unknown'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="auth-card mx-auto">
      <Card.Header>
        <h1 className="h5 mb-0">{t('auth.login.title')}</h1>
      </Card.Header>
      <Card.Body>
        <p className="text-muted small">{t('auth.login.intro')}</p>
        {error && (
          <Alert show variant="danger" role="alert">
            {error}
          </Alert>
        )}
        <Form onSubmit={handleSubmit}>
          <Form.Group controlId="login-username" className="mb-3">
            <Form.Label>{t('auth.login.username')}</Form.Label>
            <Form.Control
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
          </Form.Group>
          <Form.Group controlId="login-password" className="mb-3">
            <Form.Label>{t('auth.login.password')}</Form.Label>
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
            {submitting ? t('auth.login.submitting') : t('auth.login.submit')}
          </Button>
        </Form>
      </Card.Body>
    </Card>
  );
}
