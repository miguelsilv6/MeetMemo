import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as api from '../services/api';
import type { SpeakerMapping, Transcript } from '../types/api';
import type { SetError, SetTranscriptWithColors } from '../types/ui';

/**
 * Custom hook for manual speaker name editing. Speakers are only ever renamed
 * by the user; nothing assigns names automatically.
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

  // Open edit speakers modal
  const handleEditSpeakers = () => {
    if (!transcript?.segments) return;

    // Get unique speakers
    const speakers = [...new Set(transcript.segments.map((s) => s.speaker))];
    const speakerMap: SpeakerMapping = {};
    speakers.forEach((speaker) => {
      speakerMap[speaker] = speaker;
    });

    setEditingSpeakers(speakerMap);
    setShowEditSpeakersModal(true);
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
  };
}
