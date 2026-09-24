// Client for the admin panel API. Kept separate from api.ts because admin
// calls need the session cookie, a custom anti-CSRF header, 204 handling, and
// readable FastAPI validation errors.

import type {
  AdminSettingsResponse,
  AuditEntry,
  RuntimeSettings,
  SaveSettingsResponse,
} from '../types/admin';

const ADMIN_BASE_URL = '/api/v1/admin';

export class AdminApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
  }
}

interface ValidationIssue {
  loc?: (string | number)[];
  msg?: string;
}

/** Turn a FastAPI `detail` (string or validation-error list) into readable text. */
export function formatErrorDetail(detail: unknown): string | null {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const messages = (detail as ValidationIssue[])
      .map((issue) => {
        const field = (issue.loc ?? []).filter((part) => part !== 'body').join('.');
        return field ? `${field}: ${issue.msg ?? ''}` : (issue.msg ?? '');
      })
      .filter(Boolean);
    return messages.length > 0 ? messages.join('; ') : null;
  }
  return null;
}

async function adminRequest<T>(
  path: string,
  { method = 'GET', body }: { method?: string; body?: unknown } = {}
): Promise<T> {
  const response = await fetch(`${ADMIN_BASE_URL}${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      'X-MeetMemo-Admin': '1',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let detail: unknown = null;
    try {
      detail = (await response.json()).detail;
    } catch {
      // Non-JSON error body; fall back to the status text.
    }
    throw new AdminApiError(
      response.status,
      formatErrorDetail(detail) ?? (response.statusText || `HTTP ${response.status}`)
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function getAdminStatus(): Promise<{ configured: boolean }> {
  return adminRequest('/status');
}

export function getAdminSession(): Promise<{ username: string }> {
  return adminRequest('/session');
}

export function adminLogin(username: string, password: string): Promise<{ username: string }> {
  return adminRequest('/login', { method: 'POST', body: { username, password } });
}

export function adminLogout(): Promise<void> {
  return adminRequest('/logout', { method: 'POST' });
}

export function getAdminSettings(): Promise<AdminSettingsResponse> {
  return adminRequest('/settings');
}

export function saveAdminSettings(settings: RuntimeSettings): Promise<SaveSettingsResponse> {
  return adminRequest('/settings', { method: 'PUT', body: settings });
}

export function getAdminAudit(limit = 100): Promise<AuditEntry[]> {
  return adminRequest(`/audit?limit=${limit}`);
}

export function changeAdminPassword(currentPassword: string, newPassword: string): Promise<void> {
  return adminRequest('/password', {
    method: 'POST',
    body: { current_password: currentPassword, new_password: newPassword },
  });
}
