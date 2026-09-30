import { Badge } from '@govtechsg/sgds-react';
import { useTranslation } from 'react-i18next';
import { getLanguageName } from '../../constants/languages';
import { getConfidenceVariant } from '../../utils/confidence';

interface DetectedLanguageProps {
  /** Whisper's language code; null or missing until transcribed. */
  language?: string | null;
  /** Detection confidence (0-1); null when the language was chosen, not detected. */
  probability?: number | null;
  /** Whether the audio is processed (before that, "—"). */
  ready?: boolean;
}

/** The language detected in an audio, with its confidence as a colored badge. */
export default function DetectedLanguage({
  language = null,
  probability = null,
  ready = true,
}: DetectedLanguageProps) {
  const { t } = useTranslation();
  if (!ready || !language) {
    return <span className="text-muted">—</span>;
  }
  return (
    <span className="d-inline-flex align-items-center gap-1 flex-wrap">
      <span>{getLanguageName(language)}</span>
      {typeof probability === 'number' && (
        <Badge bg={getConfidenceVariant(probability)} title={t('meetingInfo.confidenceTitle')}>
          {Math.round(probability * 100)}%
        </Badge>
      )}
    </span>
  );
}
