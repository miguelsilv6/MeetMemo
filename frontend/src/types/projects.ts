// Types for projects (mirrors backend api/v1/projects.py).

export interface Project {
  uuid: string;
  name: string;
  reference: string | null;
  description: string | null;
  created_at: string;
  /** Fixed at creation; the project and all its files are deleted then. */
  expires_at: string;
}

export interface ProjectSummary extends Project {
  audio_count: number;
  completed_count: number;
  error_count: number;
}

export interface ProjectListResponse {
  projects: ProjectSummary[];
  /** Retention applied to projects created now, in days. */
  retention_days: number;
}

export type ProjectAudioStatus = 'queued' | 'processing' | 'completed' | 'error';

export interface ProjectAudio {
  uuid: string;
  file_name: string;
  status: ProjectAudioStatus;
  workflow_state: string;
  /** Progress through transcription, diarization and alignment (0-100). */
  progress: number;
  /** 1 for the audio processed next; null unless queued. */
  queue_position: number | null;
  error_message: string | null;
  language: string | null;
  created_at: string;
}

export interface ProjectDetail extends Project {
  audios: ProjectAudio[];
}

export interface ProjectDetails {
  name: string;
  reference: string | null;
  description: string | null;
}

export type UploadResultStatus = 'queued' | 'duplicate' | 'rejected';

export interface UploadResult {
  file_name: string;
  status: UploadResultStatus;
  uuid?: string;
  /** Existing file name for a duplicate; the reason for a rejection. */
  detail?: string;
}
