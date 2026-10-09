// Types for the admin panel API (mirrors backend runtime_settings.RuntimeSettings).

import type { TranslationEngine } from './api';

export interface RuntimeSettings {
  whisper_model_name: string;
  diarization_model: string;
  beam_size: number;
  temperature_fallback: boolean;
  vad_filter: boolean;
  vad_onset: number;
  vad_offset: number;
  vad_min_silence_ms: number;
  vad_speech_pad_ms: number;
  hallucination_silence_threshold: number | null;
  low_confidence_avg_logprob: number;
  low_confidence_no_speech_prob: number;
  low_confidence_compression_ratio: number;
  hallucination_phrases: string[];
  audio_highpass: boolean;
  audio_loudnorm: boolean;
  default_language: string | null;
  translation_engine: TranslationEngine;
  job_retention_hours: number;
  project_retention_days: number;
  max_upload_mb: number;
  default_daily_tokens: number;
  llm_summary_system_prompt: string;
  llm_summary_request: string;
  llm_language_rule: string;
  llm_language_reminder: string;
  llm_translation_instructions: string;
}

/** Prompt parts the backend depends on; shown read-only. */
export interface FixedPrompts {
  translation_output_contract: string;
  qwen3_no_think: string;
}

export interface RestartOnlyConfig {
  hardware_profile: string;
  device: string;
  compute_type: string;
}

export interface AdminSettingsResponse {
  settings: RuntimeSettings;
  defaults: RuntimeSettings;
  allowed_models: string[];
  allowed_diarization_models: string[];
  languages: string[];
  restart_only: RestartOnlyConfig;
  fixed_prompts: FixedPrompts;
}

export interface SaveSettingsResponse {
  settings: RuntimeSettings;
  changed: string[];
}

export interface AuditEntry {
  id: number;
  changed_at: string;
  actor: string;
  setting_key: string;
  old_value: unknown;
  new_value: unknown;
}

/** A user account as the admin panel lists it. */
export interface AdminUser {
  uuid: string;
  username: string;
  display_name: string;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  last_login_at: string | null;
  project_count: number;
  audio_count: number;
  token_balance: number;
  /** Never charged for transcriptions (balance and quota then unused). */
  unlimited_tokens: boolean;
  /** The account's own daily quota, or null to follow the panel's default. */
  daily_token_quota: number | null;
  /** The daily quota in force (own or default) and how much of it today took. */
  daily_quota: number;
  daily_used: number;
}

/** An account's tokens as the admin API returns them. */
export interface UserTokenState {
  token_balance: number;
  unlimited_tokens: boolean;
  daily_quota: number;
  daily_used: number;
}

/** One movement in a user's token ledger. */
export interface TokenTransaction {
  id: number;
  created_at: string;
  delta: number;
  balance_after: number;
  reason: 'grant' | 'revoke' | 'charge' | 'refund';
  job_uuid: string | null;
  /** The audio's name, while it still exists. */
  file_name: string | null;
  actor: string | null;
  note: string | null;
  /** Where the token came from or went back to: today's quota or the extra balance. */
  pool: 'daily' | 'balance';
  /** For daily movements, the day whose quota they belong to (YYYY-MM-DD). */
  quota_day: string | null;
}

/** What one account owns, for the administrator to open. */
export interface UserContent {
  projects: {
    uuid: string;
    name: string;
    reference: string | null;
    created_at: string;
    expires_at: string;
    audio_count: number;
  }[];
  audios: { uuid: string; file_name: string; workflow_state: string; created_at: string }[];
}
