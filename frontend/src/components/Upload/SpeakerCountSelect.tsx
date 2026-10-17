import { Form } from '@govtechsg/sgds-react';
import { useTranslation } from 'react-i18next';

/** Speaker counts the uploader can give (the backend accepts 2 to 6). */
const SPEAKER_COUNTS = [2, 3, 4, 5, 6];

interface SpeakerCountSelectProps {
  id: string;
  /** null = let speaker diarization decide. */
  value: number | null;
  onChange: (count: number | null) => void;
  disabled?: boolean;
}

/**
 * How many people speak in the audio, when known: it keeps speaker
 * diarization from splitting one voice in two or inventing a third speaker.
 */
export default function SpeakerCountSelect({
  id,
  value,
  onChange,
  disabled = false,
}: SpeakerCountSelectProps) {
  const { t } = useTranslation();
  return (
    <Form.Group controlId={id}>
      <Form.Label className="small text-muted mb-1">{t('fileUpload.speakersLabel')}</Form.Label>
      <Form.Select
        size="sm"
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        title={t('fileUpload.speakersHint')}
      >
        <option value="">{t('fileUpload.speakersAuto')}</option>
        {SPEAKER_COUNTS.map((count) => (
          <option key={count} value={count}>
            {count}
          </option>
        ))}
      </Form.Select>
    </Form.Group>
  );
}
