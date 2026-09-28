// Types for user sign-in (mirrors backend api/v1/auth.py).

/** The signed-in user, or the administrator browsing the app. */
export interface Me {
  username: string;
  display_name: string | null;
  is_admin: boolean;
  /** A temporary password set by the administrator must be replaced first. */
  must_change_password: boolean;
  /** Transcriptions the user can still start (null for the administrator). */
  token_balance: number | null;
}
