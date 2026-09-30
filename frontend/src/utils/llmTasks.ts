import type { TFunction } from 'i18next';
import type { LlmTask } from '../types/api';

/** How often the page asks how a background summary or translation is doing. */
export const LLM_POLL_MS = 2500;

const KNOWN_ERRORS = new Set([
  'timeout',
  'unavailable',
  'unusable',
  'transcript_missing',
  'transcript_changed',
]);

export function isTaskActive(task: LlmTask | null | undefined): boolean {
  return !!task && (task.status === 'queued' || task.status === 'running');
}

/** Why a task failed, in the reader's language, with the server's detail. */
export function llmTaskError(task: LlmTask, t: TFunction): string {
  const code = task.error_code && KNOWN_ERRORS.has(task.error_code) ? task.error_code : 'internal';
  const message = t(`llmTask.errors.${code}`);
  return task.error ? `${message} ${t('llmTask.detail', { detail: task.error })}` : message;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
