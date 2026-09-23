import { useTranslation } from 'react-i18next';
import './ErrorAlert.css';

interface ErrorAlertProps {
  error: string | null;
  onClose: () => void;
}

export default function ErrorAlert({ error, onClose }: ErrorAlertProps) {
  const { t } = useTranslation();

  if (!error) return null;

  return (
    <div className="error-alert" role="alert">
      <strong>{t('common.errorPrefix')}</strong> {error}
      <button onClick={onClose} className="error-alert-close-button" aria-label={t('common.close')}>
        ×
      </button>
    </div>
  );
}
