import { Modal } from '@govtechsg/sgds-react';
import { useTranslation } from 'react-i18next';
import ExtendExpiryForm from './ExtendExpiryForm';

interface ExtendExpiryModalProps {
  show: boolean;
  /** What is extended (an audio's file name, a project's name). */
  name: string;
  currentExpiry: string;
  onSave: (expiresAt: string) => Promise<void>;
  onHide: () => void;
}

/** The administrator extending an audio or project, in a dialog of its own. */
export default function ExtendExpiryModal({
  show,
  name,
  currentExpiry,
  onSave,
  onHide,
}: ExtendExpiryModalProps) {
  const { t } = useTranslation();
  return (
    <Modal show={show} onHide={onHide}>
      <Modal.Header closeButton>
        <Modal.Title>{t('expiry.title', { name })}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {show && (
          <ExtendExpiryForm currentExpiry={currentExpiry} onSave={onSave} onCancel={onHide} />
        )}
      </Modal.Body>
    </Modal>
  );
}
