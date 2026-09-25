import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Col, Row } from '@govtechsg/sgds-react';
import { ArrowLeft, LogOut, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import AdminLogin from './AdminLogin';
import AdminSettingsForm from './AdminSettingsForm';
import AdminPasswordForm from './AdminPasswordForm';
import AdminAuditLog from './AdminAuditLog';
import {
  AdminApiError,
  adminLogout,
  getAdminAudit,
  getAdminSession,
  getAdminSettings,
  getAdminStatus,
} from '../../services/adminApi';
import type { AdminSettingsResponse, AuditEntry, RuntimeSettings } from '../../types/admin';

type Phase = 'loading' | 'unconfigured' | 'login' | 'ready' | 'error';

interface AdminViewProps {
  onExit: () => void;
}

const isUnauthorized = (err: unknown) => err instanceof AdminApiError && err.status === 401;

export default function AdminView({ onExit }: AdminViewProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('loading');
  const [username, setUsername] = useState<string | null>(null);
  const [data, setData] = useState<AdminSettingsResponse | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showLogin = useCallback(() => {
    setUsername(null);
    setData(null);
    setAudit([]);
    setPhase('login');
  }, []);

  const fail = useCallback(
    (err: unknown) => {
      if (isUnauthorized(err)) {
        showLogin();
        return;
      }
      setError(err instanceof Error ? err.message : t('errors.unknown'));
      setPhase('error');
    },
    [showLogin, t]
  );

  const loadDashboard = useCallback(async () => {
    const [settings, entries] = await Promise.all([getAdminSettings(), getAdminAudit()]);
    setData(settings);
    setAudit(entries);
    setPhase('ready');
  }, []);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const { configured } = await getAdminStatus();
        if (cancelled) return;
        if (!configured) {
          setPhase('unconfigured');
          return;
        }
        const session = await getAdminSession();
        if (cancelled) return;
        setUsername(session.username);
        await loadDashboard();
      } catch (err) {
        if (!cancelled) fail(err);
      }
    };
    init();
    return () => {
      cancelled = true;
    };
  }, [fail, loadDashboard]);

  const handleLoggedIn = (name: string) => {
    setUsername(name);
    setPhase('loading');
    loadDashboard().catch(fail);
  };

  const handleLogout = async () => {
    try {
      await adminLogout();
    } finally {
      showLogin();
    }
  };

  const refreshAudit = () => {
    setAuditLoading(true);
    getAdminAudit()
      .then(setAudit)
      .catch(fail)
      .finally(() => setAuditLoading(false));
  };

  const handleSaved = (settings: RuntimeSettings) => {
    setData((prev) => (prev ? { ...prev, settings } : prev));
    refreshAudit();
  };

  return (
    <div className="admin-view">
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-4">
        <h2 className="mb-0 d-flex align-items-center gap-2">
          <Shield size={28} className="text-primary" />
          {t('admin.title')}
        </h2>
        <div className="d-flex flex-wrap align-items-center gap-2">
          {phase === 'ready' && username && (
            <span className="text-muted small">{t('admin.signedInAs', { username })}</span>
          )}
          {phase === 'ready' && (
            <Button variant="outline-secondary" size="sm" onClick={handleLogout}>
              <LogOut size={14} className="me-1" />
              {t('admin.logout')}
            </Button>
          )}
          <Button variant="outline-primary" size="sm" onClick={onExit}>
            <ArrowLeft size={14} className="me-1" />
            {t('admin.backToApp')}
          </Button>
        </div>
      </div>

      {phase === 'loading' && (
        <div className="text-center text-muted py-5">
          <span
            className="spinner-border spinner-border-sm me-2"
            role="status"
            aria-hidden="true"
          />
          {t('common.loading')}
        </div>
      )}

      {phase === 'unconfigured' && (
        <Alert show variant="warning">
          <strong>{t('admin.notConfiguredTitle')}</strong>
          <p className="mb-0 mt-1">{t('admin.notConfiguredBody')}</p>
        </Alert>
      )}

      {phase === 'error' && (
        <Alert show variant="danger">
          {error}
        </Alert>
      )}

      {phase === 'login' && <AdminLogin onLoggedIn={handleLoggedIn} />}

      {phase === 'ready' && data && (
        <>
          <Row>
            <Col lg={8}>
              <AdminSettingsForm data={data} onSaved={handleSaved} onUnauthorized={showLogin} />
            </Col>
            <Col lg={4}>
              <AdminPasswordForm onChanged={refreshAudit} onUnauthorized={showLogin} />
            </Col>
          </Row>
          <AdminAuditLog entries={audit} loading={auditLoading} onRefresh={refreshAudit} />
        </>
      )}
    </div>
  );
}
