import { Container } from '@govtechsg/sgds-react';
import { FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ThemeSwitcher from '../ThemeSwitcher';
import LanguageSwitcher from '../LanguageSwitcher';

interface HeaderProps {
  onStartNewMeeting: () => void;
}

export default function Header({ onStartNewMeeting }: HeaderProps) {
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
            <LanguageSwitcher />
            <ThemeSwitcher />
          </div>
        </div>
      </Container>
    </div>
  );
}
