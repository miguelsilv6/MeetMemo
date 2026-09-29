/** The token figures an account has: the extra balance and today's quota. */
export interface TokenFigures {
  token_balance: number | null;
  daily_quota: number | null;
  daily_used: number | null;
}

/** What is left of today's quota (0 when there is none). */
export function dailyRemaining(tokens: TokenFigures): number {
  return Math.max(0, (tokens.daily_quota ?? 0) - (tokens.daily_used ?? 0));
}

/**
 * How many transcriptions the account can still start now: the rest of
 * today's quota plus the extra balance. Null for the administrator.
 */
export function availableTokens(tokens: TokenFigures): number | null {
  if (tokens.token_balance === null) return null;
  return dailyRemaining(tokens) + tokens.token_balance;
}

/** Whether the account has a daily quota at all. */
export function hasDailyQuota(tokens: TokenFigures): boolean {
  return (tokens.daily_quota ?? 0) > 0;
}
