import { useState } from 'react';
import { Alert, Button, Form, Modal } from '@govtechsg/sgds-react';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { WHISPER_LANGUAGES, getLanguageName } from '../../constants/languages';

interface RetranscribeModalProps {
  show: boolean;
  onHide: () => void;
  /** Starts the new transcription; rejects with the reason it could not. */
  onConfirm: (language: string) => Promise<void>;
  /** The language Whisper detected (left out of the choices). */
  detectedLanguage?: string | null;
  /** Pre-selected choice, e.g. the default language set in the admin panel. */
  defaultLanguage?: string | null;
}

/**
 * Choose the language to transcribe an audio in again, after warning what
 * the new transcription replaces.
 */
export default function RetranscribeModal({
  show,
  onHide,
  onConfirm,
  detectedLanguage = null,
  defaultLanguage = null,
}: RetranscribeModalProps) {
  const { t } = useTranslation();
  const choices = WHISPER_LANGUAGES.filter(
    (lang): lang is { code: string; name: string } =>
      lang.code !== null && lang.code !== detectedLanguage
  );
  const initial =
    defaultLanguage && choices.some((lang) => lang.code === defaultLanguage) ? defaultLanguage : '';
  const [language, setLanguage] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setError(null);
    setLanguage(initial);
    onHide();
  };

  const confirm = async () => {
    if (!language) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(language);
      setLanguage(initial);
    } catch (err) {
      setError((err as Error).message || t('retranscribe.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show={show} onHide={close}>
      <Modal.Header closeButton>
        <Modal.Title>{t('retranscribe.title')}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {detectedLanguage && (
          <p>{t('retranscribe.detected', { language: getLanguageName(detectedLanguage) })}</p>
        )}
        <Form.Group controlId="retranscribe-language" className="mb-3">
          <Form.Label>{t('retranscribe.languageLabel')}</Form.Label>
          <Form.Select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={busy}
          >
            <option value="">{t('retranscribe.choose')}</option>
            {choices.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {getLanguageName(lang.code)} ({lang.code})
              </option>
            ))}
          </Form.Select>
        </Form.Group>
        <Alert show variant="warning" className="mb-0">
          {t('retranscribe.warning')}
        </Alert>
        {error && (
          <Alert show variant="danger" className="mt-3 mb-0">
            {error}
          </Alert>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={close} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" onClick={confirm} disabled={!language || busy}>
          <RotateCcw size={16} className="me-1" />
          {busy ? t('retranscribe.starting') : t('retranscribe.confirm')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
