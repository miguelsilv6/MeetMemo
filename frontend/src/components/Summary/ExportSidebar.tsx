import { Card, Button } from '@govtechsg/sgds-react';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import * as api from '../../services/api';
import type { SelectedFile } from '../../types/api';

interface ExportSidebarProps {
  jobId: string | null;
  selectedFile: SelectedFile;
  handleStartNewMeeting: () => void;
}

export default function ExportSidebar({
  jobId,
  selectedFile,
  handleStartNewMeeting,
}: ExportSidebarProps) {
  const { t } = useTranslation();

  return (
    <Card className="sticky-sidebar">
      <Card.Header>
        <h5 className="mb-0">{t('summary.exportOptions')}</h5>
      </Card.Header>
      <Card.Body>
        <h6 className="mb-2 small text-muted">{t('summary.summaryPlusTranscript')}</h6>
        <Button
          variant="primary"
          className="w-100 mb-3"
          onClick={() => jobId && api.downloadMarkdown(jobId, selectedFile?.name)}
        >
          <Download size={18} className="me-2" />
          {t('summary.exportMarkdown')}
        </Button>

        <h6 className="mb-2 small text-muted">{t('summary.transcriptOnly')}</h6>
        <Button
          variant="outline-secondary"
          className="w-100 mb-2"
          onClick={() => jobId && api.downloadTranscriptMarkdown(jobId, selectedFile?.name)}
        >
          <Download size={18} className="me-2" />
          {t('summary.exportMarkdown')}
        </Button>
        <Button
          variant="outline-secondary"
          className="w-100 mb-3"
          onClick={() => jobId && api.downloadTranscriptDocx(jobId, selectedFile?.name)}
        >
          <Download size={18} className="me-2" />
          {t('summary.exportWord')}
        </Button>

        <hr />

        <Button variant="outline-secondary" className="w-100" onClick={handleStartNewMeeting}>
          {t('summary.startNewMeeting')}
        </Button>
      </Card.Body>
    </Card>
  );
}
