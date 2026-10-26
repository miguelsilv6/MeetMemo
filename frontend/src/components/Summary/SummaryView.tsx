import { useState } from 'react';
import { Row, Col, Card, Button, Alert } from '@govtechsg/sgds-react';
import { Sparkles, Edit2, ArrowLeft, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SummaryContent from './SummaryContent';
import CollapsibleTranscript from './CollapsibleTranscript';
import ExportSidebar from './ExportSidebar';
import RegenerateSummaryModal from './RegenerateSummaryModal';
import type { LlmTask, SelectedFile, Summary, Transcript } from '../../types/api';
import type { SetCurrentStep } from '../../types/ui';

interface SummaryViewProps {
  summary: Summary | null;
  transcript: Transcript | null;
  selectedFile: SelectedFile;
  jobId: string | null;
  handleEditSummary: () => void;
  handleStartNewMeeting: () => void;
  setCurrentStep: SetCurrentStep;
  /** Asks for a new summary in place of this one; given to the administrator only. */
  handleRegenerateSummary?: () => void;
  generatingSummary?: boolean;
  summaryTask?: LlmTask | null;
  summaryError?: string | null;
}

export default function SummaryView({
  summary,
  transcript,
  selectedFile,
  jobId,
  handleEditSummary,
  handleStartNewMeeting,
  setCurrentStep,
  handleRegenerateSummary,
  generatingSummary = false,
  summaryTask = null,
  summaryError = null,
}: SummaryViewProps) {
  const { t } = useTranslation();
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  return (
    <Row>
      <Col lg={8}>
        <Card className="mb-4">
          <Card.Header className="d-flex justify-content-between align-items-center">
            <h5 className="mb-0">
              <Sparkles size={20} className="me-2" />
              {t('summary.title')}
            </h5>
            <div className="d-flex gap-2">
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={() => setCurrentStep('transcript')}
              >
                <ArrowLeft size={16} className="me-1" />
                {t('summary.backToTranscript')}
              </Button>
              <Button
                variant="outline-primary"
                size="sm"
                onClick={handleEditSummary}
                disabled={!summary?.summary || generatingSummary}
              >
                <Edit2 size={16} className="me-1" />
                {t('common.edit')}
              </Button>
              {handleRegenerateSummary && (
                <Button
                  variant="outline-primary"
                  size="sm"
                  onClick={() => setConfirmRegenerate(true)}
                  disabled={generatingSummary}
                >
                  {generatingSummary ? (
                    <>
                      <span
                        className="spinner-border spinner-border-sm me-1"
                        role="status"
                        aria-hidden="true"
                      ></span>
                      {summaryTask?.status === 'queued'
                        ? t('llmTask.queued', { count: summaryTask.queue_position ?? 0 })
                        : t('meetingInfo.generatingSummary')}
                    </>
                  ) : (
                    <>
                      <RefreshCw size={16} className="me-1" />
                      {t('summary.regenerate')}
                    </>
                  )}
                </Button>
              )}
            </div>
          </Card.Header>
          <Card.Body>
            {summaryError && !generatingSummary && (
              <Alert show variant="danger" className="py-2 px-3 small" role="alert">
                {summaryError}
              </Alert>
            )}
            <SummaryContent summary={summary} />
          </Card.Body>
        </Card>

        <CollapsibleTranscript
          transcript={transcript}
          showFullTranscript={showFullTranscript}
          setShowFullTranscript={setShowFullTranscript}
        />
      </Col>

      <Col lg={4}>
        <ExportSidebar
          jobId={jobId}
          selectedFile={selectedFile}
          handleStartNewMeeting={handleStartNewMeeting}
        />
      </Col>

      {handleRegenerateSummary && (
        <RegenerateSummaryModal
          show={confirmRegenerate}
          onHide={() => setConfirmRegenerate(false)}
          onConfirm={handleRegenerateSummary}
        />
      )}
    </Row>
  );
}
