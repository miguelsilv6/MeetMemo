import { Badge, Button, Container } from '@govtechsg/sgds-react';
import { FileText, FolderOpen, KeyRound, LogOut, Shield, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from '../LanguageSwitcher';
import type { Me } from '../../types/auth';

interface HeaderProps {
  onStartNewMeeting: () => void;
  /** Open the projects page; the button is hidden without it. */
  onOpenProjects?: () => void;
  /** Whether the projects pages are showing (marks the button as current). */
  projectsActive?: boolean;
  /** The signed-in user or administrator; no account controls without it. */
  me?: Me | null;
  onChangePassword?: () => void;
  onLogout?: () => void;
}

export default function Header({
  onStartNewMeeting,
  onOpenProjects,
  projectsActive,
  me = null,
  onChangePassword,
  onLogout,
}: HeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="app-header">
      <Container>
        <div className="d-flex align-items-center justify-content-between py-3">
          <div
            className="d-flex align-items-center gap-3"
            style={{ cursor: 'pointer' }}
            onClick={onStartNewMeeting}
          >
            <FileText size={32} className="text-primary" />
            <div>
              <h4 className="mb-0">{t('app.name')}</h4>
              <small className="text-muted">{t('app.tagline')}</small>
            </div>
          </div>
          <div className="d-flex align-items-center gap-2">
            {onOpenProjects && (
              <Button
                variant={projectsActive ? 'primary' : 'outline-primary'}
                size="sm"
                onClick={onOpenProjects}
                aria-current={projectsActive ? 'page' : undefined}
                aria-label={t('projects.nav')}
                className="header-projects-button"
              >
                <FolderOpen size={16} className="me-1" />
                <span>{t('projects.nav')}</span>
              </Button>
            )}
            <LanguageSwitcher />
            {me && !me.is_admin && (
              <div className="header-account d-flex align-items-center gap-1">
                <span className="header-account-name" title={me.username}>
                  <UserRound size={16} className="me-1" aria-hidden="true" />
                  {me.display_name || me.username}
                </span>
                {me.token_balance !== null && (
                  <Badge
                    bg={me.token_balance > 0 ? 'secondary' : 'danger'}
                    className="header-tokens"
                    title={t('auth.tokensHint')}
                  >
                    {t('auth.tokens', { count: me.token_balance })}
                  </Badge>
                )}
                {onChangePassword && (
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={onChangePassword}
                    aria-label={t('auth.menu.changePassword')}
                    title={t('auth.menu.changePassword')}
                  >
                    <KeyRound size={16} />
                  </Button>
                )}
                {onLogout && (
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={onLogout}
                    aria-label={t('auth.menu.logout')}
                    title={t('auth.menu.logout')}
                  >
                    <LogOut size={16} />
                  </Button>
                )}
              </div>
            )}
            {me?.is_admin && (
              <a className="btn btn-sm btn-outline-secondary" href="#/admin">
                <Shield size={16} className="me-1" aria-hidden="true" />
                <span>{t('auth.menu.adminPanel')}</span>
              </a>
            )}
          </div>
        </div>
      </Container>
    </div>
  );
}
