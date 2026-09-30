import { Badge, Button, ProgressBar } from '@govtechsg/sgds-react';
import { FileText, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProjectAudio } from '../../types/projects';
import DetectedLanguage from '../Common/DetectedLanguage';
import SortOrderSelect from '../Common/SortOrderSelect';
import { formatDateTime } from '../../utils/projectDates';
import { sortByDate, useSortOrder } from '../../utils/sortOrder';

const SORT_STORAGE_KEY = 'meetmemo-project-audios-sort';

interface ProjectAudioListProps {
  audios: ProjectAudio[];
  onOpen: (audio: ProjectAudio) => void;
  onRetry: (audio: ProjectAudio) => void;
  onDelete: (audio: ProjectAudio) => void;
}

const STATUS_BADGE: Record<ProjectAudio['status'], string> = {
  queued: 'secondary',
  processing: 'info',
  completed: 'success',
  error: 'danger',
};

/** The project's audios with their import date, language, status and actions. */
export default function ProjectAudioList({
  audios,
  onOpen,
  onRetry,
  onDelete,
}: ProjectAudioListProps) {
  const { t, i18n } = useTranslation();
  // Import order (the queue's) unless the user chose otherwise.
  const [order, setOrder] = useSortOrder(SORT_STORAGE_KEY, 'oldest');

  if (audios.length === 0) {
    return <p className="text-muted text-center py-4 mb-0">{t('projects.audios.empty')}</p>;
  }

  return (
    <>
      {audios.length > 1 && (
        <div className="d-flex justify-content-end px-3 pt-3 pb-1">
          <SortOrderSelect id="project-audios-sort" value={order} onChange={setOrder} />
        </div>
      )}
      <ul className="list-group list-group-flush project-audio-list">
        <li className="list-group-item project-audio-item project-audio-header" aria-hidden="true">
          <div className="project-audio-name">{t('projects.audios.columns.audio')}</div>
          <div className="project-audio-date">{t('projects.audios.columns.imported')}</div>
          <div className="project-audio-language">{t('projects.audios.columns.language')}</div>
          <div className="project-audio-status">{t('projects.audios.columns.status')}</div>
          <div className="project-audio-actions" />
        </li>
        {sortByDate(audios, order).map((audio) => (
          <li
            key={audio.uuid}
            className="list-group-item project-audio-item"
            data-status={audio.status}
          >
            <div className="project-audio-name">
              {audio.status === 'completed' ? (
                <Button
                  variant="link"
                  className="p-0 text-start"
                  onClick={() => onOpen(audio)}
                  title={t('projects.audios.open')}
                >
                  {audio.file_name}
                </Button>
              ) : (
                audio.file_name
              )}
            </div>
            <div className="project-audio-date small">
              <span className="project-audio-label">{t('projects.audios.columns.imported')}: </span>
              {formatDateTime(audio.created_at, i18n.language)}
            </div>
            <div className="project-audio-language small" data-testid="audio-language">
              <span className="project-audio-label">{t('projects.audios.columns.language')}: </span>
              <DetectedLanguage
                language={audio.detected_language}
                probability={audio.language_probability}
                ready={audio.status === 'completed'}
              />
            </div>
            <div className="project-audio-status">
              <Badge bg={STATUS_BADGE[audio.status]}>
                {audio.status === 'queued' && audio.queue_position
                  ? t('projects.audios.queuedAt', { position: audio.queue_position })
                  : audio.status === 'processing'
                    ? t('projects.audios.processingAt', { progress: audio.progress })
                    : t(`projects.audios.statuses.${audio.status}`)}
              </Badge>
              {audio.status === 'processing' && (
                <ProgressBar
                  now={audio.progress}
                  className="mt-1 project-audio-progress"
                  aria-label={t('projects.audios.progress', { progress: audio.progress })}
                />
              )}
              {audio.status === 'error' && audio.error_message && (
                <small className="d-block text-danger mt-1">{audio.error_message}</small>
              )}
            </div>
            <div className="project-audio-actions">
              {audio.status === 'completed' && (
                <Button variant="outline-primary" size="sm" onClick={() => onOpen(audio)}>
                  <FileText size={14} className="me-1" />
                  {t('projects.audios.open')}
                </Button>
              )}
              {audio.status === 'error' && (
                <Button variant="outline-secondary" size="sm" onClick={() => onRetry(audio)}>
                  <RotateCcw size={14} className="me-1" />
                  {t('projects.audios.retry')}
                </Button>
              )}
              <Button
                variant="link"
                size="sm"
                className="text-danger"
                onClick={() => onDelete(audio)}
                title={t('projects.audios.delete')}
                aria-label={t('projects.audios.deleteNamed', { name: audio.file_name })}
              >
                <Trash2 size={16} />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
