import type { Dispatch, SetStateAction } from 'react';
import { Modal, Button, Form, Row, Col } from '@govtechsg/sgds-react';
import { Edit2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SpeakerMapping, Transcript } from '../../types/api';
import type { EditingSegment } from '../../hooks/useTranscript';

interface EditTextModalProps {
  show: boolean;
  onHide: () => void;
  editingSegment: EditingSegment | null;
  setEditingSegment: Dispatch<SetStateAction<EditingSegment | null>>;
  handleSaveSegmentText: () => void;
  transcript: Transcript | null;
  editingSpeakers: SpeakerMapping;
}

export default function EditTextModal({
  show,
  onHide,
  editingSegment,
  setEditingSegment,
  handleSaveSegmentText,
  transcript,
  editingSpeakers,
}: EditTextModalProps) {
  const { t } = useTranslation();

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>
          <Edit2 size={20} className="me-2" />
          {t('modals.editText.title')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {editingSegment && (
          <>
            <Row className="mb-3">
              <Col xs={6}>
                <Form.Group>
                  <Form.Label>{t('modals.editText.startLabel')}</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.1"
                    min={0}
                    value={editingSegment.start}
                    onChange={(e) =>
                      setEditingSegment({
                        ...editingSegment,
                        start: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                </Form.Group>
              </Col>
              <Col xs={6}>
                <Form.Group>
                  <Form.Label>{t('modals.editText.endLabel')}</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.1"
                    min={0}
                    value={editingSegment.end}
                    onChange={(e) =>
                      setEditingSegment({
                        ...editingSegment,
                        end: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                </Form.Group>
              </Col>
            </Row>
            <Form.Group className="mb-3">
              <Form.Label>{t('modals.editText.speakerLabel')}</Form.Label>
              <Form.Select
                value={editingSegment.speaker}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === '__new__') {
                    const newSpeaker = prompt(t('modals.editText.newSpeakerPrompt'));
                    if (newSpeaker && newSpeaker.trim()) {
                      setEditingSegment({
                        ...editingSegment,
                        speaker: newSpeaker.trim(),
                      });
                    }
                  } else {
                    setEditingSegment({
                      ...editingSegment,
                      speaker: value,
                    });
                  }
                }}
              >
                {/* Get unique speakers from transcript, plus the currently editing speaker if it's new */}
                {transcript &&
                  (() => {
                    const existingSpeakers = [
                      ...new Set((transcript.segments ?? []).map((s) => s.speaker)),
                    ];
                    // If editing speaker is not in existing list, add it (newly added speaker)
                    if (
                      editingSegment.speaker &&
                      !existingSpeakers.includes(editingSegment.speaker)
                    ) {
                      existingSpeakers.push(editingSegment.speaker);
                    }
                    return existingSpeakers.sort().map((speaker) => (
                      <option key={speaker} value={speaker}>
                        {editingSpeakers && editingSpeakers[speaker]
                          ? editingSpeakers[speaker]
                          : speaker}
                      </option>
                    ));
                  })()}
                <option value="__new__">{t('modals.editText.addNewSpeaker')}</option>
              </Form.Select>
              <Form.Text className="text-muted">{t('modals.editText.speakerHint')}</Form.Text>
            </Form.Group>
            <Form.Group>
              <Form.Label>{t('modals.editText.textLabel')}</Form.Label>
              <Form.Control
                as="textarea"
                rows={4}
                value={editingSegment.text}
                onChange={(e) =>
                  setEditingSegment({
                    ...editingSegment,
                    text: e.target.value,
                  })
                }
              />
            </Form.Group>
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" onClick={handleSaveSegmentText}>
          {t('common.save')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
