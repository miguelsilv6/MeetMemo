import { describe, it, expect } from 'vitest';
import { parsePhrases, validateSettings, withDefaultPrompts } from './adminValidation';
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
  project_retention_days: 7,
  max_upload_mb: 100,
  default_daily_tokens: 0,
  llm_summary_system_prompt: 'Default system prompt.',
  llm_summary_request: 'Default request.',
  llm_language_rule: 'Default language rule.',
  llm_language_reminder: 'Default reminder.',
  llm_translation_instructions: 'Default translation instructions.',
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

describe('prompts', () => {
  it('limits prompt length after trimming', () => {
    expect(validateSettings({ ...valid, llm_language_reminder: ` ${'x'.repeat(1000)} ` })).toEqual(
      {}
    );
    expect(validateSettings({ ...valid, llm_language_reminder: 'x'.repeat(1001) })).toEqual({
      llm_language_reminder: { key: 'admin.settings.errors.promptTooLong', params: { max: 1000 } },
    });
  });

  it('replaces blank prompts with their defaults and normalises the rest', () => {
    const result = withDefaultPrompts(
      { ...valid, llm_summary_request: '  \n ', llm_language_rule: ' Regra\r\nnova ' },
      { ...valid, llm_summary_request: 'Pedido de origem.' }
    );
    expect(result.llm_summary_request).toBe('Pedido de origem.');
    expect(result.llm_language_rule).toBe('Regra\nnova');
    expect(result.llm_summary_system_prompt).toBe(valid.llm_summary_system_prompt);
  });
});
