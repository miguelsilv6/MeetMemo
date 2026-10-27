import AudioExpiry from './AudioExpiry';
import { useState } from 'react';
import { Alert, Card, Button, Badge } from '@govtechsg/sgds-react';
import {
  Sparkles,
  Download,
  AlertCircle,
  Languages,
  FileText,
  RotateCcw,
  RefreshCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getSpeakerColor } from '../../utils/speakerColors';
import { getLanguageName } from '../../constants/languages';
import { getConfidenceVariant, isLowConfidence } from '../../utils/confidence';
import RetranscribeModal from './RetranscribeModal';
import ReprocessModal from './ReprocessModal';
import * as api from '../../services/api';
import type { LlmTask, SelectedFile, Summary, Transcript } from '../../types/api';

interface MeetingInfoSidebarProps {
  selectedFile: SelectedFile;
  transcript: Transcript | null;
  handleGenerateSummary: () => void;
  generatingSummary: boolean;
  summaryTask?: LlmTask | null;
  /** Why the last summary could not be made, shown under its button. */
  summaryError?: string | null;
  summary: Summary | null;
  jobId: string | null;
  /** Transcribe the audio again in another language (offered on low confidence). */
  onRetranscribe?: (language: string) => Promise<void>;
  /** Pre-selected language for that. */
  retranscribeLanguage?: string | null;
  /** Process the audio again from the very start (given to the administrator only). */
  onReprocess?: () => Promise<void>;
  /** The administrator: can keep an audio outside a project until a later date. */
  isAdmin?: boolean;
}

export default function MeetingInfoSidebar({
  selectedFile,
  transcript,
  handleGenerateSummary,
  generatingSummary,
  summaryTask = null,
  summaryError = null,
  summary,
  jobId,
  onRetranscribe,
  retranscribeLanguage = null,
  onReprocess,
  isAdmin = false,
}: MeetingInfoSidebarProps) {
  const { t } = useTranslation();
  const [showRetranscribe, setShowRetranscribe] = useState(false);
  const [showReprocess, setShowReprocess] = useState(false);
  const detection = transcript?.language_detection ?? null;
  const channels = detection?.channels ?? [];
  // A call transcribed per channel: any side's doubts count.
  const flags = [...new Set([...(detection?.flags ?? []), ...channels.flatMap((c) => c.flags)])];
  const otherCandidates = (detection?.candidates ?? []).slice(1).filter(([, p]) => p >= 0.01);
  // Suggest the runner-up language, else the admin's default.
  const retranscribeSuggestion = otherCandidates[0]?.[0] ?? retranscribeLanguage;
  const lowConfidence =
    (typeof transcript?.language_probability === 'number' &&
      isLowConfidence(transcript.language_probability)) ||
    flags.length > 0;

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
          {jobId && (
            <AudioExpiry
              key={jobId}
              jobId={jobId}
              fileName={selectedFile?.name || t('common.unknown')}
              isAdmin={isAdmin}
            />
          )}
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
              <small className="text-muted">
                {detection?.forced ? t('meetingInfo.language') : t('meetingInfo.detectedLanguage')}
              </small>
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
              {detection?.forced && (
                <div className="small text-muted mt-1">{t('meetingInfo.languageForced')}</div>
              )}
              {otherCandidates.length > 0 && (
                <div className="small text-muted mt-1" data-testid="language-candidates">
                  {t('meetingInfo.otherCandidates', {
                    list: otherCandidates
                      .map(([code, p]) => `${getLanguageName(code)} ${Math.round(p * 100)}%`)
                      .join(' · '),
                  })}
                </div>
              )}
              {channels.length > 0 && (
                <ul className="list-unstyled small mt-2 mb-0" data-testid="channel-languages">
                  {channels.map((channel) => (
                    <li key={channel.channel} className="mb-1">
                      <div className="text-muted">
                        {t(`meetingInfo.channels.${channel.channel === 0 ? 'left' : 'right'}`, {
                          speaker: channel.display_name ?? channel.speaker,
                        })}
                      </div>
                      <div className="d-flex align-items-center gap-1">
                        <span>{getLanguageName(channel.language)}</span>
                        {typeof channel.probability === 'number' && (
                          <Badge bg={getConfidenceVariant(channel.probability)}>
                            {Math.round(channel.probability * 100)}%
                          </Badge>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {flags.map((flag) => (
                <div
                  key={flag}
                  className="small text-warning-emphasis d-flex gap-1 mt-1"
                  data-testid={`language-flag-${flag}`}
                >
                  <AlertCircle size={14} className="flex-shrink-0 mt-1" />
                  <span>{t(`meetingInfo.languageFlags.${flag}`)}</span>
                </div>
              ))}
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
          {summaryError && !generatingSummary && (
            <Alert
              show
              variant="danger"
              className="py-2 px-3 mb-2 small"
              data-testid="summary-error"
              role="alert"
            >
              {summaryError}
            </Alert>
          )}
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
          {onReprocess && (
            <Button
              variant="outline-danger"
              className="w-100 mb-2"
              onClick={() => setShowReprocess(true)}
            >
              <RefreshCw size={18} className="me-2" />
              {t('reprocess.open')}
            </Button>
          )}
        </div>
      </Card.Body>
      {onReprocess && (
        <ReprocessModal
          show={showReprocess}
          onHide={() => setShowReprocess(false)}
          onConfirm={async () => {
            await onReprocess();
            setShowReprocess(false);
          }}
        />
      )}
      {onRetranscribe && (
        <RetranscribeModal
          // Remounted when the suggestion changes (it arrives with the transcript).
          key={retranscribeSuggestion ?? ''}
          show={showRetranscribe}
          onHide={() => setShowRetranscribe(false)}
          onConfirm={async (language) => {
            await onRetranscribe(language);
            setShowRetranscribe(false);
          }}
          detectedLanguage={transcript?.language ?? null}
          defaultLanguage={retranscribeSuggestion}
          channelsDiffer={new Set(channels.map((c) => c.language)).size > 1}
        />
      )}
    </Card>
  );
}
