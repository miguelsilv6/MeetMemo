import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Alert, Button, Card, Col, Form, Modal, Row } from '@govtechsg/sgds-react';
import { ArrowLeft, Clock, Pencil, Server, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ErrorAlert from '../Common/ErrorAlert';
import ProjectAudioList from './ProjectAudioList';
import ProjectUploadCard from './ProjectUploadCard';
import {
  deleteProject,
  deleteProjectAudio,
  getProject,
  retryProjectAudio,
  updateProject,
} from '../../services/projectsApi';
import { daysUntil, expiresSoon, formatDateTime } from '../../utils/projectDates';
import type { ApiError } from '../../types/api';
import type { ProjectAudio, ProjectDetail } from '../../types/projects';

/** How often the page refreshes while audios are queued or processing. */
export const PROJECT_POLL_MS = 3000;

interface ProjectViewProps {
  projectUuid: string;
  /** False for the administrator, who sees the project but uploads nothing. */
  canUpload?: boolean;
  onBack: () => void;
  onOpenAudio: (project: ProjectDetail, audio: ProjectAudio) => void;
}

type PendingDelete = { kind: 'project' } | { kind: 'audio'; audio: ProjectAudio };

/** One project: its details, expiry, uploads and the status of each audio. */
export default function ProjectView({
  projectUuid,
  canUpload = true,
  onBack,
  onOpenAudio,
}: ProjectViewProps) {
  const { t, i18n } = useTranslation();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: '', reference: '', description: '' });
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      setProject(await getProject(projectUuid));
    } catch (err) {
      if ((err as ApiError).status === 404) setNotFound(true);
      else setError((err as Error).message);
    }
  }, [projectUuid]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    load();
  }, [load]);

  // Refresh while anything is waiting or running on the server.
  const active = project?.audios.some((a) => a.status === 'queued' || a.status === 'processing');
  useEffect(() => {
    if (!active) return undefined;
    pollRef.current = setTimeout(load, PROJECT_POLL_MS);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [active, project, load]);

  const startEditing = () => {
    if (!project) return;
    setDraft({
      name: project.name,
      reference: project.reference ?? '',
      description: project.description ?? '',
    });
    setEditing(true);
  };

  const saveDetails = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.name.trim()) return;
    try {
      await updateProject(projectUuid, {
        name: draft.name.trim(),
        reference: draft.reference.trim() || null,
        description: draft.description.trim() || null,
      });
      setEditing(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const retry = async (audio: ProjectAudio) => {
    try {
      await retryProjectAudio(projectUuid, audio.uuid);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      if (pendingDelete.kind === 'project') {
        await deleteProject(projectUuid);
        onBack();
        return;
      }
      await deleteProjectAudio(projectUuid, pendingDelete.audio.uuid);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
  };

  const backButton = (
    <Button variant="link" className="px-0 mb-3" onClick={onBack}>
      <ArrowLeft size={16} className="me-1" />
      {t('projects.back')}
    </Button>
  );

  if (notFound) {
    return (
      <Row className="justify-content-center">
        <Col lg={10}>
          {backButton}
          <Alert show variant="warning">
            {t('projects.notFound')}
          </Alert>
        </Col>
      </Row>
    );
  }

  if (!project) {
    return (
      <Row className="justify-content-center">
        <Col lg={10}>
          {backButton}
          <ErrorAlert error={error} onClose={() => setError(null)} />
          <p className="text-muted">{t('common.loading')}</p>
        </Col>
      </Row>
    );
  }

  const days = daysUntil(project.expires_at);

  return (
    <Row className="justify-content-center">
      <Col lg={10}>
        {backButton}
        <ErrorAlert error={error} onClose={() => setError(null)} />

        <Card className="mb-4">
          <Card.Body>
            {editing ? (
              <Form onSubmit={saveDetails}>
                <Row>
                  <Col md={7}>
                    <Form.Group controlId="project-edit-name" className="mb-3">
                      <Form.Label>{t('projects.fields.name')}</Form.Label>
                      <Form.Control
                        value={draft.name}
                        maxLength={200}
                        required
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      />
                    </Form.Group>
                  </Col>
                  <Col md={5}>
                    <Form.Group controlId="project-edit-reference" className="mb-3">
                      <Form.Label>{t('projects.fields.reference')}</Form.Label>
                      <Form.Control
                        value={draft.reference}
                        maxLength={100}
                        onChange={(e) => setDraft({ ...draft, reference: e.target.value })}
                      />
                    </Form.Group>
                  </Col>
                </Row>
                <Form.Group controlId="project-edit-description" className="mb-3">
                  <Form.Label>{t('projects.fields.description')}</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={2}
                    maxLength={2000}
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </Form.Group>
                <div className="d-flex gap-2">
                  <Button type="submit" variant="primary" disabled={!draft.name.trim()}>
                    {t('common.save')}
                  </Button>
                  <Button variant="outline-secondary" onClick={() => setEditing(false)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </Form>
            ) : (
              <div className="d-flex flex-wrap justify-content-between gap-3">
                <div>
                  <h2 className="h4 mb-1">{project.name}</h2>
                  {project.reference && (
                    <div className="text-muted mb-1">
                      {t('projects.fields.reference')}: {project.reference}
                    </div>
                  )}
                  {project.description && (
                    <p className="mb-1 project-description">{project.description}</p>
                  )}
                  <small className="text-muted">
                    {t('projects.list.created', {
                      date: formatDateTime(project.created_at, i18n.language),
                    })}
                  </small>
                </div>
                <div className="d-flex align-items-start gap-2">
                  <Button variant="outline-secondary" size="sm" onClick={startEditing}>
                    <Pencil size={14} className="me-1" />
                    {t('common.edit')}
                  </Button>
                  <Button
                    variant="outline-danger"
                    size="sm"
                    onClick={() => setPendingDelete({ kind: 'project' })}
                  >
                    <Trash2 size={14} className="me-1" />
                    {t('projects.delete.button')}
                  </Button>
                </div>
              </div>
            )}

            <Alert
              show
              variant={expiresSoon(project.expires_at) ? 'danger' : 'warning'}
              className="mt-3 mb-0 d-flex align-items-start gap-2"
            >
              <Clock size={18} className="flex-shrink-0 mt-1" />
              <div>
                {t('projects.expiry.notice', {
                  date: formatDateTime(project.expires_at, i18n.language),
                  count: days,
                })}
              </div>
            </Alert>
          </Card.Body>
        </Card>

        {canUpload && <ProjectUploadCard projectUuid={projectUuid} onUploaded={load} />}

        <Card>
          <Card.Header className="d-flex flex-wrap justify-content-between align-items-center gap-2">
            <h5 className="mb-0">{t('projects.audios.title', { count: project.audios.length })}</h5>
            <small className="text-muted">
              <Server size={14} className="me-1" />
              {t('projects.audios.serverNotice')}
            </small>
          </Card.Header>
          <Card.Body className="p-0">
            <ProjectAudioList
              audios={project.audios}
              onOpen={(audio) => onOpenAudio(project, audio)}
              onRetry={retry}
              onDelete={(audio) => setPendingDelete({ kind: 'audio', audio })}
            />
          </Card.Body>
        </Card>

        <Modal show={!!pendingDelete} onHide={() => !busy && setPendingDelete(null)}>
          <Modal.Header closeButton>
            <Modal.Title>
              {pendingDelete?.kind === 'project'
                ? t('projects.delete.title')
                : t('projects.audios.deleteTitle')}
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {pendingDelete?.kind === 'project'
              ? t('projects.delete.body', { name: project.name, count: project.audios.length })
              : pendingDelete?.kind === 'audio' &&
                t('projects.audios.deleteBody', { name: pendingDelete.audio.file_name })}
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant="outline-secondary"
              onClick={() => setPendingDelete(null)}
              disabled={busy}
            >
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={busy}>
              {t('common.delete')}
            </Button>
          </Modal.Footer>
        </Modal>
      </Col>
    </Row>
  );
}
