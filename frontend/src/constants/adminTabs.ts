/** The admin panel's tabs, in display order. */
export const ADMIN_TABS = [
  'transcription',
  'languageRetention',
  'uploads',
  'prompts',
  'users',
  'security',
  'audit',
  'system',
] as const;

export type AdminTab = (typeof ADMIN_TABS)[number];

/** Tabs whose content is part of the settings form (saved together). */
export const SETTINGS_TABS = ['transcription', 'languageRetention', 'uploads', 'prompts'] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const isSettingsTab = (tab: AdminTab): tab is SettingsTab =>
  (SETTINGS_TABS as readonly AdminTab[]).includes(tab);

export const isAdminTab = (value: unknown): value is AdminTab =>
  typeof value === 'string' && (ADMIN_TABS as readonly string[]).includes(value);

export const ADMIN_PANEL_ID = 'admin-tabpanel';
export const adminTabId = (tab: AdminTab) => `admin-tab-${tab}`;
