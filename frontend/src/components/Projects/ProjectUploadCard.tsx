import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { Card, Form } from '@govtechsg/sgds-react';
import { Upload as UploadIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { WHISPER_LANGUAGES } from '../../constants/languages';
import { getPublicConfig } from '../../services/api';
import { uploadProjectAudios } from '../../services/projectsApi';
import { exceedsUploadLimit } from '../../utils/uploadLimit';
import type { UploadResult } from '../../types/projects';

export const AUDIO_ACCEPT = '.mp3,.wav,.m4a,.webm,.ogg,.flac,.aac';
const AUDIO_EXTENSIONS = AUDIO_ACCEPT.split(',');

interface ProjectUploadCardProps {
  projectUuid: string;
  /** Called after each file is stored, so the list shows it straight away. */
  onUploaded: () => void;
}

function isAudio(file: File): boolean {
  const name = file.name.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/** Drop several audios at once; they are sent one by one and queued on the server. */
export default function ProjectUploadCard({ projectUuid, onUploaded }: ProjectUploadCardProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ index: number; total: number; name: string } | null>(
    null
  );
  const [results, setResults] = useState<UploadResult[]>([]);
  // Largest file accepted, in MB (set in the admin panel); null until known.
  const [maxUploadMb, setMaxUploadMb] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPublicConfig()
      .then((config) => {
        if (!cancelled) setMaxUploadMb(config.max_upload_mb);
      })
      .catch(() => {
        // Without the limit the server still refuses oversized files.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const uploadAll = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0 || progress) return;
    const collected: UploadResult[] = [];
    for (const [index, file] of files.entries()) {
      setProgress({ index: index + 1, total: files.length, name: file.name });
      if (!isAudio(file)) {
        collected.push({ file_name: file.name, status: 'rejected', detail: 'type' });
      } else if (exceedsUploadLimit(file, maxUploadMb)) {
        collected.push({ file_name: file.name, status: 'rejected', detail: 'size' });
      } else {
        try {
          collected.push(...(await uploadProjectAudios(projectUuid, [file], language)));
          onUploaded();
        } catch (err) {
          collected.push({
            file_name: file.name,
            status: 'rejected',
            detail: (err as Error).message,
          });
        }
      }
      setResults([...collected]);
    }
    setProgress(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) uploadAll(e.dataTransfer.files);
  };

  const resultText = (result: UploadResult) => {
    if (result.status === 'queued') return t('projects.upload.result.queued');
    if (result.status === 'duplicate')
      return t('projects.upload.result.duplicate', { name: result.detail });
    if (result.detail === 'size') return t('projects.upload.result.tooLarge', { max: maxUploadMb });
    return result.detail === 'type' || result.detail === 'Unsupported file type'
      ? t('projects.upload.result.unsupported')
      : t('projects.upload.result.rejected', { reason: result.detail });
  };

  const busy = progress !== null;

  return (
    <Card className="mb-4">
      <Card.Body>
        <div className="d-flex flex-wrap align-items-end justify-content-between gap-3 mb-3">
          <h5 className="mb-0">{t('projects.upload.title')}</h5>
          <Form.Group controlId="project-upload-language" className="project-upload-language">
            <Form.Label className="small text-muted mb-1">
              {t('fileUpload.languageLabel')}
            </Form.Label>
            <Form.Select
              size="sm"
              value={language ?? ''}
              disabled={busy}
              onChange={(e) => setLanguage(e.target.value || null)}
            >
              {WHISPER_LANGUAGES.map((lang) => (
                <option key={lang.code || 'auto'} value={lang.code || ''}>
                  {lang.name}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        </div>

        <div
          className="upload-dropzone text-center mb-2"
          role="button"
          tabIndex={0}
          aria-disabled={busy}
          onClick={() => !busy && inputRef.current?.click()}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !busy) inputRef.current?.click();
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          style={{ cursor: busy ? 'default' : 'pointer' }}
        >
          <UploadIcon size={32} strokeWidth={1.5} className="text-primary mb-2" />
          <p className="mb-1">
            <strong>{t('projects.upload.choose')}</strong> {t('fileUpload.orDragDrop')}
          </p>
          <small className="text-muted">
            {t('fileUpload.supportedFormats')}
            {maxUploadMb !== null && ` (${t('fileUpload.maxSize', { max: maxUploadMb })})`}
          </small>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={AUDIO_ACCEPT}
          aria-label={t('projects.upload.choose')}
          style={{ display: 'none' }}
          onChange={(e) => e.target.files && uploadAll(e.target.files)}
        />
        <small className="text-muted d-block">{t('projects.upload.hint')}</small>

        {progress && (
          <div className="mt-3" role="status">
            <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
            {t('projects.upload.progress', progress)}
          </div>
        )}

        {results.length > 0 && (
          <ul className="list-unstyled small mt-3 mb-0 project-upload-results">
            {results.map((result, index) => (
              <li
                key={`${result.file_name}-${index}`}
                className={
                  result.status === 'queued'
                    ? 'text-success'
                    : result.status === 'duplicate'
                      ? 'text-warning-emphasis'
                      : 'text-danger'
                }
              >
                <strong>{result.file_name}</strong>: {resultText(result)}
              </li>
            ))}
          </ul>
        )}
      </Card.Body>
    </Card>
  );
}
