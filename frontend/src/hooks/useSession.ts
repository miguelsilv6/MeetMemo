import { useCallback, useEffect, useState } from 'react';
import { UNAUTHORIZED_EVENT } from '../services/api';
import { getMe, logout } from '../services/authApi';
import type { ApiError } from '../types/api';
import type { Me } from '../types/auth';

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; me: Me }
  | { status: 'error'; message: string };

/**
 * The signed-in user. Any 401 from the API (an expired session, an account
 * deactivated by the administrator) returns to the sign-in screen.
 */
export default function useSession() {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    try {
      setState({ status: 'signedIn', me: await getMe() });
    } catch (err) {
      if ((err as ApiError).status === 401) setState({ status: 'signedOut' });
      else setState({ status: 'error', message: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- check the session on mount
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onUnauthorized = () => setState({ status: 'signedOut' });
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const signedIn = useCallback((me: Me) => setState({ status: 'signedIn', me }), []);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } finally {
      setState({ status: 'signedOut' });
    }
  }, []);

  return { state, refresh, signedIn, signOut };
}
