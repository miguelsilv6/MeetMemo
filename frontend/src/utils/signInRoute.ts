import { ADMIN_ROUTE } from '../hooks/useHashRoute';
import type { Me } from '../types/auth';

const HOME_ROUTES = new Set(['', '#', '#/']);

/**
 * Where to go right after signing in on the shared login page: the
 * administrator lands on the admin panel, unless they signed in to open
 * something specific (a user's audio or project). Null: stay.
 */
export function routeAfterSignIn(me: Me, route: string): string | null {
  return me.is_admin && HOME_ROUTES.has(route) ? ADMIN_ROUTE : null;
}

/** The admin panel is the administrator's: a user who opens it goes home. */
export function isForbiddenRoute(me: Me | null, route: string): boolean {
  return !!me && !me.is_admin && route === ADMIN_ROUTE;
}
