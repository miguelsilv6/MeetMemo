import { useState } from 'react';
import { Card, Button, Badge } from '@govtechsg/sgds-react';
import { Sparkles, Download, AlertCircle, Languages, FileText, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getSpeakerColor } from '../../utils/speakerColors';
import { getLanguageName } from '../../constants/languages';
import { getConfidenceVariant, isLowConfidence } from '../../utils/confidence';
import RetranscribeModal from './RetranscribeModal';
import * as api from '../../services/api';
import type { LlmTask, SelectedFile, Summary, Transcript } from '../../types/api';

interface MeetingInfoSidebarProps {
  selectedFile: SelectedFile;
  transcript: Transcript | null;
  handleGenerateSummary: () => void;
  generatingSummary: boolean;
  summaryTask?: LlmTask | null;
  summary: Summary | null;
  jobId: string | null;
  /** Transcribe the audio again in another language (offered on low confidence). */
  onRetranscribe?: (language: string) => Promise<void>;
  /** Pre-selected language for that. */
  retranscribeLanguage?: string | null;
}

export default function MeetingInfoSidebar({
  selectedFile,
  transcript,
  handleGenerateSummary,
  generatingSummary,
  summaryTask = null,
  summary,
  jobId,
  onRetranscribe,
  retranscribeLanguage = null,
}: MeetingInfoSidebarProps) {
  const { t } = useTranslation();
  const [showRetranscribe, setShowRetranscribe] = useState(false);
  const lowConfidence =
    typeof transcript?.language_probability === 'number' &&
    isLowConfidence(transcript.language_probability);

  return (
    <Card className="sticky-sidebar">
      <Card.Header>
        <h5 className="mb-0">{t('meetingInfo.title')}</h5>
      </Card.Header>
      <Card.Body>
        <div className="meeting-info mb-4">
          <div className="info-item mb-3">
            <small className="text-muted">{t('meetingInfo.fileName')}</small>
            <div>{selectedFile?.name || t('common.unknown')}</div>
          </div>
          <div className="info-item mb-3">
            <small className="text-muted">{t('meetingInfo.duration')}</small>
            <div>
              {transcript?.segments && transcript.segments.length > 0
                ? `${Math.floor(transcript.segments[transcript.segments.length - 1].end / 60)}:${String(Math.floor(transcript.segments[transcript.segments.length - 1].end % 60)).padStart(2, '0')}`
                : t('common.notAvailable')}
            </div>
          </div>
          {transcript?.language && (
            <div className="info-item mb-3">
              <small className="text-muted">{t('meetingInfo.detectedLanguage')}</small>
              <div className="d-flex align-items-center gap-1 flex-wrap">
                <Languages size={14} className="text-muted" />
                <span>{getLanguageName(transcript.language)}</span>
                {typeof transcript.language_probability === 'number' && (
                  <Badge
                    bg={getConfidenceVariant(transcript.language_probability)}
                    title={t('meetingInfo.confidenceTitle')}
                  >
                    {Math.round(transcript.language_probability * 100)}%
                  </Badge>
                )}
              </div>
              {lowConfidence && onRetranscribe && (
                <div className="low-confidence-note small mt-2" data-testid="low-confidence">
                  <p className="text-muted mb-1">{t('retranscribe.lowConfidence')}</p>
                  <Button
                    variant="outline-primary"
                    size="sm"
                    onClick={() => setShowRetranscribe(true)}
                  >
                    <RotateCcw size={14} className="me-1" />
                    {t('retranscribe.open')}
                  </Button>
                </div>
              )}
            </div>
          )}
          <div className="info-item mb-3">
            <small className="text-muted">{t('meetingInfo.speakers')}</small>
            <div className="mb-2 d-flex flex-wrap gap-1">
              {transcript?.segments ? (
                [...new Set(transcript.segments.map((s) => s.speaker))].map((speaker) => (
                  <Badge
                    key={speaker}
                    title={speaker}
                    className="text-truncate"
                    style={{
                      backgroundColor: getSpeakerColor(speaker).bg,
                      color: getSpeakerColor(speaker).text,
                      maxWidth: '160px',
                    }}
                  >
                    {speaker}
                  </Badge>
                ))
              ) : (
                <span className="text-muted">{t('common.notAvailable')}</span>
              )}
            </div>
            <div className="small text-muted" style={{ fontSize: '0.75rem', lineHeight: '1.3' }}>
              <AlertCircle size={12} className="me-1" />
              {t('meetingInfo.speakerHint')}
            </div>
          </div>
        </div>

        <hr />

        <div className="actions">
          <h6 className="mb-3">{t('meetingInfo.nextSteps')}</h6>
          <Button
            variant="primary"
            className="w-100 mb-2"
            onClick={handleGenerateSummary}
            disabled={generatingSummary}
          >
            {generatingSummary ? (
              <>
                <span
                  className="spinner-border spinner-border-sm me-2"
                  role="status"
                  aria-hidden="true"
                ></span>
                {summaryTask?.status === 'queued'
                  ? t('llmTask.queued', { count: summaryTask.queue_position ?? 0 })
                  : t('meetingInfo.generatingSummary')}
              </>
            ) : summary?.summary ? (
              <>
                <FileText size={18} className="me-2" />
                {t('meetingInfo.viewSummary')}
              </>
            ) : (
              <>
                <Sparkles size={18} className="me-2" />
                {t('meetingInfo.generateSummary')}
              </>
            )}
          </Button>
          <Button
            variant="outline-secondary"
            className="w-100 mb-2"
            onClick={() => jobId && api.downloadTranscriptMarkdown(jobId, selectedFile?.name)}
          >
            <Download size={18} className="me-2" />
            {t('meetingInfo.exportMarkdown')}
          </Button>
          <Button
            variant="outline-secondary"
            className="w-100 mb-2"
            onClick={() => jobId && api.downloadTranscriptDocx(jobId, selectedFile?.name)}
          >
            <Download size={18} className="me-2" />
            {t('meetingInfo.exportWord')}
          </Button>
        </div>
      </Card.Body>
      {onRetranscribe && (
        <RetranscribeModal
          show={showRetranscribe}
          onHide={() => setShowRetranscribe(false)}
          onConfirm={async (language) => {
            await onRetranscribe(language);
            setShowRetranscribe(false);
          }}
          detectedLanguage={transcript?.language ?? null}
          defaultLanguage={retranscribeLanguage}
        />
      )}
    </Card>
  );
}
