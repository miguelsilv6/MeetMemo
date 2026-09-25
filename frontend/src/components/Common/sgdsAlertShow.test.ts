import { describe, it, expect } from 'vitest';

// sgds-react's <Alert> relies on `defaultProps` for `show: true`, which React
// 19 ignores on forwardRef components: without an explicit `show` the alert
// (and everything inside it) silently never renders. Guard every usage.
const sources = import.meta.glob('../../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('sgds Alert usage', () => {
  it('passes `show` explicitly to every <Alert>', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
    const missing: string[] = [];
    for (const [path, source] of Object.entries(sources)) {
      if (path.includes('.test.')) continue;
      for (const match of source.matchAll(/<Alert(?=[\s>])[^>]*>/g)) {
        if (!/\bshow\b/.test(match[0])) {
          const line = source.slice(0, match.index).split('\n').length;
          missing.push(`${path}:${line}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
