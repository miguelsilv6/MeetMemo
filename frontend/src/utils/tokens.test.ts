import { describe, it, expect } from 'vitest';
import { availableTokens, dailyRemaining, hasDailyQuota } from './tokens';

describe('tokens', () => {
  it('adds what is left of the day to the extra balance', () => {
    const tokens = { token_balance: 8, daily_quota: 5, daily_used: 3 };
    expect(dailyRemaining(tokens)).toBe(2);
    expect(availableTokens(tokens)).toBe(10);
    expect(hasDailyQuota(tokens)).toBe(true);
  });

  it('never counts an overspent quota as negative', () => {
    // The administrator may lower the quota below what today already used.
    expect(dailyRemaining({ token_balance: 1, daily_quota: 2, daily_used: 4 })).toBe(0);
    expect(availableTokens({ token_balance: 1, daily_quota: 2, daily_used: 4 })).toBe(1);
  });

  it('works without a daily quota and for the administrator', () => {
    expect(availableTokens({ token_balance: 3, daily_quota: 0, daily_used: 0 })).toBe(3);
    expect(hasDailyQuota({ token_balance: 3, daily_quota: 0, daily_used: 0 })).toBe(false);
    expect(availableTokens({ token_balance: null, daily_quota: null, daily_used: null })).toBe(
      null
    );
  });
});
