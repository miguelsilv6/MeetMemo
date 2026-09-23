import { useState } from 'react';
import { Modal, Button, Form } from '@govtechsg/sgds-react';
import { UserX } from 'lucide-react';

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
          Remove Speaker
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p>
          <strong>{speaker}</strong> has {segmentCount}{' '}
          {segmentCount === 1 ? 'segment' : 'segments'}. What should happen to{' '}
          {segmentCount === 1 ? 'it' : 'them'}?
        </p>

        {otherSpeakers.length > 0 && (
          <Form.Check
            type="radio"
            id="remove-speaker-move"
            name="remove-speaker-action"
            className="mb-2"
            checked={action === 'move'}
            onChange={() => setAction('move')}
            label="Move to another speaker"
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
              Delete {segmentCount === 1 ? 'this segment' : 'these segments'} permanently
            </span>
          }
        />
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          Cancel
        </Button>
        <Button
          variant={action === 'delete' ? 'danger' : 'primary'}
          onClick={handleConfirm}
          disabled={action === 'move' && !targetSpeaker}
        >
          {action === 'delete' ? 'Delete Segments' : 'Move Segments'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
