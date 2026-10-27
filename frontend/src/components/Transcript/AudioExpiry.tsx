import { useEffect, useState } from 'react';
import { Button } from '@govtechsg/sgds-react';
import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import * as api from '../../services/api';
import { extendJobExpiry } from '../../services/adminApi';
import { formatDateTime } from '../../utils/projectDates';
import ExtendExpiryModal from '../Common/ExtendExpiryModal';

const HOUR_MS = 60 * 60 * 1000;

/**
 * When an audio outside a project is deleted (in red with less than an hour
 * left), and for the administrator a way to keep it longer. Nothing for an
 * audio in a project: it lives as long as its project.
 */
export default function AudioExpiry({
  jobId,
  fileName,
  isAdmin = false,
}: {
  jobId: string;
  fileName: string;
  isAdmin?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [extending, setExtending] = useState(false);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    api
      .getJobStatus(jobId)
      .then((status) => {
        if (!cancelled) setExpiresAt(status.expires_at ?? null);
      })
      .catch(() => {
        // No date to show: the rest of the page says what went wrong.
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (!expiresAt) return null;
  const soon = new Date(expiresAt).getTime() - now < HOUR_MS;

  return (
    <div className="info-item mb-3" data-testid="audio-expiry">
      <small className="text-muted">{t('expiry.audioLabel')}</small>
      <div className="d-flex align-items-center flex-wrap gap-2">
        <span className={soon ? 'text-danger fw-semibold' : undefined}>
          {formatDateTime(expiresAt, i18n.language)}
        </span>
        {isAdmin && (
          <Button
            variant="link"
            size="sm"
            className="p-0"
            onClick={() => setExtending(true)}
            title={t('expiry.extendTitle')}
          >
            <CalendarClock size={14} className="me-1" />
            {t('expiry.extend')}
          </Button>
        )}
      </div>
      {isAdmin && (
        <ExtendExpiryModal
          show={extending}
          name={fileName}
          currentExpiry={expiresAt}
          onHide={() => setExtending(false)}
          onSave={async (date) => {
            const saved = await extendJobExpiry(jobId, date);
            setExpiresAt(saved.expires_at);
            setExtending(false);
          }}
        />
      )}
    </div>
  );
}
