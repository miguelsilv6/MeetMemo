import { useState } from 'react';
import { Modal, Button, Form } from '@govtechsg/sgds-react';
import { UserX } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

interface RemoveSpeakerModalProps {
  show: boolean;
  onHide: () => void;
  speaker: string | null;
  segmentCount: number;
  otherSpeakers: string[];
  onMove: (targetSpeaker: string) => void;
  onDelete: () => void;
}

// The parent remounts this component (via a `key` tied to the targeted
// speaker) each time a different speaker is targeted for removal, so this
// local state naturally resets — no effect-based reset needed.
export default function RemoveSpeakerModal({
  show,
  onHide,
  speaker,
  segmentCount,
  otherSpeakers,
  onMove,
  onDelete,
}: RemoveSpeakerModalProps) {
  const { t } = useTranslation();
  const [action, setAction] = useState<'move' | 'delete'>(
    otherSpeakers.length > 0 ? 'move' : 'delete'
  );
  const [targetSpeaker, setTargetSpeaker] = useState(otherSpeakers[0] ?? '');

  const handleConfirm = () => {
    if (action === 'move') {
      if (!targetSpeaker) return;
      onMove(targetSpeaker);
    } else {
      onDelete();
    }
  };

  return (
    <Modal show={show} onHide={onHide}>
      <Modal.Header closeButton>
        <Modal.Title>
          <UserX size={20} className="me-2" />
          {t('modals.removeSpeaker.title')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p>
          <Trans
            i18nKey="modals.removeSpeaker.description"
            count={segmentCount}
            values={{ speaker }}
            components={{ strong: <strong /> }}
          />
        </p>

        {otherSpeakers.length > 0 && (
          <Form.Check
            type="radio"
            id="remove-speaker-move"
            name="remove-speaker-action"
            className="mb-2"
            checked={action === 'move'}
            onChange={() => setAction('move')}
            label={t('modals.removeSpeaker.moveToAnother')}
          />
        )}
        {action === 'move' && otherSpeakers.length > 0 && (
          <Form.Select
            className="mb-3 ms-4"
            style={{ width: 'auto' }}
            value={targetSpeaker}
            onChange={(e) => setTargetSpeaker(e.target.value)}
          >
            {otherSpeakers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Form.Select>
        )}

        <Form.Check
          type="radio"
          id="remove-speaker-delete"
          name="remove-speaker-action"
          checked={action === 'delete'}
          onChange={() => setAction('delete')}
          label={
            <span className="text-danger">
              {t('modals.removeSpeaker.deleteLabel', { count: segmentCount })}
            </span>
          }
        />
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          {t('common.cancel')}
        </Button>
        <Button
          variant={action === 'delete' ? 'danger' : 'primary'}
          onClick={handleConfirm}
          disabled={action === 'move' && !targetSpeaker}
        >
          {action === 'delete'
            ? t('modals.removeSpeaker.deleteButton')
            : t('modals.removeSpeaker.moveButton')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
