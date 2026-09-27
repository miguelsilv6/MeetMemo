import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Badge, Button, Card, Col, Form, Row } from '@govtechsg/sgds-react';
import { Clock, FolderOpen, FolderPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ErrorAlert from '../Common/ErrorAlert';
import { createProject, listProjects } from '../../services/projectsApi';
import { daysUntil, expiresSoon, formatDateTime } from '../../utils/projectDates';
import type { ProjectSummary } from '../../types/projects';

interface ProjectsViewProps {
  onOpenProject: (uuid: string) => void;
}

const MAX_NAME = 200;
const MAX_REFERENCE = 100;
const MAX_DESCRIPTION = 2000;

/** Every project, and a form to create one. */
export default function ProjectsView({ onOpenProject }: ProjectsViewProps) {
  const { t, i18n } = useTranslation();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await listProjects();
      setProjects(response.projects);
      setRetentionDays(response.retention_days);
      setError(null);
    } catch (err) {
      setProjects([]);
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    load();
  }, [load]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const project = await createProject({
        name: name.trim(),
        reference: reference.trim() || null,
        description: description.trim() || null,
      });
      onOpenProject(project.uuid);
    } catch (err) {
      setError((err as Error).message);
      setCreating(false);
    }
  };

  return (
    <Row className="justify-content-center">
      <Col lg={10}>
        <div className="text-center mb-4">
          <h2 className="mb-2">{t('projects.title')}</h2>
          <p className="text-muted">{t('projects.subtitle')}</p>
        </div>

        <ErrorAlert error={error} onClose={() => setError(null)} />

        <Card className="mb-4">
          <Card.Header>
            <h5 className="mb-0">
              <FolderPlus size={20} className="me-2" />
              {t('projects.create.title')}
            </h5>
          </Card.Header>
          <Card.Body>
            <Form onSubmit={handleCreate}>
              <Row>
                <Col md={7}>
                  <Form.Group controlId="project-name" className="mb-3">
                    <Form.Label>{t('projects.fields.name')}</Form.Label>
                    <Form.Control
                      value={name}
                      maxLength={MAX_NAME}
                      required
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t('projects.fields.namePlaceholder')}
                    />
                  </Form.Group>
                </Col>
                <Col md={5}>
                  <Form.Group controlId="project-reference" className="mb-3">
                    <Form.Label>{t('projects.fields.reference')}</Form.Label>
                    <Form.Control
                      value={reference}
                      maxLength={MAX_REFERENCE}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder={t('projects.fields.referencePlaceholder')}
                    />
                  </Form.Group>
                </Col>
              </Row>
              <Form.Group controlId="project-description" className="mb-3">
                <Form.Label>{t('projects.fields.description')}</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={2}
                  value={description}
                  maxLength={MAX_DESCRIPTION}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Form.Group>
              <div className="d-flex flex-wrap align-items-center gap-3">
                <Button type="submit" variant="primary" disabled={creating || !name.trim()}>
                  <FolderPlus size={16} className="me-2" />
                  {creating ? t('projects.create.creating') : t('projects.create.submit')}
                </Button>
                {retentionDays !== null && (
                  <small className="text-muted">
                    <Clock size={14} className="me-1" />
                    {t('projects.create.retention', { count: retentionDays })}
                  </small>
                )}
              </div>
            </Form>
          </Card.Body>
        </Card>

        <Card>
          <Card.Header>
            <h5 className="mb-0">
              <FolderOpen size={20} className="me-2" />
              {t('projects.list.title')}
            </h5>
          </Card.Header>
          <Card.Body className="p-0">
            {projects === null ? (
              <p className="text-muted text-center py-4 mb-0">{t('common.loading')}</p>
            ) : projects.length === 0 ? (
              <p className="text-muted text-center py-4 mb-0">{t('projects.list.empty')}</p>
            ) : (
              <div className="list-group list-group-flush">
                {projects.map((project) => (
                  <button
                    type="button"
                    key={project.uuid}
                    className="list-group-item list-group-item-action project-list-item"
                    onClick={() => onOpenProject(project.uuid)}
                  >
                    <div className="d-flex flex-wrap justify-content-between gap-2">
                      <div className="text-start">
                        <div className="fw-medium">
                          {project.name}
                          {project.reference && (
                            <span className="text-muted fw-normal"> · {project.reference}</span>
                          )}
                        </div>
                        <small className="text-muted">
                          {t('projects.list.created', {
                            date: formatDateTime(project.created_at, i18n.language),
                          })}
                        </small>
                      </div>
                      <div className="d-flex flex-wrap align-items-center gap-2">
                        <Badge bg="secondary">
                          {t('projects.list.progress', {
                            done: project.completed_count,
                            count: project.audio_count,
                          })}
                        </Badge>
                        {project.error_count > 0 && (
                          <Badge bg="danger">
                            {t('projects.list.errors', { count: project.error_count })}
                          </Badge>
                        )}
                        <Badge bg={expiresSoon(project.expires_at) ? 'danger' : 'warning'}>
                          {t('projects.expiry.badge', { count: daysUntil(project.expires_at) })}
                        </Badge>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card.Body>
        </Card>
      </Col>
    </Row>
  );
}
