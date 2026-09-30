import { useState } from 'react';
import type { MouseEvent } from 'react';
import { Card, Badge, Button, Modal } from '@govtechsg/sgds-react';
import { Clock, AlertCircle, Trash2, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RecentJob } from '../../types/api';
import DetectedLanguage from '../Common/DetectedLanguage';
import SortOrderSelect from '../Common/SortOrderSelect';
import { formatDateTime } from '../../utils/projectDates';
import { sortByDate, useSortOrder } from '../../utils/sortOrder';

/** How many transcriptions show before "Show all". */
export const RECENT_JOBS_SHOWN = 5;
const SORT_STORAGE_KEY = 'meetmemo-recent-sort';

const isComplete = (job: RecentJob) => job.status_code === 200 || job.status_code === '200';

interface RecentJobsListProps {
  recentJobs: RecentJob[];
  loadingJobs: boolean;
  handleLoadJob: (job: RecentJob) => void;
  handleDeleteJob: (uuid: string) => Promise<void> | void;
  handleViewSummary: (job: RecentJob) => void;
}

export default function RecentJobsList({
  recentJobs,
  loadingJobs,
  handleLoadJob,
  handleDeleteJob,
  handleViewSummary,
}: RecentJobsListProps) {
  const { t, i18n } = useTranslation();
  const [pendingDeleteUuid, setPendingDeleteUuid] = useState<string | null>(null);
  const [order, setOrder] = useSortOrder(SORT_STORAGE_KEY, 'newest');
  const [showAll, setShowAll] = useState(false);
  const sorted = sortByDate(recentJobs, order);
  const shown = showAll ? sorted : sorted.slice(0, RECENT_JOBS_SHOWN);

  const onDeleteClick = (uuid: string, e: MouseEvent) => {
    e.stopPropagation();
    setPendingDeleteUuid(uuid);
  };

  const onViewSummaryClick = (job: RecentJob, e: MouseEvent) => {
    e.stopPropagation();
    handleViewSummary(job);
  };

  const onConfirmDelete = async () => {
    if (pendingDeleteUuid) {
      await handleDeleteJob(pendingDeleteUuid);
    }
    setPendingDeleteUuid(null);
  };

  return (
    <>
      <Card className="mt-4">
        <Card.Header className="d-flex flex-wrap justify-content-between align-items-center gap-2">
          <h5 className="mb-0">
            <Clock size={20} className="me-2" />
            {t('recentJobs.title')}
          </h5>
          {recentJobs.length > 1 && (
            <SortOrderSelect id="recent-jobs-sort" value={order} onChange={setOrder} />
          )}
        </Card.Header>
        <Card.Body className="p-0">
          {loadingJobs ? (
            <div className="text-center text-muted py-4">
              <div className="spinner-border spinner-border-sm me-2" role="status">
                <span className="visually-hidden">{t('common.loading')}</span>
              </div>
              <span>{t('recentJobs.loading')}</span>
            </div>
          ) : recentJobs.length > 0 ? (
            <div className="list-group list-group-flush">
              {shown.map((job) => (
                <div
                  key={job.uuid}
                  className="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleLoadJob(job)}
                >
                  <div className="flex-grow-1 recent-job-main">
                    <div className="fw-medium recent-job-name">
                      {job.filename || t('recentJobs.untitled')}
                      {job.owner && (
                        <span className="text-muted fw-normal small">
                          {' '}
                          · {t('auth.owner', { username: job.owner })}
                        </span>
                      )}
                    </div>
                    <div className="small text-muted d-flex flex-wrap recent-job-meta">
                      <span>
                        {t('recentJobs.imported')}:{' '}
                        {job.created_at
                          ? formatDateTime(job.created_at, i18n.language)
                          : t('recentJobs.dateUnknown')}
                      </span>
                      <span
                        className="d-inline-flex align-items-center gap-1"
                        data-testid="job-language"
                      >
                        {t('recentJobs.language')}:{' '}
                        <DetectedLanguage
                          language={job.detected_language}
                          probability={job.language_probability}
                          ready={isComplete(job)}
                        />
                      </span>
                    </div>
                  </div>
                  <div className="d-flex gap-2 align-items-center">
                    <Badge
                      bg={
                        job.status_code === 200 || job.status_code === '200'
                          ? 'success'
                          : job.status_code === 202 || job.status_code === '202'
                            ? 'warning'
                            : 'danger'
                      }
                    >
                      {job.status_code === 200 || job.status_code === '200'
                        ? t('recentJobs.statusComplete')
                        : job.status_code === 202 || job.status_code === '202'
                          ? t('recentJobs.statusProcessing')
                          : t('recentJobs.statusFailed')}
                    </Badge>
                    {job.has_summary && (
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0 d-flex align-items-center"
                        onClick={(e) => onViewSummaryClick(job, e)}
                        title={t('recentJobs.viewSummary')}
                        style={{ color: 'var(--primary)' }}
                      >
                        <Sparkles size={16} />
                      </Button>
                    )}
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0 text-danger d-flex align-items-center"
                      onClick={(e) => onDeleteClick(job.uuid, e)}
                      title={t('recentJobs.deleteThis')}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </div>
              ))}
              {recentJobs.length > RECENT_JOBS_SHOWN && (
                <div className="list-group-item text-center py-2">
                  <Button variant="link" size="sm" onClick={() => setShowAll(!showAll)}>
                    {showAll
                      ? t('recentJobs.showLess')
                      : t('recentJobs.showAll', { count: recentJobs.length })}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center text-muted py-4">
              <p className="mb-0">{t('recentJobs.empty')}</p>
            </div>
          )}
          <div className="card-footer text-muted small">
            <AlertCircle size={14} className="me-1" />
            {t('recentJobs.retentionNotice')}
          </div>
        </Card.Body>
      </Card>

      <Modal show={!!pendingDeleteUuid} onHide={() => setPendingDeleteUuid(null)}>
        <Modal.Header closeButton>
          <Modal.Title>{t('recentJobs.deleteModalTitle')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>{t('recentJobs.deleteModalBody')}</Modal.Body>
        <Modal.Footer>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => setPendingDeleteUuid(null)}
          >
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-outline-danger" onClick={onConfirmDelete}>
            {t('common.delete')}
          </button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
