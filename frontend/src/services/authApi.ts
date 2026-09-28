// Client for user sign-in.

import { apiCall } from './api';
import type { Me } from '../types/auth';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function getMe(): Promise<Me> {
  return apiCall<Me>('/auth/me');
}

export function login(username: string, password: string): Promise<Me> {
  return apiCall<Me>('/auth/login', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ username, password }),
  });
}

export function logout(): Promise<void> {
  return apiCall<void>('/auth/logout', { method: 'POST' });
}

export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return apiCall<void>('/auth/password', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}
