// Client for the admin panel API. Kept separate from api.ts because admin
// calls need the session cookie, a custom anti-CSRF header, 204 handling, and
// readable FastAPI validation errors.

import type {
  AdminSettingsResponse,
  AdminUser,
  TokenTransaction,
  UserContent,
  UserTokenState,
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

export function listUsers(): Promise<AdminUser[]> {
  return adminRequest('/users');
}

export function createUser(
  username: string,
  displayName: string,
  password: string,
  initialTokens = 0,
  dailyQuota: number | null = null
): Promise<AdminUser> {
  return adminRequest('/users', {
    method: 'POST',
    body: {
      username,
      display_name: displayName,
      password,
      initial_tokens: initialTokens,
      daily_token_quota: dailyQuota,
    },
  });
}

export function updateUser(
  uuid: string,
  changes: { display_name?: string; is_active?: boolean }
): Promise<AdminUser> {
  return adminRequest(`/users/${uuid}`, { method: 'PATCH', body: changes });
}

export function resetUserPassword(uuid: string, password: string): Promise<void> {
  return adminRequest(`/users/${uuid}/password`, { method: 'POST', body: { password } });
}

export function deleteUser(uuid: string): Promise<void> {
  return adminRequest(`/users/${uuid}`, { method: 'DELETE' });
}

export function getUserContent(uuid: string): Promise<UserContent> {
  return adminRequest(`/users/${uuid}/content`);
}

export function changeUserTokens(
  uuid: string,
  delta: number,
  note: string | null
): Promise<UserTokenState> {
  return adminRequest(`/users/${uuid}/tokens`, { method: 'POST', body: { delta, note } });
}

/** The account's own daily quota, or null to follow the panel's default. */
export function setUserDailyQuota(
  uuid: string,
  quota: number | null
): Promise<UserTokenState & { daily_token_quota: number | null }> {
  return adminRequest(`/users/${uuid}/daily-quota`, {
    method: 'PUT',
    body: { daily_token_quota: quota },
  });
}

/** Give the account unlimited tokens (never charged), or take them away. */
export function setUserUnlimitedTokens(uuid: string, unlimited: boolean): Promise<UserTokenState> {
  return adminRequest(`/users/${uuid}/unlimited-tokens`, {
    method: 'PUT',
    body: { unlimited_tokens: unlimited },
  });
}

export function getUserTokens(uuid: string): Promise<
  UserTokenState & {
    daily_token_quota: number | null;
    transactions: TokenTransaction[];
  }
> {
  return adminRequest(`/users/${uuid}/tokens`);
}
