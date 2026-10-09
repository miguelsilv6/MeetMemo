import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Table } from '@govtechsg/sgds-react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AdminApiError, getLlmStatus } from '../../services/adminApi';
import type { LlmStatus } from '../../types/admin';
import { formatDateTime } from '../../utils/projectDates';

interface AdminLlmStatusProps {
  /** Whether the System tab is on screen (the status is checked when it opens). */
  active: boolean;
  onUnauthorized: () => void;
}

/** Bytes as GB (or MB below 1 GB), as Ollama reports model sizes. */
function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

/** The LLM server (Ollama) as the admin panel's System tab shows it. */
export default function AdminLlmStatus({ active, onUnauthorized }: AdminLlmStatusProps) {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The server's problem in the panel's language (the English text as a fallback). */
  const problem = (s: LlmStatus): string => {
    switch (s.error_code) {
      case 'timeout':
        return t('admin.llm.errors.timeout');
      case 'unreachable':
        return t('admin.llm.errors.unreachable');
      case 'http':
        return t('admin.llm.errors.http', { status: s.error_status });
      case 'other':
        return t('admin.llm.errors.other', { detail: s.error });
      default:
        return s.error ?? '';
    }
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await getLlmStatus());
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401) {
        onUnauthorized();
        return;
      }
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onUnauthorized]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- check the server when the tab opens
    if (active) refresh();
  }, [active, refresh]);

  const yesNo = (value: boolean | null, yes: string, no: string, variant = 'warning') =>
    value === null ? null : (
      <Badge bg={value ? 'success' : variant} className="ms-1">
        {value ? yes : no}
      </Badge>
    );

  return (
    <Card className="mb-4" data-testid="llm-status">
      <Card.Header className="d-flex justify-content-between align-items-center">
        <h5 className="mb-0">{t('admin.llm.title')}</h5>
        <Button variant="outline-secondary" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw size={14} className="me-1" />
          {loading ? t('admin.llm.checking') : t('admin.llm.refresh')}
        </Button>
      </Card.Header>
      <Card.Body>
        {error && (
          <Alert show variant="danger">
            {error}
          </Alert>
        )}
        {!status && !error && <p className="text-muted mb-0">{t('admin.llm.checking')}</p>}
        {status && (
          <>
            <dl className="row mb-3 admin-llm-facts">
              <dt className="col-sm-4">{t('admin.llm.state')}</dt>
              <dd className="col-sm-8">
                <Badge bg={status.reachable ? 'success' : 'danger'}>
                  {status.reachable ? t('admin.llm.reachable') : t('admin.llm.unreachable')}
                </Badge>
                {status.latency_ms !== null && (
                  <span className="text-muted small ms-2">
                    {t('admin.llm.latency', { ms: status.latency_ms })}
                  </span>
                )}
                {status.error && <div className="text-danger small mt-1">{problem(status)}</div>}
              </dd>
              <dt className="col-sm-4">{t('admin.llm.server')}</dt>
              <dd className="col-sm-8">
                {status.server === 'ollama'
                  ? t('admin.llm.ollama', { version: status.version ?? '?' })
                  : status.server === 'openai'
                    ? t('admin.llm.openai')
                    : '—'}
              </dd>
              <dt className="col-sm-4">{t('admin.llm.url')}</dt>
              <dd className="col-sm-8">
                <code>{status.url}</code>
              </dd>
              <dt className="col-sm-4">{t('admin.llm.configuredModel')}</dt>
              <dd className="col-sm-8">
                <code>{status.configured_model}</code>
                {yesNo(
                  status.model_available,
                  t('admin.llm.installed'),
                  t('admin.llm.notInstalled'),
                  'danger'
                )}
                {yesNo(status.model_loaded, t('admin.llm.loaded'), t('admin.llm.notLoaded'))}
              </dd>
            </dl>

            {status.reachable && <h6>{t('admin.llm.loadedTitle')}</h6>}
            {!status.reachable ? null : status.loaded_models === null ? (
              <p className="text-muted small">{t('admin.llm.loadedUnknown')}</p>
            ) : status.loaded_models.length === 0 ? (
              <p className="text-muted small">{t('admin.llm.noneLoaded')}</p>
            ) : (
              <div className="table-responsive">
                <Table size="sm" className="mb-3">
                  <thead>
                    <tr>
                      <th scope="col">{t('admin.llm.model')}</th>
                      <th scope="col">{t('admin.llm.size')}</th>
                      <th scope="col">{t('admin.llm.vram')}</th>
                      <th scope="col">{t('admin.llm.expires')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.loaded_models.map((model) => (
                      <tr key={model.name}>
                        <td>
                          <code>{model.name}</code>
                        </td>
                        <td>{formatBytes(model.size)}</td>
                        <td>{formatBytes(model.size_vram)}</td>
                        <td>
                          {model.expires_at ? formatDateTime(model.expires_at, i18n.language) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}

            {status.available_models.length > 0 && (
              <details>
                <summary className="small">
                  {t('admin.llm.availableTitle', { count: status.available_models.length })}
                </summary>
                <ul className="small mt-2 mb-0">
                  {status.available_models.map((model) => (
                    <li key={model.name}>
                      <code>{model.name}</code>
                      {model.parameter_size && ` · ${model.parameter_size}`}
                      {model.quantization && ` · ${model.quantization}`}
                      {model.size !== null && ` · ${formatBytes(model.size)}`}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </Card.Body>
    </Card>
  );
}
