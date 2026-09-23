import type { Dispatch, SetStateAction } from 'react';
import { Modal, Button, Form } from '@govtechsg/sgds-react';
import { Edit2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface EditSummaryModalProps {
  show: boolean;
  onHide: () => void;
  editingSummary: string;
  setEditingSummary: Dispatch<SetStateAction<string>>;
  handleSaveSummary: () => void;
}

export default function EditSummaryModal({
  show,
  onHide,
  editingSummary,
  setEditingSummary,
  handleSaveSummary,
}: EditSummaryModalProps) {
  const { t } = useTranslation();

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>
          <Edit2 size={20} className="me-2" />
          {t('modals.editSummary.title')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-muted mb-3">{t('modals.editSummary.description')}</p>
        <Form.Group>
          <Form.Label>{t('modals.editSummary.textLabel')}</Form.Label>
          <Form.Control
            as="textarea"
            rows={15}
            value={editingSummary}
            onChange={(e) => setEditingSummary(e.target.value)}
            placeholder={t('modals.editSummary.placeholder')}
          />
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" onClick={handleSaveSummary}>
          {t('common.save')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
