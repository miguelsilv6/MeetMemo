import { useEffect, useState } from 'react';

export const ADMIN_ROUTE = '#/admin';
export const PROJECTS_ROUTE = '#/projects';

/** Hash of one project's page. */
export function projectRoute(uuid: string): string {
  return `${PROJECTS_ROUTE}/${uuid}`;
}

/** The project UUID in a project page's hash, or null. */
export function parseProjectRoute(hash: string): string | null {
  const prefix = `${PROJECTS_ROUTE}/`;
  if (!hash.startsWith(prefix)) return null;
  const uuid = decodeURIComponent(hash.slice(prefix.length)).trim();
  return uuid || null;
}

export const JOB_ROUTE_PREFIX = '#/jobs/';

/** Hash that opens one audio's transcript directly. */
export function jobRoute(uuid: string): string {
  return `${JOB_ROUTE_PREFIX}${uuid}`;
}

/** The job UUID in a job hash, or null. */
export function parseJobRoute(hash: string): string | null {
  if (!hash.startsWith(JOB_ROUTE_PREFIX)) return null;
  const uuid = decodeURIComponent(hash.slice(JOB_ROUTE_PREFIX.length)).trim();
  return uuid || null;
}

/** Whether the hash shows the projects list or a project page. */
export function isProjectsRoute(hash: string): boolean {
  return hash === PROJECTS_ROUTE || parseProjectRoute(hash) !== null;
}

/** The current location hash, kept in sync with back/forward and link clicks. */
export default function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return hash;
}
