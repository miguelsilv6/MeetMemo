// Types for user sign-in (mirrors backend api/v1/auth.py).

/** The signed-in user, or the administrator browsing the app. */
export interface Me {
  username: string;
  display_name: string | null;
  is_admin: boolean;
  /** A temporary password set by the administrator must be replaced first. */
  must_change_password: boolean;
  /**
   * The extra balance the administrator grants, spent once today's quota is
   * used up (null for the administrator, as are the daily fields).
   */
  token_balance: number | null;
  /** Tokens per day (0: no daily quota), full again every midnight. */
  daily_quota: number | null;
  /** How much of today's quota uploads have taken. */
  daily_used: number | null;
}
