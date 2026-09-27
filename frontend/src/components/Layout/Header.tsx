import { Button, Container } from '@govtechsg/sgds-react';
import { FileText, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ThemeSwitcher from '../ThemeSwitcher';
import LanguageSwitcher from '../LanguageSwitcher';

interface HeaderProps {
  onStartNewMeeting: () => void;
  /** Open the projects page; the button is hidden without it. */
  onOpenProjects?: () => void;
  /** Whether the projects pages are showing (marks the button as current). */
  projectsActive?: boolean;
}

export default function Header({ onStartNewMeeting, onOpenProjects, projectsActive }: HeaderProps) {
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
            <ThemeSwitcher />
          </div>
        </div>
      </Container>
    </div>
  );
}
