import { useState } from 'react';
import * as api from '../services/api';
import { initializeSpeakerColors } from '../utils/speakerColors';
import type { Transcript, TranscriptSegment } from '../types/api';
import type { SetError } from '../types/ui';

export type EditingSegment = TranscriptSegment & { index: number };

/**
 * Custom hook for transcript data management and editing
 * Handles transcript state and segment editing
 */
export default function useTranscript(jobId: string | null, setError: SetError) {
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [editingSegment, setEditingSegment] = useState<EditingSegment | null>(null);
  const [showEditTextModal, setShowEditTextModal] = useState(false);

  // Helper function to set transcript and initialize speaker colors
  const setTranscriptWithColors = (transcriptData: Transcript | null) => {
    setTranscript(transcriptData);
    if (transcriptData?.segments) {
      initializeSpeakerColors(transcriptData.segments);
    }
  };

  // Open edit text modal
  const handleEditText = (segment: TranscriptSegment, index: number) => {
    setEditingSegment({ ...segment, index });
    setShowEditTextModal(true);
  };

  // Save edited segment text and speaker
  const handleSaveSegmentText = async () => {
    if (!editingSegment || !transcript || !jobId) return;

    try {
      setError(null);

      const updatedSegments = [...(transcript.segments ?? [])];
      updatedSegments[editingSegment.index] = {
        ...updatedSegments[editingSegment.index],
        text: editingSegment.text,
        speaker: editingSegment.speaker,
      };

      // Call backend API to persist transcript changes (including speaker reassignment)
      await api.updateTranscript(jobId, updatedSegments);

      setTranscriptWithColors({ ...transcript, segments: updatedSegments });
      setShowEditTextModal(false);
      setEditingSegment(null);
    } catch (err) {
      setError((err as Error).message || 'Failed to update segment');
    }
  };

  // Reassign a segment to a different speaker (e.g. dragged to another Kanban column).
  // Applies the change optimistically and rolls back if the backend save fails.
  const handleMoveSegmentSpeaker = async (index: number, newSpeaker: string) => {
    if (!transcript || !jobId) return;

    const segment = transcript.segments?.[index];
    if (!segment || segment.speaker === newSpeaker) return;

    const previousTranscript = transcript;
    const updatedSegments = [...(transcript.segments ?? [])];
    updatedSegments[index] = { ...updatedSegments[index], speaker: newSpeaker };

    setTranscriptWithColors({ ...transcript, segments: updatedSegments });

    try {
      setError(null);
      await api.updateTranscript(jobId, updatedSegments);
    } catch (err) {
      setTranscriptWithColors(previousTranscript);
      setError((err as Error).message || 'Failed to move segment to speaker');
    }
  };

  // Reassign several segments to a different speaker at once (e.g. removing a
  // speaker column and moving all its lines to another one). One optimistic
  // update + one API call for the whole batch, rolled back together on failure.
  const handleBulkMoveSegments = async (indices: number[], newSpeaker: string) => {
    if (!transcript || !jobId || indices.length === 0) return;

    const previousTranscript = transcript;
    const updatedSegments = [...(transcript.segments ?? [])];
    for (const index of indices) {
      if (updatedSegments[index]) {
        updatedSegments[index] = { ...updatedSegments[index], speaker: newSpeaker };
      }
    }

    setTranscriptWithColors({ ...transcript, segments: updatedSegments });

    try {
      setError(null);
      await api.updateTranscript(jobId, updatedSegments);
    } catch (err) {
      setTranscriptWithColors(previousTranscript);
      setError((err as Error).message || 'Failed to move segments to speaker');
    }
  };

  // Permanently remove segments from the transcript (e.g. deleting a speaker
  // and its lines instead of reassigning them). Rolled back on failure.
  const handleDeleteSegments = async (indices: number[]) => {
    if (!transcript || !jobId || indices.length === 0) return;

    const previousTranscript = transcript;
    const indexSet = new Set(indices);
    const updatedSegments = (transcript.segments ?? []).filter((_, i) => !indexSet.has(i));

    setTranscriptWithColors({ ...transcript, segments: updatedSegments });

    try {
      setError(null);
      await api.updateTranscript(jobId, updatedSegments);
    } catch (err) {
      setTranscriptWithColors(previousTranscript);
      setError((err as Error).message || 'Failed to delete segments');
    }
  };

  return {
    transcript,
    setTranscriptWithColors,
    editingSegment,
    setEditingSegment,
    showEditTextModal,
    setShowEditTextModal,
    handleEditText,
    handleSaveSegmentText,
    handleMoveSegmentSpeaker,
    handleBulkMoveSegments,
    handleDeleteSegments,
  };
}
