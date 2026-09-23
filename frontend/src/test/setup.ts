// Global test setup: registers jest-dom matchers on Vitest's `expect`
// and augments its types (e.g. `toBeInTheDocument`).
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import i18n from '../i18n';

// The app defaults to Portuguese, but existing test assertions were written
// against English UI strings. Pin the test environment to English (rather
// than rewrite every assertion) so translated text stays testable without
// coupling tests to translation content.
await i18n.changeLanguage('en');

// Vitest runs without global test hooks, so React Testing Library's automatic
// cleanup is not registered. Unmount rendered trees after each test to keep the
// shared jsdom document isolated between tests.
afterEach(() => {
  cleanup();
});
