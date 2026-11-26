import { useCallback, useState, useRef } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import * as api from '../services/api';
import { normalizeTranscript } from '../utils/transcript';
import { exceedsUploadLimit, sizeInMb } from '../utils/uploadLimit';
import { findProducts } from '../utils/productFolders';
import type { SelectedFile } from '../types/api';
import type {
  SetCurrentStep,
  SetError,
  SetJobId,
  SetProcessingProgress,
  SetTranscriptWithColors,
  StartPolling,
} from '../types/ui';

export const AUTO_DETECT_LANGUAGE = 'auto';

/**
 * Custom hook for file selection, drag-and-drop, and upload logic
 * Handles file input, drag events, and upload process
 */
export default function useFileUpload(
  setError: SetError,
  setCurrentStep: SetCurrentStep,
  setProcessingProgress: SetProcessingProgress,
  setJobId: SetJobId,
  setTranscriptWithColors: SetTranscriptWithColors,
  startPolling: StartPolling
) {
  const { t } = useTranslation();
  const [selectedFile, setSelectedFile] = useState<SelectedFile>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null); // null = auto-detect
  const [selectedSpeakers, setSelectedSpeakers] = useState<number | null>(null); // null = diarization decides
  // Once the user picks a language, the admin-configured default no longer overrides it.
  const languageChosenByUser = useRef(false);

  const changeLanguage = useCallback((language: string | null) => {
    languageChosenByUser.current = true;
    setSelectedLanguage(language);
  }, []);

  const applyDefaultLanguage = useCallback((language: string | null) => {
    if (!languageChosenByUser.current) setSelectedLanguage(language);
  }, []);
  // Largest file accepted, in MB (set in the admin panel); null until known.
  const [maxUploadMb, setMaxUploadMb] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  // The TranslatedPRI.xml of the audio being uploaded (chosen with its product folder).
  const pendingCallRecord = useRef<File | null>(null);

  // Refuse a file over the limit here rather than after uploading it.
  const rejectIfTooLarge = (file: File): boolean => {
    if (!exceedsUploadLimit(file, maxUploadMb)) return false;
    setError(t('errors.fileTooLarge', { name: file.name, size: sizeInMb(file), max: maxUploadMb }));
    if (fileInputRef.current) fileInputRef.current.value = '';
    return true;
  };

  // Handle file selection
  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    pendingCallRecord.current = null;
    if (file && !rejectIfTooLarge(file)) {
      setSelectedFile(file);
      // Immediately show processing UI
      setCurrentStep('processing');
      setProcessingProgress(10);
      handleUpload(file);
    }
  };

  // A product folder: its audio (in __CLIENT__) with its TranslatedPRI.xml.
  const handleFolderSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const products = findProducts(Array.from(event.target.files ?? []));
    if (folderInputRef.current) folderInputRef.current.value = '';
    if (products.length === 0) {
      setError(t('callRecord.folder.noAudio'));
      return;
    }
    if (products.length > 1) {
      setError(t('callRecord.folder.manyAudios', { count: products.length }));
      return;
    }
    const [{ audio, callRecord }] = products;
    if (rejectIfTooLarge(audio)) return;
    pendingCallRecord.current = callRecord;
    setSelectedFile(audio);
    setCurrentStep('processing');
    setProcessingProgress(10);
    handleUpload(audio);
  };

  // The call record chosen with the audio goes with the audio just created.
  const attachPendingCallRecord = async (uuid: string) => {
    const record = pendingCallRecord.current;
    pendingCallRecord.current = null;
    if (!record) return;
    try {
      await api.uploadCallRecord(uuid, record);
    } catch (err) {
      setError(t('callRecord.importFailed', { reason: (err as Error).message }));
    }
  };

  // Handle drag and drop
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (uploading) return;

    const file = e.dataTransfer.files[0];
    pendingCallRecord.current = null;
    if (file && !rejectIfTooLarge(file)) {
      setSelectedFile(file);
      setCurrentStep('processing');
      setProcessingProgress(10);
      handleUpload(file);
    }
  };

  // Handle file upload
  const handleUpload = async (
    file: File | null,
    existingUuid: string | null = null
  ): Promise<void> => {
    setError(null);
    setUploading(true);
    setProcessingProgress(0);

    try {
      // If resuming an existing job, skip upload and start polling
      if (existingUuid) {
        setJobId(existingUuid);
        setCurrentStep('processing');
        setUploading(false);
        startPolling(existingUuid);
        return;
      }

      // No file to upload (should not happen without an existing job)
      if (!file) {
        setUploading(false);
        setCurrentStep('upload');
        return;
      }

      // Upload new file
      // Send 'auto' explicitly so the backend doesn't apply its default language
      // over a deliberate "Auto-detect" choice.
      const response = await api.uploadAudio(
        file,
        null,
        selectedLanguage ?? AUTO_DETECT_LANGUAGE,
        selectedSpeakers
      );
      setJobId(response.uuid);
      await attachPendingCallRecord(response.uuid);

      // Backend returns 202 immediately and processes in background
      if (response.status_code === 202 || response.status_code === '202') {
        setCurrentStep('processing');
        setUploading(false);
        startPolling(response.uuid);
      } else if (response.status_code === 200 || response.status_code === '200') {
        // If somehow it completes immediately
        setUploading(false);
        setProcessingProgress(100);
        if (response.transcript) {
          setTranscriptWithColors(normalizeTranscript(response.transcript));
          setTimeout(() => {
            setCurrentStep('transcript');
          }, 500);
        } else {
          setCurrentStep('processing');
          startPolling(response.uuid);
        }
      } else {
        // Fallback to polling
        setCurrentStep('processing');
        setUploading(false);
        startPolling(response.uuid);
      }
    } catch (err) {
      setError((err as Error).message || t('errors.uploadFile'));
      setUploading(false);
      setCurrentStep('upload');
      setProcessingProgress(0);
    }
  };

  return {
    selectedFile,
    uploading,
    fileInputRef,
    handleFileSelect,
    folderInputRef,
    handleFolderSelect,
    handleDragOver,
    handleDrop,
    handleUpload,
    setSelectedFile,
    selectedLanguage,
    setSelectedLanguage: changeLanguage,
    selectedSpeakers,
    setSelectedSpeakers,
    applyDefaultLanguage,
    maxUploadMb,
    applyUploadLimit: setMaxUploadMb,
  };
}
