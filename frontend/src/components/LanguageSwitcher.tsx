import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import type { SupportedLanguage } from '../i18n';

function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const isPortuguese = i18n.resolvedLanguage !== 'en';

  const toggleLanguage = () => {
    const next: SupportedLanguage = isPortuguese ? 'en' : 'pt';
    i18n.changeLanguage(next);
  };

  const label = isPortuguese
    ? t('languageSwitcher.switchToEnglish')
    : t('languageSwitcher.switchToPortuguese');

  return (
    <button
      type="button"
      className="btn btn-sm btn-outline-secondary"
      onClick={toggleLanguage}
      aria-label={label}
      title={label}
    >
      <Languages size={16} className="me-1" />
      {isPortuguese ? 'EN' : 'PT'}
    </button>
  );
}

export default LanguageSwitcher;
