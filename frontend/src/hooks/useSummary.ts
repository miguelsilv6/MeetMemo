import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as api from '../services/api';
import type { LlmTask, Summary } from '../types/api';
import type { SetCurrentStep, SetError } from '../types/ui';
import { LLM_POLL_MS, isTaskActive, llmTaskError, sleep } from '../utils/llmTasks';

/**
 * Custom hook for summary generation and editing.
 *
 * Summaries are made in the background on the server: asking starts (or
 * rejoins) a task and the hook polls it until the summary is ready, so no
 * request waits on the language model and leaving the page does not stop
 * it. Opening a transcript whose summary is still being made picks the
 * progress back up.
 */
export default function useSummary(
  jobId: string | null,
  setCurrentStep: SetCurrentStep,
  setError: SetError
) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  /** The background task while it waits or runs (for "queued, N ahead"). */
  const [summaryTask, setSummaryTask] = useState<LlmTask | null>(null);
  // Bumped whenever the job changes, so a poll for the previous one stops.
  const generation = useRef(0);
  // The job the summary on hand belongs to.
  const summaryJob = useRef<string | null>(null);

  /**
   * Poll the summary task until it ends. Returns the summary once it is ready
   * (after any task under way), or null if it failed (the error is shown) or
   * the job changed meanwhile.
   */
  const follow = useCallback(
    async (uuid: string, first: Summary): Promise<Summary | null> => {
      const mine = generation.current;
      let response = first;
      setGeneratingSummary(true);
      try {
        while (isTaskActive(response.task)) {
          setSummaryTask(response.task ?? null);
          await sleep(LLM_POLL_MS);
          if (generation.current !== mine) return null;
          response = await api.getSummary(uuid);
          if (generation.current !== mine) return null;
        }
        if (response.task?.status === 'error') {
          setError(llmTaskError(response.task, t));
          return null;
        }
        return response.summary ? response : null;
      } finally {
        if (generation.current === mine) {
          setGeneratingSummary(false);
          setSummaryTask(null);
        }
      }
    },
    [setError, t]
  );

  // Opening a transcript whose summary is still being made shows it as such,
  // and keeps the summary once it is ready.
  // Only the job matters here (follow changes with setError's identity).
  const followRef = useRef(follow);
  useEffect(() => {
    followRef.current = follow;
  }, [follow]);
  useEffect(() => {
    generation.current += 1;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when the job changes
    setGeneratingSummary(false);
    setSummaryTask(null);
    // Another job's summary (or one of this job before it was transcribed
    // again) is not this one's.
    if (summaryJob.current !== jobId) {
      summaryJob.current = null;
      setSummary(null);
    }
    if (!jobId) return;
    const mine = generation.current;
    const resume = async () => {
      try {
        const response = await api.getSummary(jobId);
        if (generation.current !== mine || !isTaskActive(response?.task)) return;
        const ready = await followRef.current(jobId, response);
        if (ready) {
          summaryJob.current = jobId;
          setSummary(ready);
        }
      } catch {
        // No transcript yet, or no access: nothing to resume.
      }
    };
    resume();
  }, [jobId]);
  const [editingSummary, setEditingSummary] = useState('');
  const [showEditSummaryModal, setShowEditSummaryModal] = useState(false);

  // Generate (or fetch the cached) summary for a specific job. Used directly
  // for cases like jumping straight to a past job's summary from Recent
  // Meetings, where this hook's own `jobId` hasn't updated yet.
  const generateSummaryFor = async (uuid: string) => {
    try {
      setError(null);
      setGeneratingSummary(true);
      const summaryData = await follow(uuid, await api.generateSummary(uuid));
      if (!summaryData) return;
      summaryJob.current = uuid;
      setSummary(summaryData);
      setCurrentStep('summary');
    } catch (err) {
      setError((err as Error).message || t('errors.generateSummary'));
      setGeneratingSummary(false);
    }
  };

  // Generate the summary for the current job. Takes no arguments on purpose:
  // it is wired straight to onClick, and React would otherwise pass the click
  // event in as the job id (requesting /jobs/[object Object]/summaries).
  const handleGenerateSummary = async () => {
    if (!jobId) return;
    await generateSummaryFor(jobId);
  };

  // Open edit summary modal
  const handleEditSummary = () => {
    if (!summary?.summary) return;
    setEditingSummary(summary.summary);
    setShowEditSummaryModal(true);
  };

  // Save edited summary
  const handleSaveSummary = async () => {
    if (!editingSummary || !jobId) return;

    try {
      setError(null);

      // Call backend API to persist summary changes
      await api.updateSummary(jobId, editingSummary);

      // Update local summary state
      setSummary({
        ...summary,
        summary: editingSummary,
      });
      setShowEditSummaryModal(false);
    } catch (err) {
      setError((err as Error).message || t('errors.updateSummary'));
    }
  };

  return {
    summary,
    generatingSummary,
    summaryTask,
    editingSummary,
    setEditingSummary,
    showEditSummaryModal,
    setShowEditSummaryModal,
    handleGenerateSummary,
    generateSummaryFor,
    handleEditSummary,
    handleSaveSummary,
  };
}
