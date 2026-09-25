import type { Dispatch, SetStateAction } from 'react';
import { Modal, Button, Form, Alert } from '@govtechsg/sgds-react';
import { Users, Sparkles, Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SpeakerMapping, SpeakerSuggestions } from '../../types/api';

interface EditSpeakersModalProps {
  show: boolean;
  onHide: () => void;
  editingSpeakers: SpeakerMapping;
  setEditingSpeakers: Dispatch<SetStateAction<SpeakerMapping>>;
  handleSaveSpeakers: () => void;
  identifyingSpeakers: boolean;
  speakerSuggestions: SpeakerSuggestions | null;
  handleAcceptSuggestion: (speakerLabel: string, suggestedName: string) => void;
  handleRejectSuggestion: (speakerLabel: string) => void;
}

export default function EditSpeakersModal({
  show,
  onHide,
  editingSpeakers,
  setEditingSpeakers,
  handleSaveSpeakers,
  identifyingSpeakers,
  speakerSuggestions,
  handleAcceptSuggestion,
  handleRejectSuggestion,
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
          {identifyingSpeakers && (
            <div className="text-muted small">
              <span
                className="spinner-border spinner-border-sm me-2"
                role="status"
                aria-hidden="true"
              ></span>
              {t('modals.editSpeakers.identifying')}
            </div>
          )}
        </div>

        {/* AI Suggestions Section */}
        {speakerSuggestions && Object.keys(speakerSuggestions).length > 0 && (
          <div className="mb-4">
            <h6 className="mb-3">
              <Sparkles size={18} className="me-2" />
              {t('modals.editSpeakers.aiSuggestions')}
            </h6>
            {Object.entries(speakerSuggestions).map(([speakerLabel, suggestedName]) => {
              const isUndetermined = suggestedName === 'Cannot be determined';
              return (
                <Alert
                  show
                  key={speakerLabel}
                  variant={isUndetermined ? 'secondary' : 'success'}
                  className="d-flex justify-content-between align-items-center mb-2"
                >
                  <div>
                    <strong>{speakerLabel}:</strong>{' '}
                    <span className={isUndetermined ? 'text-muted fst-italic' : ''}>
                      {suggestedName}
                    </span>
                  </div>
                  <div className="d-flex gap-2">
                    {!isUndetermined && (
                      <Button
                        variant="success"
                        size="sm"
                        onClick={() => handleAcceptSuggestion(speakerLabel, suggestedName)}
                        title={t('modals.editSpeakers.acceptSuggestion')}
                      >
                        <Check size={16} />
                      </Button>
                    )}
                    <Button
                      variant={isUndetermined ? 'secondary' : 'danger'}
                      size="sm"
                      onClick={() => handleRejectSuggestion(speakerLabel)}
                      title={t('modals.editSpeakers.dismissSuggestion')}
                    >
                      <X size={16} />
                    </Button>
                  </div>
                </Alert>
              );
            })}
            <hr className="my-4" />
          </div>
        )}

        {/* Manual Input Section */}
        <h6 className="mb-3">{t('modals.editSpeakers.speakerNames')}</h6>
        {Object.keys(editingSpeakers).map((speaker) => (
          <Form.Group key={speaker} className="mb-3">
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
