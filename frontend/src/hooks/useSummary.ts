import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as api from '../services/api';
import type { Summary } from '../types/api';
import type { SetCurrentStep, SetError } from '../types/ui';

/**
 * Custom hook for summary generation and editing
 * Handles AI summary generation and manual editing
 */
export default function useSummary(
  jobId: string | null,
  setCurrentStep: SetCurrentStep,
  setError: SetError
) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [editingSummary, setEditingSummary] = useState('');
  const [showEditSummaryModal, setShowEditSummaryModal] = useState(false);

  // Generate (or fetch the cached) summary for a specific job. Used directly
  // for cases like jumping straight to a past job's summary from Recent
  // Meetings, where this hook's own `jobId` hasn't updated yet.
  const generateSummaryFor = async (uuid: string) => {
    try {
      setError(null);
      setGeneratingSummary(true);
      const summaryData = await api.generateSummary(uuid);
      setSummary(summaryData);
      setCurrentStep('summary');
    } catch (err) {
      setError((err as Error).message || t('errors.generateSummary'));
    } finally {
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
