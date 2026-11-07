import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { etaText } from '../../utils/eta';

/** How long a task still takes, as the server estimates it (see utils/eta). */
export default function EtaText({
  seconds,
  at,
  className = '',
}: {
  seconds: number | null | undefined;
  at: string | null | undefined;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  return (
    <small
      className={`text-muted d-inline-flex align-items-start gap-1 lh-sm text-start ${className}`}
      data-testid="eta"
    >
      <Clock
        size={12}
        aria-hidden="true"
        className="flex-shrink-0"
        style={{ marginTop: '0.15em' }}
      />
      <span>{etaText(seconds, at, t, i18n.language)}</span>
    </small>
  );
}
