import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as api from '../services/api';
import type { SpeakerMapping, Transcript } from '../types/api';
import type { SetError, SetTranscriptWithColors } from '../types/ui';

/**
 * Custom hook for manual speaker name editing. Speakers are only ever renamed
 * by the user; nothing assigns names automatically. The editor can also be
 * opened before another step (the AI summary): that step then follows once
 * the names are saved, or when the user goes on without changing them.
 */
export default function useSpeakerManagement(
  jobId: string | null,
  transcript: Transcript | null,
  setTranscriptWithColors: SetTranscriptWithColors,
  setError: SetError
) {
  const { t } = useTranslation();
  const [editingSpeakers, setEditingSpeakers] = useState<SpeakerMapping>({});
  const [showEditSpeakersModal, setShowEditSpeakersModal] = useState(false);
  // The step waiting for the names, when the editor was opened before one.
  const nextStepRef = useRef<(() => void) | null>(null);
  const [beforeNextStep, setBeforeNextStep] = useState(false);

  // Open edit speakers modal
  const handleEditSpeakers = () => {
    nextStepRef.current = null;
    setBeforeNextStep(false);
    openEditor();
  };

  // Ask for the speakers' names before `next` (it runs after saving or skipping).
  const askSpeakerNamesBefore = (next: () => void) => {
    if (!openEditor()) {
      next();
      return;
    }
    nextStepRef.current = next;
    setBeforeNextStep(true);
  };

  const runNextStep = () => {
    const next = nextStepRef.current;
    nextStepRef.current = null;
    setBeforeNextStep(false);
    next?.();
  };

  // Go on to the waiting step without renaming anyone.
  const handleSkipSpeakers = () => {
    setShowEditSpeakersModal(false);
    runNextStep();
  };

  // Close the editor without saving: the waiting step does not run.
  const handleCancelEditSpeakers = () => {
    nextStepRef.current = null;
    setBeforeNextStep(false);
    setShowEditSpeakersModal(false);
  };

  // Fill the editor with the transcript's speakers and show it; false if there are none.
  const openEditor = (): boolean => {
    if (!transcript?.segments) return false;

    // Get unique speakers
    const speakers = [...new Set(transcript.segments.map((s) => s.speaker))];
    const speakerMap: SpeakerMapping = {};
    speakers.forEach((speaker) => {
      speakerMap[speaker] = speaker;
    });

    setEditingSpeakers(speakerMap);
    setShowEditSpeakersModal(true);
    return true;
  };

  // Save speaker names
  const handleSaveSpeakers = async () => {
    if (!jobId || !transcript) return;

    try {
      setError(null);

      // Call backend API to persist speaker name changes
      await api.updateSpeakers(jobId, editingSpeakers);

      // Update speaker names in the local transcript state
      const updatedSegments = (transcript.segments ?? []).map((segment) => ({
        ...segment,
        speaker: editingSpeakers[segment.speaker] || segment.speaker,
      }));

      setTranscriptWithColors({ ...transcript, segments: updatedSegments });
      setShowEditSpeakersModal(false);
      runNextStep();
    } catch (err) {
      setError((err as Error).message || t('errors.updateSpeakers'));
    }
  };

  return {
    editingSpeakers,
    setEditingSpeakers,
    showEditSpeakersModal,
    setShowEditSpeakersModal,
    handleEditSpeakers,
    handleSaveSpeakers,
    askSpeakerNamesBefore,
    beforeNextStep,
    handleSkipSpeakers,
    handleCancelEditSpeakers,
  };
}
