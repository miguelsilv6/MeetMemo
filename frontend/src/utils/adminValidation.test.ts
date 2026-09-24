import { describe, it, expect } from 'vitest';
import { parsePhrases, validateSettings } from './adminValidation';
import type { RuntimeSettings } from '../types/admin';

const valid: RuntimeSettings = {
  whisper_model_name: 'large-v3',
  beam_size: 5,
  temperature_fallback: true,
  vad_filter: true,
  vad_onset: 0.35,
  vad_offset: 0.2,
  vad_min_silence_ms: 1000,
  vad_speech_pad_ms: 400,
  hallucination_silence_threshold: 2,
  low_confidence_avg_logprob: -1,
  low_confidence_no_speech_prob: 0.6,
  low_confidence_compression_ratio: 2.4,
  hallucination_phrases: ['Obrigado por assistir'],
  audio_highpass: true,
  audio_loudnorm: true,
  default_language: null,
  job_retention_hours: 12,
};

describe('validateSettings', () => {
  it('accepts the defaults', () => {
    expect(validateSettings(valid)).toEqual({});
  });

  it('flags out-of-range, non-integer and missing numbers', () => {
    const errors = validateSettings({
      ...valid,
      beam_size: 11,
      job_retention_hours: 1.5,
      vad_speech_pad_ms: NaN,
    });
    expect(errors.beam_size).toEqual({
      key: 'admin.settings.errors.range',
      params: { min: 1, max: 10 },
    });
    expect(errors.job_retention_hours?.key).toBe('admin.settings.errors.integer');
    expect(errors.vad_speech_pad_ms?.key).toBe('admin.settings.errors.required');
  });

  it('requires the VAD silence threshold to be below the speech threshold', () => {
    expect(validateSettings({ ...valid, vad_offset: 0.35 }).vad_offset?.key).toBe(
      'admin.settings.errors.offsetBelowOnset'
    );
  });

  it('allows the hallucination silence threshold to be disabled', () => {
    expect(validateSettings({ ...valid, hallucination_silence_threshold: null })).toEqual({});
  });

  it('limits phrase length', () => {
    expect(
      validateSettings({ ...valid, hallucination_phrases: ['a'.repeat(201)] }).hallucination_phrases
        ?.key
    ).toBe('admin.settings.errors.phraseTooLong');
  });
});

describe('parsePhrases', () => {
  it('trims lines, collapses spaces and drops blanks', () => {
    expect(parsePhrases('  Obrigado   por assistir \n\n Outra\n')).toEqual([
      'Obrigado por assistir',
      'Outra',
    ]);
  });
});
