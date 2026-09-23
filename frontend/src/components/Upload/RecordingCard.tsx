import { Card, Button, Alert } from '@govtechsg/sgds-react';
import { Mic, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getRecordingUnavailableReason } from '../../utils/browserUtils';

interface RecordingCardProps {
  onStartRecording: () => void;
  isRecording: boolean;
}

export default function RecordingCard({ onStartRecording, isRecording }: RecordingCardProps) {
  const { t } = useTranslation();
  const unavailableReason = getRecordingUnavailableReason();
  const isDisabled = !!unavailableReason || isRecording;

  return (
    <Card className="h-100 record-card">
      <Card.Body className="text-center p-5 d-flex flex-column justify-content-center">
        <div className="record-icon my-4">
          <Mic size={64} strokeWidth={1.5} className="text-danger" />
        </div>
        <h4 className="mb-3">{t('recording.title')}</h4>
        <p className="text-muted mb-4">{t('recording.subtitle')}</p>
        <div className="record-info mb-4">
          {unavailableReason ? (
            <Alert variant="warning" className="mb-0">
              <div className="d-flex align-items-start gap-2">
                <AlertCircle size={20} className="flex-shrink-0 mt-1" />
                <small>{unavailableReason}</small>
              </div>
            </Alert>
          ) : (
            <Alert variant="info" className="mb-0">
              <small>
                <strong>{t('recording.tipLabel')}</strong> {t('recording.tipText')}
              </small>
            </Alert>
          )}
        </div>
        <div title={unavailableReason || ''}>
          <Button
            variant="danger"
            size="lg"
            className="w-100"
            disabled={isDisabled}
            onClick={onStartRecording}
          >
            <Mic size={20} className="me-2" />
            {isRecording ? t('recording.recording') : t('recording.startRecording')}
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
}
