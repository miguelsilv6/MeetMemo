import { useState } from 'react';
import { initializeSpeakerColors } from '../utils/speakerColors';
import useTranscriptSaver from './useTranscriptSaver';
import { mergeSegmentInto, moveSegmentNextTo } from '../utils/moveSegment';
import type { DropPlacement } from '../utils/moveSegment';
import type { SpeakerMapping, Transcript, TranscriptSegment } from '../types/api';
import type { SetError } from '../types/ui';

export type EditingSegment = TranscriptSegment & { index: number };

// How many past persisted states handleUndo can step back through.
const MAX_UNDO_HISTORY = 20;

/**
 * Custom hook for transcript data management and editing
 * Handles transcript state and segment editing
 */
export default function useTranscript(jobId: string | null, setError: SetError) {
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [editingSegment, setEditingSegment] = useState<EditingSegment | null>(null);
  const [showEditTextModal, setShowEditTextModal] = useState(false);
  // Index of a segment inserted via handleInsertSegmentAfter that hasn't been
  // saved yet. If the edit modal is cancelled while this is set, the blank
  // segment is removed instead of being left behind as a stray empty bubble.
  const [pendingNewSegmentIndex, setPendingNewSegmentIndex] = useState<number | null>(null);
  const [splittingSegment, setSplittingSegment] = useState<EditingSegment | null>(null);
  const [showSplitModal, setShowSplitModal] = useState(false);
  // Stack of previously-persisted segment arrays, most recent last. Each
  // mutating action pushes the state it is about to replace, so handleUndo
  // can step back through them one at a time.
  const [history, setHistory] = useState<TranscriptSegment[][]>([]);
  // Tracks the jobId the history above belongs to. A freshly-loaded
  // transcript (new job, or a reload) starts with no undo history of its
  // own — history from a previous job must never leak in. Adjusted during
  // render (React's documented alternative to an effect for this) rather
  // than in an effect, which would call setState synchronously on mount.
  const [historyJobId, setHistoryJobId] = useState(jobId);
  if (jobId !== historyJobId) {
    setHistoryJobId(jobId);
    setHistory([]);
  }

  const pushHistory = (segments: TranscriptSegment[]) => {
    setHistory((prev) => [...prev.slice(-(MAX_UNDO_HISTORY - 1)), segments]);
  };

  // Edits show at once and are kept until the server has them: a failed save
  // is tried again, never undone on screen (see useTranscriptSaver).
  const saver = useTranscriptSaver();

  // Helper function to set transcript and initialize speaker colors
  const setTranscriptWithColors = (transcriptData: Transcript | null) => {
    setTranscript(transcriptData);
    if (transcriptData?.segments) {
      initializeSpeakerColors(transcriptData.segments);
    }
  };

  // Show an edit, make it undoable, and save it.
  const commit = (previous: TranscriptSegment[], updated: TranscriptSegment[]) => {
    if (!transcript || !jobId) return;
    setTranscriptWithColors({ ...transcript, segments: updated });
    pushHistory(previous);
    setError(null);
    saver.queueSave(jobId, updated);
  };

  // Open edit text modal
  const handleEditText = (segment: TranscriptSegment, index: number) => {
    setEditingSegment({ ...segment, index });
    setShowEditTextModal(true);
  };

  // Save edited segment text, speaker, and timing
  const handleSaveSegmentText = () => {
    if (!editingSegment || !transcript || !jobId) return;

    // The undo target is the last *persisted* state. If this save is
    // completing a pending insert, that placeholder was never saved, so it
    // must not become what undo restores to.
    const previouslyPersisted =
      pendingNewSegmentIndex !== null
        ? (transcript.segments ?? []).filter((_, i) => i !== pendingNewSegmentIndex)
        : (transcript.segments ?? []);

    const updatedSegments = [...(transcript.segments ?? [])];
    const { words, ...unedited } = updatedSegments[editingSegment.index];
    updatedSegments[editingSegment.index] = {
      // The words (and their confidence) only describe the text as heard.
      ...(editingSegment.text === unedited.text ? { ...unedited, words } : unedited),
      text: editingSegment.text,
      speaker: editingSegment.speaker,
      start: editingSegment.start,
      end: editingSegment.end,
    };

    commit(previouslyPersisted, updatedSegments);
    setShowEditTextModal(false);
    setEditingSegment(null);
    setPendingNewSegmentIndex(null);
  };

  // Close the edit modal without saving. If the segment being edited was a
  // fresh insert (handleInsertSegmentAfter) that was never persisted, remove
  // it rather than leaving an empty bubble behind.
  const handleCancelEditText = () => {
    if (pendingNewSegmentIndex !== null && transcript) {
      const updatedSegments = (transcript.segments ?? []).filter(
        (_, i) => i !== pendingNewSegmentIndex
      );
      setTranscriptWithColors({ ...transcript, segments: updatedSegments });
    }
    setPendingNewSegmentIndex(null);
    setShowEditTextModal(false);
    setEditingSegment(null);
  };

  // Insert a new, blank segment right after `afterIndex` (or at the start if
  // -1), defaulting to the same speaker and a short slot between the
  // surrounding segments' timestamps, then open it for editing immediately —
  // for lines the transcription missed entirely. Nothing is persisted until
  // the user saves; cancelling removes the placeholder (see handleCancelEditText).
  const handleInsertSegmentAfter = (afterIndex: number) => {
    if (!transcript) return;

    const segments = transcript.segments ?? [];
    const prev = segments[afterIndex];
    const next = segments[afterIndex + 1];
    const speaker = prev?.speaker ?? segments[0]?.speaker ?? 'SPEAKER_00';
    const start = prev ? Number(prev.end) : 0;
    const desiredEnd = start + 2;
    const end = next ? Math.max(start + 0.1, Math.min(desiredEnd, Number(next.start))) : desiredEnd;

    const newSegment: TranscriptSegment = { speaker, text: '', start, end };
    const insertAt = afterIndex + 1;
    const updatedSegments = [...segments];
    updatedSegments.splice(insertAt, 0, newSegment);

    setTranscriptWithColors({ ...transcript, segments: updatedSegments });
    setPendingNewSegmentIndex(insertAt);
    handleEditText(newSegment, insertAt);
  };

  // Open the split-segment modal for a segment whose text actually spans a
  // missed speaker change.
  const handleRequestSplitSegment = (segment: TranscriptSegment, index: number) => {
    setSplittingSegment({ ...segment, index });
    setShowSplitModal(true);
  };

  const handleCancelSplitSegment = () => {
    setShowSplitModal(false);
    setSplittingSegment(null);
  };

  // Split one segment's text into two, attributing the second half to a
  // different speaker. Timing splits at `splitRatio` (0-1 through the
  // segment, picked on the modal's waveform scrubber) when given; otherwise
  // falls back to dividing proportionally to how the text was split, which
  // is only an approximation (no waveform to align to).
  const handleSplitSegment = (
    index: number,
    firstText: string,
    secondText: string,
    secondSpeaker: string,
    splitRatio?: number
  ) => {
    if (!transcript || !jobId) return;

    const segments = transcript.segments ?? [];
    const original = segments[index];
    if (!original) return;

    const originalLength = original.text.length || 1;
    const ratio =
      splitRatio !== undefined
        ? Math.min(Math.max(splitRatio, 0.02), 0.98)
        : Math.min(Math.max(firstText.length / originalLength, 0.05), 0.95);
    const start = Number(original.start);
    const end = Number(original.end);
    const splitTime = start + (end - start) * ratio;

    const { words: _words, ...originalWithoutWords } = original;
    const firstSegment: TranscriptSegment = {
      ...originalWithoutWords,
      text: firstText,
      end: splitTime,
    };
    const secondSegment: TranscriptSegment = {
      speaker: secondSpeaker,
      text: secondText,
      start: splitTime,
      end,
    };

    const updatedSegments = [...segments];
    updatedSegments.splice(index, 1, firstSegment, secondSegment);

    commit(segments, updatedSegments);
    setShowSplitModal(false);
    setSplittingSegment(null);
  };

  // Reassign a segment to a different speaker (e.g. dragged to another Kanban column).
  const handleMoveSegmentSpeaker = (index: number, newSpeaker: string) => {
    if (!transcript || !jobId) return;

    const segment = transcript.segments?.[index];
    if (!segment || segment.speaker === newSpeaker) return;

    const previousSegments = transcript.segments ?? [];
    const updatedSegments = [...previousSegments];
    updatedSegments[index] = { ...updatedSegments[index], speaker: newSpeaker };

    commit(previousSegments, updatedSegments);
  };

  // Move a segment next to another one (e.g. dropped in a Kanban column at
  // the height of another bubble): it is said by `speaker` and, if needed,
  // gets times between its new neighbours.
  const handleMoveSegmentTo = (
    index: number,
    targetIndex: number,
    placement: DropPlacement,
    speaker: string
  ) => {
    if (!transcript || !jobId) return;

    const previousSegments = transcript.segments ?? [];
    const updatedSegments = moveSegmentNextTo(
      previousSegments,
      index,
      targetIndex,
      placement,
      speaker
    );
    if (!updatedSegments) return;

    commit(previousSegments, updatedSegments);
  };

  // Merge a segment into another (dropped onto it in the Kanban view): its text
  // goes after the target's.
  const handleMergeSegmentInto = (index: number, targetIndex: number) => {
    if (!transcript || !jobId) return;

    const previousSegments = transcript.segments ?? [];
    const updatedSegments = mergeSegmentInto(previousSegments, index, targetIndex);
    if (!updatedSegments) return;

    commit(previousSegments, updatedSegments);
  };

  // Reassign several segments to a different speaker at once (e.g. removing a
  // speaker column and moving all its lines to another one), in one save.
  const handleBulkMoveSegments = (indices: number[], newSpeaker: string) => {
    if (!transcript || !jobId || indices.length === 0) return;

    const previousSegments = transcript.segments ?? [];
    const updatedSegments = [...previousSegments];
    for (const index of indices) {
      if (updatedSegments[index]) {
        updatedSegments[index] = { ...updatedSegments[index], speaker: newSpeaker };
      }
    }

    commit(previousSegments, updatedSegments);
  };

  // Permanently remove segments from the transcript (e.g. deleting a speaker
  // and its lines instead of reassigning them).
  const handleDeleteSegments = (indices: number[]) => {
    if (!transcript || !jobId || indices.length === 0) return;

    const previousSegments = transcript.segments ?? [];
    const indexSet = new Set(indices);
    const updatedSegments = previousSegments.filter((_, i) => !indexSet.has(i));

    commit(previousSegments, updatedSegments);
  };

  // Speakers renamed on the server: the states undo can go back to (and any
  // edit still to be saved) use the new names too, or they would save the old
  // names again.
  const renameSpeakersInHistory = (mapping: SpeakerMapping) => {
    const rename = (segments: TranscriptSegment[]) =>
      segments.map((segment) =>
        mapping[segment.speaker] && mapping[segment.speaker] !== segment.speaker
          ? { ...segment, speaker: mapping[segment.speaker] }
          : segment
      );
    setHistory((prev) => prev.map(rename));
    // An edit not saved yet must not bring the old names back on the server.
    if (jobId) saver.updatePending(jobId, rename);
  };

  // Step back one entry in the undo history, restoring and saving that
  // earlier segment array.
  const handleUndo = () => {
    if (!transcript || !jobId || history.length === 0) return;

    const targetSegments = history[history.length - 1];
    setHistory((prev) => prev.slice(0, -1));
    setTranscriptWithColors({ ...transcript, segments: targetSegments });
    setError(null);
    saver.queueSave(jobId, targetSegments);
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
    handleCancelEditText,
    handleInsertSegmentAfter,
    handleMoveSegmentSpeaker,
    handleMoveSegmentTo,
    handleMergeSegmentInto,
    handleBulkMoveSegments,
    handleDeleteSegments,
    splittingSegment,
    showSplitModal,
    handleRequestSplitSegment,
    handleCancelSplitSegment,
    handleSplitSegment,
    canUndo: history.length > 0,
    handleUndo,
    renameSpeakersInHistory,
    saveState: saver.saveState,
    saveError: saver.saveError,
    retrySaveAt: saver.retryAt,
    retrySave: saver.retryNow,
    flushSaves: saver.flush,
  };
}
