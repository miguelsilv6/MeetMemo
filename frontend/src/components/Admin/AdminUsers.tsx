import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Alert, Badge, Button, Card, Col, Form, Modal, Row, Table } from '@govtechsg/sgds-react';
import { Coins, ExternalLink, KeyRound, Trash2, UserPlus, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  AdminApiError,
  changeUserTokens,
  createUser,
  deleteUser,
  getUserContent,
  getUserTokens,
  listUsers,
  resetUserPassword,
  setUserDailyQuota,
  setUserUnlimitedTokens,
  updateUser,
} from '../../services/adminApi';
import { availableTokens, dailyRemaining } from '../../utils/tokens';
import { jobRoute, projectRoute } from '../../hooks/useHashRoute';
import { formatDateTime } from '../../utils/projectDates';
import type { AdminUser, TokenTransaction, UserContent } from '../../types/admin';

export const MIN_PASSWORD_LENGTH = 12;
/** Most tokens given or taken at once (mirrors the backend). */
export const MAX_TOKEN_CHANGE = 10000;

interface AdminUsersProps {
  /** After any change, so the audit trail can refresh. */
  onChanged: () => void;
  onUnauthorized: () => void;
  /**
   * Whether the list is on screen. It reloads each time it comes back into
   * view, since balances and quotas change with uploads and panel settings.
   */
  active?: boolean;
}

type Dialog =
  | { kind: 'password'; user: AdminUser }
  | { kind: 'delete'; user: AdminUser }
  | { kind: 'content'; user: AdminUser; content: UserContent | null }
  | { kind: 'tokens'; user: AdminUser; history: TokenTransaction[] | null };

