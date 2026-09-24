import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import {
  AdminApiError,
  adminLogin,
  adminLogout,
  formatErrorDetail,
  getAdminSettings,
} from './adminApi';

let fetchMock: Mock;

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'Status',
    json: async () => {
      if (body === undefined) throw new Error('no body');
      return body;
    },
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('adminApi', () => {
  it('sends the anti-CSRF header, same-origin credentials and a JSON body', async () => {
    fetchMock.mockResolvedValue(response(200, { username: 'admin' }));
    await adminLogin('admin', 'secret');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/admin/login');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers['X-MeetMemo-Admin']).toBe('1');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ username: 'admin', password: 'secret' });
  });

  it('resolves 204 responses without parsing a body', async () => {
    fetchMock.mockResolvedValue(response(204));
    await expect(adminLogout()).resolves.toBeUndefined();
  });

  it('throws AdminApiError with the status and backend detail', async () => {
    fetchMock.mockResolvedValue(response(401, { detail: 'Not authenticated' }));
    const error = await getAdminSettings().catch((e) => e);
    expect(error).toBeInstanceOf(AdminApiError);
    expect(error.status).toBe(401);
    expect(error.message).toBe('Not authenticated');
  });
});

describe('formatErrorDetail', () => {
  it('passes strings through', () => {
    expect(formatErrorDetail('Nope')).toBe('Nope');
  });

  it('turns FastAPI validation errors into readable text', () => {
    expect(
      formatErrorDetail([
        { loc: ['body', 'beam_size'], msg: 'Input should be less than or equal to 10' },
        { loc: ['body'], msg: 'Value error, vad_offset must be lower than vad_onset' },
      ])
    ).toBe(
      'beam_size: Input should be less than or equal to 10; Value error, vad_offset must be lower than vad_onset'
    );
  });

  it('returns null for anything else', () => {
    expect(formatErrorDetail(undefined)).toBeNull();
    expect(formatErrorDetail([])).toBeNull();
  });
});
