import { Button, Card, Table } from '@govtechsg/sgds-react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AuditEntry } from '../../types/admin';

interface AdminAuditLogProps {
  entries: AuditEntry[];
  loading: boolean;
  onRefresh: () => void;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.join(' · ');
  return String(value);
}

export default function AdminAuditLog({ entries, loading, onRefresh }: AdminAuditLogProps) {
  const { t, i18n } = useTranslation();

  const settingLabel = (key: string) =>
    key === 'admin_password'
      ? t('admin.audit.passwordChanged')
      : t(`admin.settings.fields.${key}.label`, { defaultValue: key });

  return (
    <Card className="mb-4">
      <Card.Header className="d-flex justify-content-between align-items-center">
        <h5 className="mb-0">{t('admin.audit.title')}</h5>
        <Button variant="outline-secondary" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={14} className="me-1" />
          {t('admin.audit.refresh')}
        </Button>
      </Card.Header>
      <Card.Body>
        {entries.length === 0 ? (
          <p className="text-muted mb-0">{t('admin.audit.empty')}</p>
        ) : (
          <div className="table-responsive">
            <Table size="sm" className="mb-0 admin-audit-table">
              <thead>
                <tr>
                  <th scope="col">{t('admin.audit.when')}</th>
                  <th scope="col">{t('admin.audit.who')}</th>
                  <th scope="col">{t('admin.audit.setting')}</th>
                  <th scope="col">{t('admin.audit.from')}</th>
                  <th scope="col">{t('admin.audit.to')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="text-nowrap">
                      {new Date(entry.changed_at).toLocaleString(i18n.language)}
                    </td>
                    <td>{entry.actor}</td>
                    <td>{settingLabel(entry.setting_key)}</td>
                    <td className="admin-audit-value">{formatValue(entry.old_value)}</td>
                    <td className="admin-audit-value">{formatValue(entry.new_value)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
