import { Alert, Button, Modal } from '@govtechsg/sgds-react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface RegenerateSummaryModalProps {
  show: boolean;
  onHide: () => void;
  /** Starts the new summary (it is made in the background). */
  onConfirm: () => void;
}

/**
 * Confirm a new AI summary in place of the saved one (administrator): it is
 * made from the transcript as it is now and replaces any edits made by hand.
 */
export default function RegenerateSummaryModal({
  show,
  onHide,
  onConfirm,
}: RegenerateSummaryModalProps) {
  const { t } = useTranslation();

  return (
    <Modal show={show} onHide={onHide}>
      <Modal.Header closeButton>
        <Modal.Title>{t('summary.regenerateTitle')}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p>{t('summary.regenerateBody')}</p>
        <Alert show variant="warning" className="mb-0">
          {t('summary.regenerateWarning')}
        </Alert>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onHide}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            onHide();
            onConfirm();
          }}
        >
          <RefreshCw size={16} className="me-1" />
          {t('summary.regenerateConfirm')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
