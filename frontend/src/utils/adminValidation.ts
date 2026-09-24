// Client-side checks mirroring backend runtime_settings.RuntimeSettings, so the
// admin form can flag problems before saving. The backend validates again.

import type { RuntimeSettings } from '../types/admin';

export interface NumericRule {
  min: number;
  max: number;
  step: number;
  integer?: boolean;
}

export const NUMERIC_RULES = {
  beam_size: { min: 1, max: 10, step: 1, integer: true },
  vad_onset: { min: 0.05, max: 0.95, step: 0.05 },
  vad_offset: { min: 0.01, max: 0.95, step: 0.05 },
  vad_min_silence_ms: { min: 100, max: 10000, step: 100, integer: true },
  vad_speech_pad_ms: { min: 0, max: 2000, step: 50, integer: true },
  hallucination_silence_threshold: { min: 0.5, max: 30, step: 0.5 },
  low_confidence_avg_logprob: { min: -5, max: 0, step: 0.1 },
  low_confidence_no_speech_prob: { min: 0, max: 1, step: 0.05 },
  low_confidence_compression_ratio: { min: 1, max: 10, step: 0.1 },
  job_retention_hours: { min: 1, max: 8760, step: 1, integer: true },
} satisfies Record<string, NumericRule>;

export type NumericField = keyof typeof NUMERIC_RULES;

export const MAX_PHRASES = 200;
export const MAX_PHRASE_LENGTH = 200;

/** An i18n key plus its interpolation values. */
export interface FieldError {
  key: string;
  params?: Record<string, number>;
}

export type SettingsErrors = Partial<Record<keyof RuntimeSettings, FieldError>>;

/** Split the phrases textarea into trimmed, non-empty lines. */
export function parsePhrases(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

export function validateSettings(settings: RuntimeSettings): SettingsErrors {
  const errors: SettingsErrors = {};

  for (const [field, rule] of Object.entries(NUMERIC_RULES) as [NumericField, NumericRule][]) {
    const value = settings[field];
    if (field === 'hallucination_silence_threshold' && value === null) continue;
    if (typeof value !== 'number' || Number.isNaN(value)) {
      errors[field] = { key: 'admin.settings.errors.required' };
    } else if (rule.integer && !Number.isInteger(value)) {
      errors[field] = { key: 'admin.settings.errors.integer' };
    } else if (value < rule.min || value > rule.max) {
      errors[field] = {
        key: 'admin.settings.errors.range',
        params: { min: rule.min, max: rule.max },
      };
    }
  }

  if (!errors.vad_onset && !errors.vad_offset && settings.vad_offset >= settings.vad_onset) {
    errors.vad_offset = { key: 'admin.settings.errors.offsetBelowOnset' };
  }

  if (settings.hallucination_phrases.length > MAX_PHRASES) {
    errors.hallucination_phrases = {
      key: 'admin.settings.errors.tooManyPhrases',
      params: { max: MAX_PHRASES },
    };
  } else if (settings.hallucination_phrases.some((p) => p.length > MAX_PHRASE_LENGTH)) {
    errors.hallucination_phrases = {
      key: 'admin.settings.errors.phraseTooLong',
      params: { max: MAX_PHRASE_LENGTH },
    };
  }

  return errors;
}
