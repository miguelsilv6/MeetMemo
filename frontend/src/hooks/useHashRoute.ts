import { useEffect, useState } from 'react';

export const ADMIN_ROUTE = '#/admin';

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
