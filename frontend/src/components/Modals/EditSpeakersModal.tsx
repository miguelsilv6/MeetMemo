import type { Dispatch, SetStateAction } from 'react';
import { Modal, Button, Form } from '@govtechsg/sgds-react';
import { Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SpeakerMapping } from '../../types/api';

interface EditSpeakersModalProps {
  show: boolean;
  onHide: () => void;
  editingSpeakers: SpeakerMapping;
  setEditingSpeakers: Dispatch<SetStateAction<SpeakerMapping>>;
  handleSaveSpeakers: () => void;
}

/** Lets the user rename each speaker label by hand. */
export default function EditSpeakersModal({
  show,
  onHide,
  editingSpeakers,
  setEditingSpeakers,
  handleSaveSpeakers,
}: EditSpeakersModalProps) {
  const { t } = useTranslation();

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>
          <Users size={20} className="me-2" />
          {t('modals.editSpeakers.title')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="mb-4">
          <p className="text-muted mb-2">{t('modals.editSpeakers.description')}</p>
          <p className="text-muted small mb-2">{t('modals.editSpeakers.tip')}</p>
        </div>

        <h6 className="mb-3">{t('modals.editSpeakers.speakerNames')}</h6>
        {Object.keys(editingSpeakers).map((speaker) => (
          <Form.Group key={speaker} className="mb-3" controlId={`speaker-name-${speaker}`}>
            <Form.Label>{speaker}</Form.Label>
            <Form.Control
              type="text"
              value={editingSpeakers[speaker]}
              onChange={(e) =>
                setEditingSpeakers({
                  ...editingSpeakers,
                  [speaker]: e.target.value,
                })
              }
              placeholder={t('modals.editSpeakers.namePlaceholder')}
            />
          </Form.Group>
        ))}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" onClick={handleSaveSpeakers}>
          {t('common.save')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
