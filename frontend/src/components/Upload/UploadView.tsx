import { useEffect } from 'react';
import type { ChangeEvent, DragEvent, RefObject } from 'react';
import { Row, Col, Button } from '@govtechsg/sgds-react';
import { FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import FileUploadCard from './FileUploadCard';
import RecentJobsList from './RecentJobsList';
import * as api from '../../services/api';
import type { RecentJob } from '../../types/api';

interface UploadViewProps {
  uploading: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleFileSelect: (event: ChangeEvent<HTMLInputElement>) => void;
  handleDragOver: (e: DragEvent<HTMLDivElement>) => void;
  handleDrop: (e: DragEvent<HTMLDivElement>) => void;
  recentJobs: RecentJob[];
  loadingJobs: boolean;
  handleLoadJob: (job: RecentJob) => void;
  handleDeleteJob: (uuid: string) => Promise<void> | void;
  handleViewSummary: (job: RecentJob) => void;
  selectedLanguage: string | null;
  onLanguageChange: (language: string | null) => void;
  /** Receives the admin-configured default language each time this view opens. */
  onDefaultLanguage: (language: string | null) => void;
  /** Largest file accepted, in MB (null until known). */
  maxUploadMb?: number | null;
  /** Receives the admin-configured upload limit each time this view opens. */
  onUploadLimit?: (maxUploadMb: number) => void;
  /** Open the projects page, for several audios of the same case. */
  onOpenProjects?: () => void;
}

export default function UploadView({
  uploading,
  fileInputRef,
  handleFileSelect,
  handleDragOver,
  handleDrop,
  recentJobs,
  loadingJobs,
  handleLoadJob,
  handleDeleteJob,
  handleViewSummary,
  selectedLanguage,
  onLanguageChange,
  onDefaultLanguage,
  maxUploadMb = null,
  onUploadLimit,
  onOpenProjects,
}: UploadViewProps) {
  const { t } = useTranslation();

  // Refetched on every visit, so a default changed in the admin panel shows up
  // as soon as the user comes back here.
  useEffect(() => {
    let cancelled = false;
    api
      .getPublicConfig()
      .then((config) => {
        if (cancelled) return;
        onDefaultLanguage(config.default_language);
        onUploadLimit?.(config.max_upload_mb);
      })
      .catch(() => {
        // Keep auto-detect if the config can't be loaded.
      });
    return () => {
      cancelled = true;
    };
  }, [onDefaultLanguage, onUploadLimit]);

  return (
    <Row className="justify-content-center">
      <Col lg={10}>
        <div className="text-center mb-4">
          <h2 className="mb-2">{t('upload.title')}</h2>
          <p className="text-muted">{t('upload.subtitle')}</p>
        </div>

        <Row className="g-4 justify-content-center">
          <Col md={8} lg={6}>
            <FileUploadCard
              uploading={uploading}
              fileInputRef={fileInputRef}
              handleFileSelect={handleFileSelect}
              handleDragOver={handleDragOver}
              handleDrop={handleDrop}
              selectedLanguage={selectedLanguage}
              onLanguageChange={onLanguageChange}
              maxUploadMb={maxUploadMb}
            />
          </Col>
        </Row>

        {onOpenProjects && (
          <p className="text-center text-muted small mt-3 mb-0">
            {t('projects.uploadHint')}{' '}
            <Button
              variant="link"
              size="sm"
              className="p-0 align-baseline"
              onClick={onOpenProjects}
            >
              <FolderOpen size={14} className="me-1" />
              {t('projects.uploadHintButton')}
            </Button>
          </p>
        )}

        <RecentJobsList
          recentJobs={recentJobs}
          loadingJobs={loadingJobs}
          handleLoadJob={handleLoadJob}
          handleDeleteJob={handleDeleteJob}
          handleViewSummary={handleViewSummary}
        />
      </Col>
    </Row>
  );
}
