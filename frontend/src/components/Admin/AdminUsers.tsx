import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Alert, Badge, Button, Card, Col, Form, Modal, Row, Table } from '@govtechsg/sgds-react';
import { ExternalLink, KeyRound, Trash2, UserPlus, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  AdminApiError,
  createUser,
  deleteUser,
  getUserContent,
  listUsers,
  resetUserPassword,
  updateUser,
} from '../../services/adminApi';
import { jobRoute, projectRoute } from '../../hooks/useHashRoute';
import { formatDateTime } from '../../utils/projectDates';
import type { AdminUser, UserContent } from '../../types/admin';

export const MIN_PASSWORD_LENGTH = 12;

interface AdminUsersProps {
  /** After any change, so the audit trail can refresh. */
  onChanged: () => void;
  onUnauthorized: () => void;
}

type Dialog =
  | { kind: 'password'; user: AdminUser }
  | { kind: 'delete'; user: AdminUser }
  | { kind: 'content'; user: AdminUser; content: UserContent | null };

/** User accounts: create, (de)activate, reset password, delete, open their content. */
export default function AdminUsers({ onChanged, onUnauthorized }: AdminUsersProps) {
  const { t, i18n } = useTranslation();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState({ username: '', displayName: '', password: '' });
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [dialogInput, setDialogInput] = useState('');
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof AdminApiError && err.status === 401) {
        onUnauthorized();
        return;
      }
      setError(err instanceof Error ? err.message : t('errors.unknown'));
    },
    [onUnauthorized, t]
  );

  const load = useCallback(async () => {
    try {
      setUsers(await listUsers());
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    load();
  }, [load]);

  const afterChange = async (message: string) => {
    setNotice(message);
    setError(null);
    await load();
    onChanged();
  };

  const passwordTooShort = draft.password.length > 0 && draft.password.length < MIN_PASSWORD_LENGTH;
  const canCreate =
    /^[A-Za-z0-9._@-]{3,100}$/.test(draft.username) &&
    draft.displayName.trim().length > 0 &&
    draft.password.length >= MIN_PASSWORD_LENGTH &&
    !creating;

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!canCreate) return;
    setCreating(true);
    try {
      const user = await createUser(draft.username, draft.displayName.trim(), draft.password);
      setDraft({ username: '', displayName: '', password: '' });
      await afterChange(t('admin.users.created', { username: user.username }));
    } catch (err) {
      fail(err);
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (user: AdminUser) => {
    try {
      await updateUser(user.uuid, { is_active: !user.is_active });
      await afterChange(
        t(user.is_active ? 'admin.users.deactivated' : 'admin.users.activated', {
          username: user.username,
        })
      );
    } catch (err) {
      fail(err);
    }
  };

  const openDialog = async (next: Dialog) => {
    setDialog(next);
    setDialogInput('');
    if (next.kind === 'content') {
      try {
        const content = await getUserContent(next.user.uuid);
        setDialog({ ...next, content });
      } catch (err) {
        setDialog(null);
        fail(err);
      }
    }
  };

  const confirmDialog = async () => {
    if (!dialog || dialog.kind === 'content') return;
    setBusy(true);
    try {
      if (dialog.kind === 'password') {
        await resetUserPassword(dialog.user.uuid, dialogInput);
        await afterChange(t('admin.users.passwordReset', { username: dialog.user.username }));
      } else {
        await deleteUser(dialog.user.uuid);
        await afterChange(t('admin.users.deleted', { username: dialog.user.username }));
      }
      setDialog(null);
    } catch (err) {
      fail(err);
      setDialog(null);
    } finally {
      setBusy(false);
    }
  };

  const dialogReady =
    dialog?.kind === 'password'
      ? dialogInput.length >= MIN_PASSWORD_LENGTH
      : dialog?.kind === 'delete'
        ? dialogInput === dialog.user.username
        : false;

  const date = (iso: string | null) => (iso ? formatDateTime(iso, i18n.language) : '—');

  return (
    <Card className="mb-4">
      <Card.Header>
        <h5 className="mb-0 d-flex align-items-center gap-2">
          <Users size={18} />
          {t('admin.users.title')}
        </h5>
      </Card.Header>
      <Card.Body>
        {error && (
          <Alert show variant="danger" role="alert" onClose={() => setError(null)} dismissible>
            {error}
          </Alert>
        )}
        {notice && (
          <Alert show variant="success" role="status" onClose={() => setNotice(null)} dismissible>
            {notice}
          </Alert>
        )}

        <Form onSubmit={handleCreate} noValidate className="mb-4">
          <h6>{t('admin.users.createTitle')}</h6>
          <Row>
            <Col md={4}>
              <Form.Group controlId="new-user-username" className="mb-2">
                <Form.Label>{t('admin.users.username')}</Form.Label>
                <Form.Control
                  value={draft.username}
                  autoComplete="off"
                  onChange={(e) => setDraft({ ...draft, username: e.target.value.trim() })}
                />
                <Form.Text className="text-muted">{t('admin.users.usernameHelp')}</Form.Text>
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group controlId="new-user-name" className="mb-2">
                <Form.Label>{t('admin.users.displayName')}</Form.Label>
                <Form.Control
                  value={draft.displayName}
                  onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
                />
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group controlId="new-user-password" className="mb-2">
                <Form.Label>{t('admin.users.temporaryPassword')}</Form.Label>
                <Form.Control
                  type="password"
                  autoComplete="new-password"
                  value={draft.password}
                  isInvalid={passwordTooShort}
                  onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                />
                {passwordTooShort && (
                  <div className="invalid-feedback d-block">
                    {t('admin.password.tooShort', { min: MIN_PASSWORD_LENGTH })}
                  </div>
                )}
              </Form.Group>
            </Col>
          </Row>
          <div className="d-flex flex-wrap align-items-center gap-3">
            <Button type="submit" variant="primary" disabled={!canCreate}>
              <UserPlus size={16} className="me-2" />
              {t('admin.users.create')}
            </Button>
            <small className="text-muted">{t('admin.users.createHint')}</small>
          </div>
        </Form>

        {users === null ? (
          <p className="text-muted mb-0">{t('common.loading')}</p>
        ) : users.length === 0 ? (
          <p className="text-muted mb-0">{t('admin.users.empty')}</p>
        ) : (
          <div className="table-responsive">
            <Table size="sm" className="mb-0 align-middle admin-users-table">
              <thead>
                <tr>
                  <th scope="col">{t('admin.users.user')}</th>
                  <th scope="col">{t('admin.users.state')}</th>
                  <th scope="col">{t('admin.users.owned')}</th>
                  <th scope="col">{t('admin.users.lastLogin')}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t('admin.users.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.uuid} data-username={user.username}>
                    <td>
                      <div className="fw-medium">{user.display_name}</div>
                      <small className="text-muted">{user.username}</small>
                    </td>
                    <td>
                      <Badge bg={user.is_active ? 'success' : 'secondary'}>
                        {user.is_active ? t('admin.users.active') : t('admin.users.inactive')}
                      </Badge>
                      {user.must_change_password && (
                        <Badge bg="warning" text="dark" className="ms-1">
                          {t('admin.users.temporary')}
                        </Badge>
                      )}
                    </td>
                    <td className="text-nowrap">
                      {t('admin.users.ownedProjects', { count: user.project_count })},{' '}
                      {t('admin.users.ownedAudios', { count: user.audio_count })}
                    </td>
                    <td className="text-nowrap small">{date(user.last_login_at)}</td>
                    <td className="text-end text-nowrap">
                      <Button
                        variant="outline-primary"
                        size="sm"
                        onClick={() => openDialog({ kind: 'content', user, content: null })}
                      >
                        <ExternalLink size={14} className="me-1" />
                        {t('admin.users.content')}
                      </Button>{' '}
                      <Button
                        variant="outline-secondary"
                        size="sm"
                        onClick={() => toggleActive(user)}
                      >
                        {user.is_active ? t('admin.users.deactivate') : t('admin.users.activate')}
                      </Button>{' '}
                      <Button
                        variant="outline-secondary"
                        size="sm"
                        onClick={() => openDialog({ kind: 'password', user })}
                        aria-label={t('admin.users.resetPasswordFor', { username: user.username })}
                        title={t('admin.users.resetPassword')}
                      >
                        <KeyRound size={14} />
                      </Button>{' '}
                      <Button
                        variant="outline-danger"
                        size="sm"
                        onClick={() => openDialog({ kind: 'delete', user })}
                        aria-label={t('admin.users.deleteFor', { username: user.username })}
                        title={t('admin.users.delete')}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card.Body>

      <Modal
        show={!!dialog}
        onHide={() => !busy && setDialog(null)}
        size={dialog?.kind === 'content' ? 'lg' : undefined}
      >
        <Modal.Header closeButton>
          <Modal.Title>
            {dialog?.kind === 'password' && t('admin.users.resetPassword')}
            {dialog?.kind === 'delete' && t('admin.users.delete')}
            {dialog?.kind === 'content' &&
              t('admin.users.contentOf', { name: dialog.user.display_name })}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {dialog?.kind === 'password' && (
            <Form.Group controlId="reset-password">
              <p>{t('admin.users.resetPasswordBody', { username: dialog.user.username })}</p>
              <Form.Label>{t('admin.users.temporaryPassword')}</Form.Label>
              <Form.Control
                type="password"
                autoComplete="new-password"
                value={dialogInput}
                onChange={(e) => setDialogInput(e.target.value)}
              />
              <Form.Text className="text-muted">
                {t('admin.password.tooShort', { min: MIN_PASSWORD_LENGTH })}
              </Form.Text>
            </Form.Group>
          )}
          {dialog?.kind === 'delete' && (
            <Form.Group controlId="delete-user-confirm">
              <p>
                {t('admin.users.deleteBody', {
                  username: dialog.user.username,
                  projects: dialog.user.project_count,
                  audios: dialog.user.audio_count,
                })}
              </p>
              <Form.Label>
                {t('admin.users.deleteConfirm', { username: dialog.user.username })}
              </Form.Label>
              <Form.Control
                value={dialogInput}
                autoComplete="off"
                onChange={(e) => setDialogInput(e.target.value)}
              />
            </Form.Group>
          )}
          {dialog?.kind === 'content' &&
            (dialog.content === null ? (
              <p className="text-muted mb-0">{t('common.loading')}</p>
            ) : (
              <>
                <h6>{t('projects.title')}</h6>
                {dialog.content.projects.length === 0 ? (
                  <p className="text-muted small">{t('admin.users.noProjects')}</p>
                ) : (
                  <ul className="admin-user-content">
                    {dialog.content.projects.map((project) => (
                      <li key={project.uuid}>
                        <a href={`/${projectRoute(project.uuid)}`} target="_blank" rel="noreferrer">
                          {project.name}
                        </a>
                        {project.reference && (
                          <span className="text-muted"> · {project.reference}</span>
                        )}
                        <small className="text-muted">
                          {' '}
                          ({t('projects.audios.title', { count: project.audio_count })},{' '}
                          {date(project.created_at)})
                        </small>
                      </li>
                    ))}
                  </ul>
                )}
                <h6>{t('admin.users.singleAudios')}</h6>
                {dialog.content.audios.length === 0 ? (
                  <p className="text-muted small mb-0">{t('admin.users.noAudios')}</p>
                ) : (
                  <ul className="admin-user-content mb-0">
                    {dialog.content.audios.map((audio) => (
                      <li key={audio.uuid}>
                        <a href={`/${jobRoute(audio.uuid)}`} target="_blank" rel="noreferrer">
                          {audio.file_name}
                        </a>
                        <small className="text-muted"> ({date(audio.created_at)})</small>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ))}
        </Modal.Body>
        {dialog && dialog.kind !== 'content' && (
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={() => setDialog(null)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={dialog.kind === 'delete' ? 'danger' : 'primary'}
              onClick={confirmDialog}
              disabled={!dialogReady || busy}
            >
              {dialog.kind === 'delete' ? t('common.delete') : t('admin.users.resetPassword')}
            </Button>
          </Modal.Footer>
        )}
      </Modal>
    </Card>
  );
}
