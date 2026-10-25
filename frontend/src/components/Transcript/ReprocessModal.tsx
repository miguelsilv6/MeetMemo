import { useState } from 'react';
import { Alert, Button, Modal } from '@govtechsg/sgds-react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ReprocessModalProps {
  show: boolean;
  onHide: () => void;
  /** Starts the processing over; rejects with the reason it could not. */
  onConfirm: () => Promise<void>;
}

/**
 * Confirm processing an audio again from the very start (administrator):
 * what it replaces, what it keeps, and that the admin panel's current
 * settings apply.
 */
export default function ReprocessModal({ show, onHide, onConfirm }: ReprocessModalProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setError(null);
    onHide();
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError((err as Error).message || t('reprocess.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show={show} onHide={close}>
      <Modal.Header closeButton>
        <Modal.Title>{t('reprocess.title')}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p>{t('reprocess.settings')}</p>
        <p>{t('reprocess.kept')}</p>
        <Alert show variant="warning" className="mb-0">
          {t('reprocess.warning')}
        </Alert>
        {error && (
          <Alert show variant="danger" className="mt-3 mb-0">
            {error}
          </Alert>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={close} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button variant="danger" onClick={confirm} disabled={busy}>
          <RefreshCw size={16} className="me-1" />
          {busy ? t('reprocess.starting') : t('reprocess.confirm')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
