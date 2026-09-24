import { useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Alert, Button, Card, Col, Form, Row } from '@govtechsg/sgds-react';
import { RotateCcw, Save, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getLanguageName } from '../../constants/languages';
import { AdminApiError, saveAdminSettings } from '../../services/adminApi';
import { NUMERIC_RULES, parsePhrases, validateSettings } from '../../utils/adminValidation';
import type { FieldError, NumericField } from '../../utils/adminValidation';
import type { AdminSettingsResponse, RuntimeSettings } from '../../types/admin';

interface AdminSettingsFormProps {
  data: AdminSettingsResponse;
  onSaved: (settings: RuntimeSettings) => void;
  onUnauthorized: () => void;
}

type BooleanField = {
  [K in keyof RuntimeSettings]: RuntimeSettings[K] extends boolean ? K : never;
}[keyof RuntimeSettings];

interface Message {
  variant: 'success' | 'danger' | 'info';
  text: string;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="admin-section mb-4">
      <legend className="h6 mb-3">{title}</legend>
      {children}
    </fieldset>
  );
}

function FieldHelp({ id, text }: { id: string; text: string }) {
  return (
    <Form.Text id={id} className="text-muted d-block">
      {text}
    </Form.Text>
  );
}

export default function AdminSettingsForm({
  data,
  onSaved,
  onUnauthorized,
}: AdminSettingsFormProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<RuntimeSettings>(data.settings);
  const [phrasesText, setPhrasesText] = useState(data.settings.hallucination_phrases.join('\n'));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const candidate = useMemo<RuntimeSettings>(
    () => ({ ...draft, hallucination_phrases: parsePhrases(phrasesText) }),
    [draft, phrasesText]
  );
  const errors = useMemo(() => validateSettings(candidate), [candidate]);
  const hasErrors = Object.keys(errors).length > 0;
  const dirty = JSON.stringify(candidate) !== JSON.stringify(data.settings);

  const update = <K extends keyof RuntimeSettings>(field: K, value: RuntimeSettings[K]) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setMessage(null);
  };

  const loadValues = (values: RuntimeSettings) => {
    setDraft(values);
    setPhrasesText(values.hallucination_phrases.join('\n'));
  };

  const errorText = (error?: FieldError) => (error ? t(error.key, error.params) : null);

  const numberField = (field: NumericField, disabled = false) => {
    const rule = NUMERIC_RULES[field];
    const value = draft[field];
    const error = errors[field];
    const id = `admin-${field}`;
    return (
      <Form.Group controlId={id} className="mb-3">
        <Form.Label>{t(`admin.settings.fields.${field}.label`)}</Form.Label>
        <Form.Control
          type="number"
          min={rule.min}
          max={rule.max}
          step={rule.step}
          value={value === null || Number.isNaN(value) ? '' : value}
          onChange={(e) =>
            update(field, (e.target.value === '' ? NaN : Number(e.target.value)) as never)
          }
          isInvalid={!!error}
          disabled={disabled}
          aria-describedby={`${id}-help`}
        />
        {error && <div className="invalid-feedback d-block">{errorText(error)}</div>}
        <FieldHelp id={`${id}-help`} text={t(`admin.settings.fields.${field}.help`)} />
      </Form.Group>
    );
  };

  const switchField = (field: BooleanField) => {
    const id = `admin-${field}`;
    return (
      <Form.Group className="mb-3">
        <Form.Check
          type="switch"
          id={id}
          label={t(`admin.settings.fields.${field}.label`)}
          checked={draft[field]}
          onChange={(e) => update(field, e.target.checked)}
          aria-describedby={`${id}-help`}
        />
        <FieldHelp id={`${id}-help`} text={t(`admin.settings.fields.${field}.help`)} />
      </Form.Group>
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (hasErrors) {
      setMessage({ variant: 'danger', text: t('admin.settings.invalid') });
      return;
    }
    if (!dirty) {
      setMessage({ variant: 'info', text: t('admin.settings.noChanges') });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const { settings, changed } = await saveAdminSettings(candidate);
      loadValues(settings);
      onSaved(settings);
      setMessage({
        variant: 'success',
        text: t('admin.settings.saved', { count: changed.length }),
      });
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401) {
        onUnauthorized();
        return;
      }
      setMessage({
        variant: 'danger',
        text: err instanceof Error ? err.message : t('errors.unknown'),
      });
    } finally {
      setSaving(false);
    }
  };

  const silenceEnabled = draft.hallucination_silence_threshold !== null;

  return (
    <Card className="mb-4">
      <Card.Header>
        <h5 className="mb-0">{t('admin.settings.title')}</h5>
      </Card.Header>
      <Card.Body>
        <p className="text-muted">{t('admin.settings.intro')}</p>
        <Form onSubmit={handleSubmit} noValidate>
          <Section title={t('admin.settings.sections.model')}>
            <Row>
              <Col md={6}>
                <Form.Group controlId="admin-whisper_model_name" className="mb-3">
                  <Form.Label>{t('admin.settings.fields.whisper_model_name.label')}</Form.Label>
                  <Form.Select
                    value={draft.whisper_model_name}
                    onChange={(e) => update('whisper_model_name', e.target.value)}
                    aria-describedby="admin-whisper_model_name-help"
                  >
                    {data.allowed_models.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </Form.Select>
                  <FieldHelp
                    id="admin-whisper_model_name-help"
                    text={t('admin.settings.fields.whisper_model_name.help')}
                  />
                </Form.Group>
              </Col>
              <Col md={6}>{numberField('beam_size')}</Col>
            </Row>
            {switchField('temperature_fallback')}
          </Section>

          <Section title={t('admin.settings.sections.antiHallucination')}>
            {switchField('vad_filter')}
            <Row>
              <Col md={6}>{numberField('vad_onset', !draft.vad_filter)}</Col>
              <Col md={6}>{numberField('vad_offset', !draft.vad_filter)}</Col>
              <Col md={6}>{numberField('vad_min_silence_ms', !draft.vad_filter)}</Col>
              <Col md={6}>{numberField('vad_speech_pad_ms', !draft.vad_filter)}</Col>
            </Row>
            <Form.Group className="mb-1">
              <Form.Check
                type="switch"
                id="admin-hallucination_silence_enabled"
                label={t('admin.settings.fields.hallucination_silence_enabled.label')}
                checked={silenceEnabled}
                onChange={(e) =>
                  update(
                    'hallucination_silence_threshold',
                    e.target.checked ? (data.defaults.hallucination_silence_threshold ?? 2) : null
                  )
                }
              />
            </Form.Group>
            {numberField('hallucination_silence_threshold', !silenceEnabled)}
            <p className="small text-muted mb-2">{t('admin.settings.reviewThresholdsIntro')}</p>
            <Row>
              <Col md={4}>{numberField('low_confidence_avg_logprob')}</Col>
              <Col md={4}>{numberField('low_confidence_no_speech_prob')}</Col>
              <Col md={4}>{numberField('low_confidence_compression_ratio')}</Col>
            </Row>
            <Form.Group controlId="admin-hallucination_phrases" className="mb-3">
              <Form.Label>{t('admin.settings.fields.hallucination_phrases.label')}</Form.Label>
              <Form.Control
                as="textarea"
                rows={8}
                value={phrasesText}
                onChange={(e) => {
                  setPhrasesText(e.target.value);
                  setMessage(null);
                }}
                isInvalid={!!errors.hallucination_phrases}
                aria-describedby="admin-hallucination_phrases-help"
              />
              {errors.hallucination_phrases && (
                <div className="invalid-feedback d-block">
                  {errorText(errors.hallucination_phrases)}
                </div>
              )}
              <FieldHelp
                id="admin-hallucination_phrases-help"
                text={t('admin.settings.fields.hallucination_phrases.help')}
              />
            </Form.Group>
          </Section>

          <Section title={t('admin.settings.sections.audio')}>
            {switchField('audio_highpass')}
            {switchField('audio_loudnorm')}
          </Section>

          <Section title={t('admin.settings.sections.languageRetention')}>
            <Row>
              <Col md={6}>
                <Form.Group controlId="admin-default_language" className="mb-3">
                  <Form.Label>{t('admin.settings.fields.default_language.label')}</Form.Label>
                  <Form.Select
                    value={draft.default_language ?? ''}
                    onChange={(e) => update('default_language', e.target.value || null)}
                    aria-describedby="admin-default_language-help"
                  >
                    <option value="">{t('admin.settings.autoDetect')}</option>
                    {data.languages.map((code) => (
                      <option key={code} value={code}>
                        {getLanguageName(code)} ({code})
                      </option>
                    ))}
                  </Form.Select>
                  <FieldHelp
                    id="admin-default_language-help"
                    text={t('admin.settings.fields.default_language.help')}
                  />
                </Form.Group>
              </Col>
              <Col md={6}>{numberField('job_retention_hours')}</Col>
            </Row>
          </Section>

          <Section title={t('admin.settings.sections.restartOnly')}>
            <dl className="row small mb-1">
              {(Object.keys(data.restart_only) as (keyof typeof data.restart_only)[]).map((key) => (
                <div key={key} className="col-md-6 d-flex gap-2">
                  <dt className="fw-normal text-muted">
                    {t(`admin.settings.restartOnly.${key}`)}:
                  </dt>
                  <dd className="mb-1">
                    <code>{data.restart_only[key]}</code>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="small text-muted mb-0">{t('admin.settings.restartOnly.hint')}</p>
          </Section>

          {message && (
            <Alert
              show
              variant={message.variant}
              role={message.variant === 'danger' ? 'alert' : 'status'}
            >
              {message.text}
            </Alert>
          )}

          <div className="d-flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={saving}>
              <Save size={16} className="me-2" />
              {saving ? t('admin.settings.saving') : t('admin.settings.save')}
            </Button>
            <Button
              type="button"
              variant="outline-secondary"
              onClick={() => {
                loadValues(data.settings);
                setMessage(null);
              }}
              disabled={saving || !dirty}
            >
              <Undo2 size={16} className="me-2" />
              {t('admin.settings.discard')}
            </Button>
            <Button
              type="button"
              variant="outline-secondary"
              onClick={() => {
                loadValues(data.defaults);
                setMessage({ variant: 'info', text: t('admin.settings.resetHint') });
              }}
              disabled={saving}
            >
              <RotateCcw size={16} className="me-2" />
              {t('admin.settings.resetDefaults')}
            </Button>
          </div>
        </Form>
      </Card.Body>
    </Card>
  );
}
