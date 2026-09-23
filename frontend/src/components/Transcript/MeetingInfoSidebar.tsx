import { Card, Button, Badge } from '@govtechsg/sgds-react';
import { Sparkles, Download, AlertCircle, Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getSpeakerColor } from '../../utils/speakerColors';
import { getLanguageName } from '../../constants/languages';
import * as api from '../../services/api';
import type { SelectedFile, Transcript } from '../../types/api';

interface MeetingInfoSidebarProps {
  selectedFile: SelectedFile;
  transcript: Transcript | null;
  identifyingSpeakers: boolean;
  handleGenerateSummary: () => void;
  generatingSummary: boolean;
  jobId: string | null;
}

export default function MeetingInfoSidebar({
  selectedFile,
  transcript,
  identifyingSpeakers,
  handleGenerateSummary,
  generatingSummary,
  jobId,
}: MeetingInfoSidebarProps) {
  const { t } = useTranslation();

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
              <div className="d-flex align-items-center gap-1">
                <Languages size={14} className="text-muted" />
                <span>{getLanguageName(transcript.language)}</span>
                {typeof transcript.language_probability === 'number' && (
                  <span className="text-muted" title={t('meetingInfo.confidenceTitle')}>
                    ({Math.round(transcript.language_probability * 100)}%)
                  </span>
                )}
              </div>
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
            {identifyingSpeakers && (
              <div className="small text-muted">
                <Sparkles size={12} className="me-1" />
                {t('meetingInfo.identifyingSpeakers')}
              </div>
            )}
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
                {t('meetingInfo.generatingSummary')}
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
            onClick={() => jobId && api.downloadTranscriptPDF(jobId, selectedFile?.name)}
          >
            <Download size={18} className="me-2" />
            {t('meetingInfo.exportPdf')}
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
}
