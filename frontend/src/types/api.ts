// Shared API and domain types for MeetMemo frontend

/** A single diarized + transcribed segment of a meeting. */
export interface TranscriptSegment {
  speaker: string;
  start: number;
  end: number;
  text: string;
  /** Set by the backend when the speech model's own quality signals mark this line as doubtful. */
  low_confidence?: boolean;
}

/**
 * Transcript payload as held in application state.
 *
 * The normalized shape is `{ segments }`, but the raw backend response for a
 * job's transcript may instead expose `full_transcript` as a JSON string, so
 * both fields are optional.
 */
export interface Transcript {
  segments?: TranscriptSegment[];
  full_transcript?: string;
  /** ISO 639-1 code of the language detected by Whisper (e.g. `en`, `pt`), if known. */
  language?: string;
  /** Whisper's confidence in the detected language, from 0 to 1. */
  language_probability?: number;
}

/** Mapping of speaker label (e.g. `SPEAKER_00`) to a display name. */
export type SpeakerMapping = Record<string, string>;

/** AI-generated meeting summary. */
export interface Summary {
  summary?: string;
  key_points?: string[];
  action_items?: string[];
}

/** Suggestions returned by the speaker identification endpoint. */
export type SpeakerSuggestions = Record<string, string>;

/** Response returned by the transcript translation endpoint. */
export interface TranslateResponse {
  status?: string;
  target_language?: string;
  /** Translated segments for the requested range, starting at `start`. */
  segments?: TranscriptSegment[];
  start?: number;
  /** Number of segments in the whole transcript. */
  total?: number;
}

export interface IdentifySpeakersResponse {
  status?: string;
  suggestions?: SpeakerSuggestions;
}

/** A single min/max peak pair, normalized to [-1, 1]. */
export interface WaveformPeak {
  min: number;
  max: number;
}

export interface WaveformResponse {
  peaks: WaveformPeak[];
}

/** Response returned when uploading audio / creating a job. */
export interface UploadResponse {
  uuid: string;
  status_code?: number | string;
  transcript?: Transcript;
}

/** A single job as summarized in the recent-jobs list (client-side shape). */
export interface RecentJob {
  uuid: string;
  filename?: string;
  status_code?: number | string;
  created_at?: string;
  has_summary?: boolean;
}

/** A job entry as returned by the backend `/jobs` listing. */
export interface JobsResponseEntry {
  file_name?: string;
  status_code?: number | string;
  created_at?: string;
  has_summary?: boolean;
}

export interface JobsResponse {
  jobs?: Record<string, JobsResponseEntry>;
}

/** Job status / workflow polling response. */
export interface JobStatus {
  workflow_state?: string;
  current_step_progress?: number;
  available_actions?: unknown;
  status_code?: number | string;
  error_message?: string;
}

/** The currently selected file — either a real `File` or a lightweight stub. */
export type SelectedFile = File | { name: string } | null;

/** The current workflow step shown in the UI. */
export type WorkflowStep = 'upload' | 'processing' | 'transcript' | 'summary';

/** Detected hardware + resolved ML configuration from the backend /system endpoint. */
export interface SystemInfo {
  hardware_profile_requested: string;
  resolved_profile: string;
  gpu_name: string | null;
  vram_gb: number | null;
  device: string;
  whisper_model_name: string;
  compute_type: string;
  pyannote_model_name: string;
  warnings: string[];
}

/** Error thrown by the API layer, augmented with response metadata. */
export interface ApiError extends Error {
  status?: number;
  category?: string;
  responseData?: unknown;
}
