import { describe, it, expect } from 'vitest';
import { isForbiddenRoute, routeAfterSignIn } from './signInRoute';
import type { Me } from '../types/auth';

const user: Me = {
  username: 'ana',
  display_name: 'Ana',
  is_admin: false,
  must_change_password: false,
  token_balance: 1,
  daily_quota: 0,
  daily_used: 0,
};
const admin: Me = {
  ...user,
  username: 'admin',
  display_name: null,
  is_admin: true,
  token_balance: null,
  daily_quota: null,
  daily_used: null,
};

describe('routeAfterSignIn', () => {
  it('takes the administrator to the panel from the home page', () => {
    for (const route of ['', '#', '#/']) expect(routeAfterSignIn(admin, route)).toBe('#/admin');
  });

  it('keeps the administrator where they were going', () => {
    expect(routeAfterSignIn(admin, '#/admin')).toBeNull();
    expect(routeAfterSignIn(admin, '#/jobs/abc')).toBeNull();
    expect(routeAfterSignIn(admin, '#/projects/p1')).toBeNull();
  });

  it('leaves users where they are', () => {
    expect(routeAfterSignIn(user, '')).toBeNull();
    expect(routeAfterSignIn(user, '#/projects')).toBeNull();
  });
});

describe('isForbiddenRoute', () => {
  it('keeps users out of the admin panel only', () => {
    expect(isForbiddenRoute(user, '#/admin')).toBe(true);
    expect(isForbiddenRoute(user, '#/projects')).toBe(false);
    expect(isForbiddenRoute(admin, '#/admin')).toBe(false);
    expect(isForbiddenRoute(null, '#/admin')).toBe(false);
  });
});