/** User accounts: create, (de)activate, reset password, delete, open their content. */
export default function AdminUsers({ onChanged, onUnauthorized, active = true }: AdminUsersProps) {
  const { t, i18n } = useTranslation();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    username: '',
    displayName: '',
    password: '',
    tokens: '0',
    /** Empty: follow the panel's default daily quota. */
    dailyQuota: '',
  });
  const [tokenChange, setTokenChange] = useState({ amount: '', note: '' });
  /** The daily quota being edited in the tokens dialog; empty value = the default. */
  const [quotaDraft, setQuotaDraft] = useState('');
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch when shown
    if (active) load();
  }, [active, load]);

  const afterChange = async (message: string) => {
    setNotice(message);
    setError(null);
    await load();
    onChanged();
  };

  const initialTokens = Number(draft.tokens);
  const validTokens = (value: number, min: number) =>
    Number.isInteger(value) && value >= min && value <= MAX_TOKEN_CHANGE;
  const draftQuota = draft.dailyQuota.trim() === '' ? null : Number(draft.dailyQuota);
  const validQuota = (value: number | null) => value === null || validTokens(value, 0);
  const passwordTooShort = draft.password.length > 0 && draft.password.length < MIN_PASSWORD_LENGTH;
  const canCreate =
    /^[A-Za-z0-9._@-]{3,100}$/.test(draft.username) &&
    draft.displayName.trim().length > 0 &&
    draft.password.length >= MIN_PASSWORD_LENGTH &&
    validTokens(initialTokens, 0) &&
    validQuota(draftQuota) &&
    !creating;

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!canCreate) return;
    setCreating(true);
    try {
      const user = await createUser(
        draft.username,
        draft.displayName.trim(),
        draft.password,
        initialTokens,
        draftQuota
      );
      setDraft({ username: '', displayName: '', password: '', tokens: '0', dailyQuota: '' });
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

  const loadTokens = async (user: AdminUser) => {
    try {
      const { transactions, ...state } = await getUserTokens(user.uuid);
      setDialog({ kind: 'tokens', user: { ...user, ...state }, history: transactions });
      setQuotaDraft(state.daily_token_quota === null ? '' : String(state.daily_token_quota));
    } catch (err) {
      setDialog(null);
      fail(err);
    }
  };

  const applyTokens = async (sign: 1 | -1) => {
    if (dialog?.kind !== 'tokens') return;
    const amount = Number(tokenChange.amount);
    if (!validTokens(amount, 1)) return;
    setBusy(true);
    try {
      await changeUserTokens(dialog.user.uuid, sign * amount, tokenChange.note.trim() || null);
      setTokenChange({ amount: '', note: '' });
      await afterChange(
        t(sign > 0 ? 'admin.tokens.added' : 'admin.tokens.removed', {
          count: amount,
          username: dialog.user.username,
        })
      );
      await loadTokens(dialog.user);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const quotaValue = quotaDraft.trim() === '' ? null : Number(quotaDraft);

  const applyQuota = async () => {
    if (dialog?.kind !== 'tokens' || !validQuota(quotaValue)) return;
    setBusy(true);
    try {
      await setUserDailyQuota(dialog.user.uuid, quotaValue);
      await afterChange(
        quotaValue === null
          ? t('admin.tokens.quotaDefaultSet', { username: dialog.user.username })
          : t('admin.tokens.quotaSet', { count: quotaValue, username: dialog.user.username })
      );
      await loadTokens(dialog.user);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const applyUnlimited = async (unlimited: boolean) => {
    if (dialog?.kind !== 'tokens') return;
    setBusy(true);
    try {
      await setUserUnlimitedTokens(dialog.user.uuid, unlimited);
      await afterChange(
        t(unlimited ? 'admin.tokens.unlimitedOn' : 'admin.tokens.unlimitedOff', {
          username: dialog.user.username,
        })
      );
      await loadTokens(dialog.user);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const openDialog = async (next: Dialog) => {
    setDialog(next);
    setDialogInput('');
    setTokenChange({ amount: '', note: '' });
    if (next.kind === 'tokens') {
      await loadTokens(next.user);
      return;
    }
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
    if (!dialog || dialog.kind === 'content' || dialog.kind === 'tokens') return;
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
            <Col md={4} lg={3}>
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
            <Col md={4} lg={3}>
              <Form.Group controlId="new-user-name" className="mb-2">
                <Form.Label>{t('admin.users.displayName')}</Form.Label>
                <Form.Control
                  value={draft.displayName}
                  onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
                />
              </Form.Group>
            </Col>
            <Col md={4} lg={3}>
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
            <Col md={3} lg={2}>
              <Form.Group controlId="new-user-tokens" className="mb-2">
                <Form.Label>{t('admin.tokens.initial')}</Form.Label>
                <Form.Control
                  type="number"
                  min={0}
                  max={MAX_TOKEN_CHANGE}
                  step={1}
                  value={draft.tokens}
                  isInvalid={!validTokens(initialTokens, 0)}
                  onChange={(e) => setDraft({ ...draft, tokens: e.target.value })}
                />
              </Form.Group>
            </Col>
            <Col md={3} lg={2}>
              <Form.Group controlId="new-user-daily" className="mb-2">
                <Form.Label>{t('admin.tokens.dailyQuota')}</Form.Label>
                <Form.Control
                  type="number"
                  min={0}
                  max={MAX_TOKEN_CHANGE}
                  step={1}
                  value={draft.dailyQuota}
                  placeholder={t('admin.tokens.defaultPlaceholder')}
                  isInvalid={!validQuota(draftQuota)}
                  aria-describedby="new-user-daily-help"
                  onChange={(e) => setDraft({ ...draft, dailyQuota: e.target.value })}
                />
                <Form.Text id="new-user-daily-help" className="text-muted">
                  {t('admin.tokens.dailyQuotaHelp')}
                </Form.Text>
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
                  <th scope="col">{t('admin.tokens.column')}</th>
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
                    <td>
                      <Button
                        variant={
                          (availableTokens(user) ?? 0) > 0 ? 'outline-secondary' : 'outline-danger'
                        }
                        size="sm"
                        className="text-nowrap"
                        onClick={() => openDialog({ kind: 'tokens', user, history: null })}
                        aria-label={t('admin.tokens.manageFor', { username: user.username })}
                      >
                        <Coins size={14} className="me-1" />
                        {user.unlimited_tokens ? (
                          <span title={t('admin.tokens.unlimited')}>∞</span>
                        ) : user.daily_quota > 0 ? (
                          t(
                            user.token_balance > 0
                              ? 'admin.tokens.cell'
                              : 'admin.tokens.cellNoExtra',
                            {
                              remaining: dailyRemaining(user),
                              quota: user.daily_quota,
                              extra: user.token_balance,
                            }
                          )
                        ) : (
                          user.token_balance
                        )}
                      </Button>
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
        size={dialog?.kind === 'content' || dialog?.kind === 'tokens' ? 'lg' : undefined}
      >
        <Modal.Header closeButton>
          <Modal.Title>
            {dialog?.kind === 'password' && t('admin.users.resetPassword')}
            {dialog?.kind === 'delete' && t('admin.users.delete')}
            {dialog?.kind === 'content' &&
              t('admin.users.contentOf', { name: dialog.user.display_name })}
            {dialog?.kind === 'tokens' &&
              t('admin.tokens.title', { name: dialog.user.display_name })}
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
          {dialog?.kind === 'tokens' && (
            <>
              <Form.Group className="mb-3">
                <Form.Check
                  type="switch"
                  id="token-unlimited"
                  label={t('admin.tokens.unlimited')}
                  checked={dialog.user.unlimited_tokens}
                  disabled={busy}
                  onChange={(e) => applyUnlimited(e.target.checked)}
                  aria-describedby="token-unlimited-help"
                />
                <Form.Text id="token-unlimited-help" className="text-muted">
                  {t('admin.tokens.unlimitedHelp')}
                </Form.Text>
              </Form.Group>
              {dialog.user.unlimited_tokens && (
                <Alert variant="info" className="py-2" show>
                  {t('admin.tokens.unlimitedActive')}
                </Alert>
              )}
              <h6>{t('admin.tokens.dailyQuota')}</h6>
              <p className="mb-2">
                {dialog.user.daily_quota > 0
                  ? t('admin.tokens.dailyToday', {
                      used: dialog.user.daily_used,
                      quota: dialog.user.daily_quota,
                    })
                  : t('admin.tokens.noDailyQuota')}{' '}
                <span className="text-muted">
                  (
                  {dialog.user.daily_token_quota === null
                    ? t('admin.tokens.followsDefault')
                    : t('admin.tokens.ownQuota')}
                  )
                </span>
              </p>
              <Row className="align-items-end g-2 mb-4">
                <Col sm={4}>
                  <Form.Group controlId="token-daily-quota">
                    <Form.Label>{t('admin.tokens.quotaPerDay')}</Form.Label>
                    <Form.Control
                      type="number"
                      min={0}
                      max={MAX_TOKEN_CHANGE}
                      step={1}
                      value={quotaDraft}
                      placeholder={t('admin.tokens.defaultPlaceholder')}
                      isInvalid={!validQuota(quotaValue)}
                      aria-describedby="token-daily-quota-help"
                      onChange={(e) => setQuotaDraft(e.target.value)}
                    />
                  </Form.Group>
                </Col>
                <Col sm={8} className="d-flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    disabled={
                      busy ||
                      !validQuota(quotaValue) ||
                      quotaValue === dialog.user.daily_token_quota
                    }
                    onClick={applyQuota}
                  >
                    {t('admin.tokens.saveQuota')}
                  </Button>
                  {dialog.user.daily_token_quota !== null && (
                    <Button
                      variant="outline-secondary"
                      disabled={busy}
                      onClick={() => setQuotaDraft('')}
                    >
                      {t('admin.tokens.useDefault')}
                    </Button>
                  )}
                </Col>
                <Col xs={12}>
                  <Form.Text id="token-daily-quota-help" className="text-muted">
                    {t('admin.tokens.dailyQuotaHelp')}
                  </Form.Text>
                </Col>
              </Row>
              <h6>{t('admin.tokens.extraTitle')}</h6>
              <p className="mb-2">
                {t('admin.tokens.balance', { count: dialog.user.token_balance })}
              </p>
              <Row className="align-items-end g-2 mb-3">
                <Col sm={3}>
                  <Form.Group controlId="token-amount">
                    <Form.Label>{t('admin.tokens.amount')}</Form.Label>
                    <Form.Control
                      type="number"
                      min={1}
                      max={MAX_TOKEN_CHANGE}
                      step={1}
                      value={tokenChange.amount}
                      onChange={(e) => setTokenChange({ ...tokenChange, amount: e.target.value })}
                    />
                  </Form.Group>
                </Col>
                <Col sm={5}>
                  <Form.Group controlId="token-note">
                    <Form.Label>{t('admin.tokens.note')}</Form.Label>
                    <Form.Control
                      value={tokenChange.note}
                      maxLength={500}
                      onChange={(e) => setTokenChange({ ...tokenChange, note: e.target.value })}
                    />
                  </Form.Group>
                </Col>
                <Col sm={4} className="d-flex gap-2">
                  <Button
                    variant="primary"
                    disabled={busy || !validTokens(Number(tokenChange.amount), 1)}
                    onClick={() => applyTokens(1)}
                  >
                    {t('admin.tokens.add')}
                  </Button>
                  <Button
                    variant="outline-danger"
                    disabled={
                      busy ||
                      !validTokens(Number(tokenChange.amount), 1) ||
                      Number(tokenChange.amount) > dialog.user.token_balance
                    }
                    onClick={() => applyTokens(-1)}
                  >
                    {t('admin.tokens.remove')}
                  </Button>
                </Col>
              </Row>
              <h6>{t('admin.tokens.history')}</h6>
              {dialog.history === null ? (
                <p className="text-muted mb-0">{t('common.loading')}</p>
              ) : dialog.history.length === 0 ? (
                <p className="text-muted mb-0">{t('admin.tokens.noHistory')}</p>
              ) : (
                <div className="table-responsive admin-token-history">
                  <Table size="sm" className="mb-0">
                    <thead>
                      <tr>
                        <th scope="col">{t('admin.audit.when')}</th>
                        <th scope="col">{t('admin.tokens.reasonColumn')}</th>
                        <th scope="col" className="text-end">
                          {t('admin.tokens.change')}
                        </th>
                        <th scope="col" className="text-end">
                          {t('admin.tokens.after')}
                        </th>
                        <th scope="col">{t('admin.tokens.details')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dialog.history.map((entry) => (
                        <tr key={entry.id}>
                          <td className="text-nowrap small">{date(entry.created_at)}</td>
                          <td>
                            {t(`admin.tokens.reasons.${entry.reason}`)}
                            {entry.pool === 'daily' && (
                              <small className="d-block text-muted">
                                {t('admin.tokens.fromDaily')}
                              </small>
                            )}
                          </td>
                          <td
                            className={`text-end ${entry.delta > 0 ? 'text-success' : 'text-danger'}`}
                          >
                            {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                          </td>
                          <td className="text-end">{entry.balance_after}</td>
                          <td className="small">
                            {[
                              entry.file_name ??
                                (entry.job_uuid ? t('admin.tokens.deletedAudio') : null),
                              entry.note,
                              entry.actor,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </>
          )}
        </Modal.Body>
        {dialog && (dialog.kind === 'password' || dialog.kind === 'delete') && (
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
