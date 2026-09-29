import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ADMIN_PANEL_ID, ADMIN_TABS, adminTabId } from '../../constants/adminTabs';
import type { AdminTab } from '../../constants/adminTabs';

interface AdminTabsProps {
  active: AdminTab;
  onSelect: (tab: AdminTab) => void;
  unsaved?: readonly AdminTab[];
  withErrors?: readonly AdminTab[];
}

export default function AdminTabs({
  active,
  onSelect,
  unsaved = [],
  withErrors = [],
}: AdminTabsProps) {
  const { t } = useTranslation();
  const refs = useRef<Partial<Record<AdminTab, HTMLButtonElement | null>>>({});

  const move = (tab: AdminTab) => {
    onSelect(tab);
    refs.current[tab]?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const index = ADMIN_TABS.indexOf(active);
    const last = ADMIN_TABS.length - 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    move(ADMIN_TABS[next]);
  };

  return (
    <div className="admin-tabs mb-4">
      <div className="nav nav-tabs flex-nowrap" role="tablist" aria-label={t('admin.tabs.label')}>
        {ADMIN_TABS.map((tab) => {
          const selected = tab === active;
          const hasErrors = withErrors.includes(tab);
          const isUnsaved = !hasErrors && unsaved.includes(tab);
          return (
            <button
              key={tab}
              ref={(el) => {
                refs.current[tab] = el;
              }}
              type="button"
              role="tab"
              id={adminTabId(tab)}
              aria-selected={selected}
              aria-controls={ADMIN_PANEL_ID}
              tabIndex={selected ? 0 : -1}
              className={`nav-link${selected ? ' active' : ''}`}
              onClick={() => onSelect(tab)}
              onKeyDown={handleKeyDown}
            >
              {t(`admin.tabs.${tab}`)}
              {hasErrors && (
                <span className="admin-tab-marker admin-tab-marker-error" aria-hidden="true">
                  !
                </span>
              )}
              {isUnsaved && (
                <span className="admin-tab-marker admin-tab-marker-unsaved" aria-hidden="true">
                  ●
                </span>
              )}
              {hasErrors && <span className="visually-hidden"> ({t('admin.tabs.hasErrors')})</span>}
              {isUnsaved && <span className="visually-hidden"> ({t('admin.tabs.unsaved')})</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
