import { useEffect, useState } from 'react';
import { Alert, Button, Modal } from '@govtechsg/sgds-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { getJobProcessing } from '../../services/adminApi';
import { getLanguageName } from '../../constants/languages';
import type { JobProcessingInfo, ProcessingSettings } from '../../types/admin';

interface ProcessingInfoModalProps {
  show: boolean;
  onHide: () => void;
  jobId: string;
}

/** The settings shown, in this order; their labels are the admin panel's. */
const SETTINGS_ORDER = [
  'beam_size',
  'temperature_fallback',
  'vad_filter',
  'vad_onset',
  'vad_offset',
  'vad_min_silence_ms',
  'vad_speech_pad_ms',
  'hallucination_silence_threshold',
  'low_confidence_avg_logprob',
  'low_confidence_no_speech_prob',
  'low_confidence_compression_ratio',
  'audio_highpass',
  'audio_loudnorm',
  'stereo_mode',
  'default_language',
  'language_detection_windows',
] as const;

type SettingKey = (typeof SETTINGS_ORDER)[number];

function formatSetting(key: SettingKey, value: unknown, t: TFunction): string {
  if (typeof value === 'boolean') return value ? t('processingInfo.yes') : t('processingInfo.no');
  if (value === null || value === undefined) {
    // Off for a threshold, "detect" for the language.
    return key === 'default_language' ? t('processingInfo.automatic') : t('processingInfo.off');
  }
  if (key === 'stereo_mode') {
    return value === 'mix' ? t('processingInfo.stereoMix') : t('processingInfo.stereoAuto');
  }
  if (key === 'default_language') return getLanguageName(String(value));
  return String(value);
}

function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <th scope="row" className="fw-normal text-muted w-50">
        {label}
      </th>
      <td>{children}</td>
    </tr>
  );
}

function diarizationText(info: JobProcessingInfo, t: TFunction) {
  if (info.diarization_by_channels) return t('processingInfo.diarizationByChannels');
  return info.diarization_model ?? t('processingInfo.diarizationPending');
}

function languageText(info: JobProcessingInfo, t: TFunction) {
  const { language } = info;
  if (!language) return t('processingInfo.notRecorded');
  const name = getLanguageName(language.code);
  if (language.forced || language.probability === null) {
    return t('processingInfo.languageForced', { language: name });
  }
  return t('processingInfo.languageDetected', {
    language: name,
    percent: Math.round(language.probability * 100),
  });
}

function settingRows(settings: ProcessingSettings, t: TFunction) {
  return SETTINGS_ORDER.filter((key) => key in settings).map((key) => (
    <Row key={key} label={t(`admin.settings.fields.${key}.label`)}>
      {formatSetting(key, settings[key], t)}
    </Row>
  ));
}

/** The information itself; mounted each time the window opens, so it is asked again then. */
function ProcessingInfo({ jobId }: { jobId: string }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<JobProcessingInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getJobProcessing(jobId)
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (failed) {
    return (
      <Alert show variant="danger" className="mb-0">
        {t('processingInfo.failed')}
      </Alert>
    );
  }
  if (!info) return <p className="mb-0">{t('processingInfo.loading')}</p>;

  const phrases = info.settings?.hallucination_phrases_count;
  return (
    <>
      <h6>{t('processingInfo.processing')}</h6>
      <table className="table table-sm mb-4">
        <tbody>
          <Row label={t('processingInfo.whisperModel')}>
            {info.whisper_model ?? t('processingInfo.notRecorded')}
          </Row>
          <Row label={t('processingInfo.diarizationModel')}>{diarizationText(info, t)}</Row>
          <Row label={t('processingInfo.language')}>{languageText(info, t)}</Row>
          <Row label={t('processingInfo.recording')}>
            {info.channel_mode === 'split'
              ? t('processingInfo.recordingSplit')
              : info.channel_mode === 'mono'
                ? t('processingInfo.recordingMono')
                : t('processingInfo.notRecorded')}
          </Row>
          <Row label={t('processingInfo.speakersGiven')}>
            {info.num_speakers ?? t('processingInfo.speakersAuto')}
          </Row>
          <Row label={t('processingInfo.duration')}>
            {formatDuration(info.duration_seconds) ?? t('processingInfo.notRecorded')}
          </Row>
        </tbody>
      </table>
      <h6>{t('processingInfo.settingsTitle')}</h6>
      {info.settings ? (
        <table className="table table-sm mb-0">
          <tbody>
            {settingRows(info.settings, t)}
            {phrases !== undefined && (
              <Row label={t('admin.settings.fields.hallucination_phrases.label')}>
                {t('processingInfo.phrasesCount', { count: phrases })}
              </Row>
            )}
          </tbody>
        </table>
      ) : (
        <p className="text-muted mb-0">{t('processingInfo.settingsMissing')}</p>
      )}
    </>
  );
}

/**
 * How an audio was processed (administrator, read-only): the Whisper model, the
 * diarization model that made its speakers, the language, and the settings the
 * transcription ran with, as stored with the audio.
 */
export default function ProcessingInfoModal({ show, onHide, jobId }: ProcessingInfoModalProps) {
  const { t } = useTranslation();
  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>{t('processingInfo.title')}</Modal.Title>
      </Modal.Header>
      <Modal.Body data-testid="processing-info">
        <p className="text-muted small">{t('processingInfo.intro')}</p>
        {show && <ProcessingInfo jobId={jobId} />}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onHide}>
          {t('common.close')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
