// Types for the admin panel API (mirrors backend runtime_settings.RuntimeSettings).

export interface RuntimeSettings {
  whisper_model_name: string;
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
  job_retention_hours: number;
  project_retention_days: number;
  max_upload_mb: number;
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
  diarization_model: string;
}

export interface AdminSettingsResponse {
  settings: RuntimeSettings;
  defaults: RuntimeSettings;
  allowed_models: string[];
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
