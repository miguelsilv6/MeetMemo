import { useTranslation } from 'react-i18next';

interface LoadingViewProps {
  /** What is being loaded, shown under the spinner. */
  message: string;
}

/**
 * A spinner in place of the page while something opens (e.g. a transcript),
 * so the previous page does not stay on screen meanwhile. It fades in, so a
 * near-instant load does not flash.
 */
export default function LoadingView({ message }: LoadingViewProps) {
  const { t } = useTranslation();

  return (
    <div className="loading-view text-center py-5" role="status" aria-live="polite">
      <div className="spinner-border text-primary mb-3" aria-hidden="true" />
      <p className="text-muted mb-0">{message}</p>
      <span className="visually-hidden">{t('common.loading')}</span>
    </div>
  );
}
