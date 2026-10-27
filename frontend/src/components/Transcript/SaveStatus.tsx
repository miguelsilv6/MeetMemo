import { useEffect, useState } from 'react';
import { Alert, Button } from '@govtechsg/sgds-react';
import { AlertTriangle, Check, CloudOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SaveState } from '../../hooks/useTranscriptSaver';

interface SaveStatusProps {
  saveState: SaveState;
  saveError: string | null;
  /** When the next attempt is due (ms since epoch), while waiting to try again. */
  retryAt: number | null;
  onRetry: () => void;
}

// Seconds left until `at`, ticking every second while there is one.
function useSecondsUntil(at: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at === null) return undefined;
    const update = () => setNow(Date.now());
    // At once (the clock may be from long before), then every second.
    const first = setTimeout(update, 0);
    const tick = setInterval(update, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
    };
  }, [at]);
  return at === null ? null : Math.max(0, Math.ceil((at - now) / 1000));
}

/** Next to the transcript's title: whether its edits are on the server yet. */
export function SaveStatusBadge({ saveState }: { saveState: SaveState }) {
  const { t } = useTranslation();
  return (
    <small
      className={`save-status save-status-${saveState} ms-2`}
      data-testid="save-status"
      role="status"
    >
      {saveState === 'saved' && <Check size={14} className="me-1" aria-hidden="true" />}
      {saveState === 'saving' && (
        <span className="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>
      )}
      {saveState === 'pending' && <CloudOff size={14} className="me-1" aria-hidden="true" />}
      {saveState === 'failed' && <AlertTriangle size={14} className="me-1" aria-hidden="true" />}
      {t(`saveStatus.${saveState}`)}
    </small>
  );
}

/**
 * At the bottom of the window (seen wherever the transcript is scrolled to)
 * while edits are not on the server: they stay on screen, are tried again
 * (when it may work), and can be tried again now.
 */
export default function SaveStatus({ saveState, saveError, retryAt, onRetry }: SaveStatusProps) {
  const { t } = useTranslation();
  const seconds = useSecondsUntil(saveState === 'pending' ? retryAt : null);
  if (saveState !== 'pending' && saveState !== 'failed') return null;

  return (
    <Alert
      show
      variant={saveState === 'failed' ? 'danger' : 'warning'}
      className="save-status-toast d-flex flex-wrap align-items-center gap-2 py-2 px-3 mb-0 small"
      data-testid="save-status-alert"
    >
      <span className="flex-grow-1">
        {saveState === 'pending'
          ? t('saveStatus.pendingDetail', { error: saveError ?? '', seconds: seconds ?? 0 })
          : t('saveStatus.failedDetail', { error: saveError ?? '' })}
      </span>
      <Button
        variant={saveState === 'failed' ? 'outline-danger' : 'outline-secondary'}
        size="sm"
        onClick={onRetry}
      >
        {saveState === 'pending' ? t('saveStatus.retryNow') : t('saveStatus.retry')}
      </Button>
    </Alert>
  );
}
