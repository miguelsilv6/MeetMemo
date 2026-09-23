import { useState } from 'react';
import { Modal, Button, Form } from '@govtechsg/sgds-react';
import { Scissors } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useWaveformPeaks from '../../hooks/useWaveformPeaks';
import WaveformScrubber from './WaveformScrubber';
import type { EditingSegment } from '../../hooks/useTranscript';
import type { SpeakerMapping } from '../../types/api';

interface SplitSegmentModalProps {
  show: boolean;
  onHide: () => void;
  segment: EditingSegment | null;
  jobId: string | null;
  speakers: string[];
  editingSpeakers: SpeakerMapping;
  onSplit: (
    index: number,
    firstText: string,
    secondText: string,
    secondSpeaker: string,
    splitRatio?: number
  ) => void;
}

/**
 * Split text at the space nearest its midpoint, so neither half starts or
 * ends mid-word. Falls back to a hard split for very short text.
 */
function defaultSplit(text: string): [string, string] {
  if (text.length < 4) return [text, ''];
  const mid = Math.floor(text.length / 2);
  for (let offset = 0; offset < text.length / 2; offset++) {
    if (text[mid + offset] === ' ') {
      return [text.slice(0, mid + offset).trim(), text.slice(mid + offset).trim()];
    }
    if (mid - offset >= 0 && text[mid - offset] === ' ') {
      return [text.slice(0, mid - offset).trim(), text.slice(mid - offset).trim()];
    }
  }
  return [text.slice(0, mid), text.slice(mid)];
}

// The parent remounts this component (via a `key` tied to the segment being
// split) whenever a different segment is targeted, so this local state
// naturally resets — no effect-based reset needed (see RemoveSpeakerModal).
export default function SplitSegmentModal({
  show,
  onHide,
  segment,
  jobId,
  speakers,
  editingSpeakers,
  onSplit,
}: SplitSegmentModalProps) {
  const { t } = useTranslation();
  const [defaultFirst, defaultSecond] = segment ? defaultSplit(segment.text) : ['', ''];
  const otherSpeakers = segment ? speakers.filter((s) => s !== segment.speaker) : speakers;
  // Starts at the same text-proportional split the backend falls back to, so
  // the outcome is unchanged until the user actually drags the waveform.
  const defaultRatio = segment?.text.length ? defaultFirst.length / segment.text.length : 0.5;

  const [firstText, setFirstText] = useState(defaultFirst);
  const [secondText, setSecondText] = useState(defaultSecond);
  const [secondSpeaker, setSecondSpeaker] = useState(otherSpeakers[0] ?? '');
  const [splitRatio, setSplitRatio] = useState(defaultRatio);

  const { peaks, loading, error } = useWaveformPeaks(
    jobId,
    Number(segment?.start ?? 0),
    Number(segment?.end ?? 0)
  );

  if (!segment) return null;

  const canConfirm = firstText.trim().length > 0 && secondText.trim().length > 0 && !!secondSpeaker;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onSplit(segment.index, firstText.trim(), secondText.trim(), secondSpeaker, splitRatio);
  };

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>
          <Scissors size={20} className="me-2" />
          {t('modals.splitSegment.title')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-muted mb-3">{t('modals.splitSegment.description')}</p>
        <WaveformScrubber
          peaks={peaks}
          loading={loading}
          error={error}
          splitRatio={splitRatio}
          onSplitRatioChange={setSplitRatio}
        />
        <Form.Group className="mb-3">
          <Form.Label>
            {t('modals.splitSegment.firstPartLabel', { speaker: segment.speaker })}
          </Form.Label>
          <Form.Control
            as="textarea"
            rows={3}
            value={firstText}
            onChange={(e) => setFirstText(e.target.value)}
          />
        </Form.Group>
        <Form.Group className="mb-3">
          <Form.Label>{t('modals.splitSegment.secondPartLabel')}</Form.Label>
          <Form.Control
            as="textarea"
            rows={3}
            value={secondText}
            onChange={(e) => setSecondText(e.target.value)}
          />
        </Form.Group>
        <Form.Group>
          <Form.Label>{t('modals.splitSegment.secondSpeakerLabel')}</Form.Label>
          <Form.Select
            value={secondSpeaker}
            onChange={(e) => {
              const value = e.target.value;
              if (value === '__new__') {
                const newSpeaker = prompt(t('modals.splitSegment.newSpeakerPrompt'));
                if (newSpeaker && newSpeaker.trim()) {
                  setSecondSpeaker(newSpeaker.trim());
                }
              } else {
                setSecondSpeaker(value);
              }
            }}
          >
            <option value="" disabled>
              —
            </option>
            {speakers.map((s) => (
              <option key={s} value={s}>
                {editingSpeakers?.[s] ?? s}
              </option>
            ))}
            {secondSpeaker && !speakers.includes(secondSpeaker) && (
              <option value={secondSpeaker}>{secondSpeaker}</option>
            )}
            <option value="__new__">{t('modals.splitSegment.addNewSpeaker')}</option>
          </Form.Select>
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" onClick={handleConfirm} disabled={!canConfirm}>
          {t('modals.splitSegment.confirmButton')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
