import { useEffect } from 'react';
import type { ChangeEvent, DragEvent, RefObject } from 'react';
import { Row, Col } from '@govtechsg/sgds-react';
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
}: UploadViewProps) {
  const { t } = useTranslation();

  // Refetched on every visit, so a default changed in the admin panel shows up
  // as soon as the user comes back here.
  useEffect(() => {
    let cancelled = false;
    api
      .getPublicConfig()
      .then((config) => {
        if (!cancelled) onDefaultLanguage(config.default_language);
      })
      .catch(() => {
        // Keep auto-detect if the config can't be loaded.
      });
    return () => {
      cancelled = true;
    };
  }, [onDefaultLanguage]);

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
            />
          </Col>
        </Row>

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
