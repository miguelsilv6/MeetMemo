import { Form } from '@govtechsg/sgds-react';
import { useTranslation } from 'react-i18next';
import type { SortOrder } from '../../utils/sortOrder';

interface SortOrderSelectProps {
  id: string;
  value: SortOrder;
  onChange: (order: SortOrder) => void;
}

/** "Sort: newest first / oldest first" by import date. */
export default function SortOrderSelect({ id, value, onChange }: SortOrderSelectProps) {
  const { t } = useTranslation();
  return (
    <div className="d-flex align-items-center gap-2 sort-order-select">
      <Form.Label htmlFor={id} className="mb-0 small text-muted text-nowrap">
        {t('sortOrder.label')}
      </Form.Label>
      <Form.Select
        id={id}
        size="sm"
        value={value}
        onChange={(e) => onChange(e.target.value as SortOrder)}
      >
        <option value="newest">{t('sortOrder.newest')}</option>
        <option value="oldest">{t('sortOrder.oldest')}</option>
      </Form.Select>
    </div>
  );
}
