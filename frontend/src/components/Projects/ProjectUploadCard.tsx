import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { Alert, Button, Card, Form } from '@govtechsg/sgds-react';
import { FolderOpen, Upload as UploadIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { WHISPER_LANGUAGES } from '../../constants/languages';
import SpeakerCountSelect from '../Upload/SpeakerCountSelect';
import { getPublicConfig, uploadCallRecord } from '../../services/api';
import { uploadProjectAudios } from '../../services/projectsApi';
import { exceedsUploadLimit } from '../../utils/uploadLimit';
import { findProducts } from '../../utils/productFolders';
import type { UploadResult } from '../../types/projects';

export const AUDIO_ACCEPT = '.mp3,.wav,.m4a,.webm,.ogg,.flac,.aac';
const AUDIO_EXTENSIONS = AUDIO_ACCEPT.split(',');

interface ProjectUploadCardProps {
  projectUuid: string;
  /** Called after each file is stored, so the list shows it straight away. */
  onUploaded: () => void;
  /** Tokens left (1 token = 1 transcription); null when unknown. */
  tokenBalance?: number | null;
}

/** A file to send, with the TranslatedPRI.xml of its product folder when chosen as a folder. */
interface UploadItem {
  file: File;
  callRecord: File | null;
}

/** A file's result, and what happened to its call record. */
type ItemResult = UploadResult & {
  callRecord?: 'imported' | 'failed' | 'not_attached';
  callRecordDetail?: string;
};

function isAudio(file: File): boolean {
  const name = file.name.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/** Drop several audios at once; they are sent one by one and queued on the server. */
export default function ProjectUploadCard({
  projectUuid,
  onUploaded,
  tokenBalance = null,
}: ProjectUploadCardProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const [numSpeakers, setNumSpeakers] = useState<number | null>(null);
  const [progress, setProgress] = useState<{ index: number; total: number; name: string } | null>(
    null
  );
  const [results, setResults] = useState<ItemResult[]>([]);
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

  const uploadAll = async (items: UploadItem[]) => {
    if (items.length === 0 || progress) return;
    const collected: ItemResult[] = [];
    let outOfTokens = false;
    for (const [index, { file, callRecord }] of items.entries()) {
      setProgress({ index: index + 1, total: items.length, name: file.name });
      if (outOfTokens && isAudio(file)) {
        // The next audios would be refused too: don't send them.
        collected.push({ file_name: file.name, status: 'no_tokens' });
      } else if (!isAudio(file)) {
        collected.push({ file_name: file.name, status: 'rejected', detail: 'type' });
      } else if (exceedsUploadLimit(file, maxUploadMb)) {
        collected.push({ file_name: file.name, status: 'rejected', detail: 'size' });
      } else {
        try {
          const results = await uploadProjectAudios(projectUuid, [file], language, numSpeakers);
          collected.push(...(await withCallRecords(results, callRecord)));
          outOfTokens = results.some((r) => r.status === 'no_tokens');
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
    if (folderRef.current) folderRef.current.value = '';
  };

  // The audio's TranslatedPRI.xml goes with the audio just created (not with
  // one already in the project, which keeps its own).
  const withCallRecords = async (
    uploaded: UploadResult[],
    callRecord: File | null
  ): Promise<ItemResult[]> => {
    if (!callRecord) return uploaded;
    return Promise.all(
      uploaded.map(async (result): Promise<ItemResult> => {
        if (result.status !== 'queued' || !result.uuid) {
          return { ...result, callRecord: 'not_attached' };
        }
        try {
          await uploadCallRecord(result.uuid, callRecord);
          return { ...result, callRecord: 'imported' };
        } catch (err) {
          return { ...result, callRecord: 'failed', callRecordDetail: (err as Error).message };
        }
      })
    );
  };

  const uploadFiles = (files: FileList | File[]) =>
    uploadAll(Array.from(files).map((file) => ({ file, callRecord: null })));

  // A case folder (or one product folder): each audio of a __CLIENT__ folder
  // with its product's TranslatedPRI.xml.
  const uploadFolder = (files: FileList) => {
    const products = findProducts(Array.from(files));
    if (products.length === 0) {
      setResults([
        { file_name: t('callRecord.folder.noAudioName'), status: 'rejected', detail: 'no_audio' },
      ]);
      if (folderRef.current) folderRef.current.value = '';
      return;
    }
    uploadAll(products.map(({ audio, callRecord }) => ({ file: audio, callRecord })));
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
  };

  const callRecordText = (result: ItemResult) => {
    if (result.callRecord === 'imported') return t('callRecord.upload.imported');
    if (result.callRecord === 'failed')
      return t('callRecord.upload.failed', { reason: result.callRecordDetail });
    if (result.callRecord === 'not_attached') return t('callRecord.upload.notAttached');
    return null;
  };

  const resultText = (result: UploadResult) => {
    if (result.detail === 'no_audio') return t('callRecord.folder.noAudio');
    if (result.status === 'queued') return t('projects.upload.result.queued');
    if (result.status === 'duplicate')
      return t('projects.upload.result.duplicate', { name: result.detail });
    if (result.status === 'no_tokens') return t('projects.upload.result.noTokens');
    if (result.detail === 'size') return t('projects.upload.result.tooLarge', { max: maxUploadMb });
    return result.detail === 'type' || result.detail === 'Unsupported file type'
      ? t('projects.upload.result.unsupported')
      : t('projects.upload.result.rejected', { reason: result.detail });
  };

  const noTokens = tokenBalance === 0;
  const busy = progress !== null || noTokens;

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
          <SpeakerCountSelect
            id="project-upload-num-speakers"
            value={numSpeakers}
            onChange={setNumSpeakers}
            disabled={busy}
          />
        </div>

        {noTokens && (
          <Alert show variant="warning" className="mb-2">
            {t('auth.noTokens')}
          </Alert>
        )}
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
          onChange={(e) => e.target.files && uploadFiles(e.target.files)}
        />
        <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
          <Button
            variant="outline-primary"
            size="sm"
            disabled={busy}
            onClick={() => folderRef.current?.click()}
          >
            <FolderOpen size={16} className="me-1" />
            {t('callRecord.folder.chooseCase')}
          </Button>
          <small className="text-muted">{t('callRecord.folder.caseHint')}</small>
        </div>
        <input
          ref={folderRef}
          type="file"
          aria-label={t('callRecord.folder.chooseCase')}
          style={{ display: 'none' }}
          onChange={(e) => e.target.files && uploadFolder(e.target.files)}
          {...{ webkitdirectory: '', directory: '' }}
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
                    : result.status === 'duplicate' || result.status === 'no_tokens'
                      ? 'text-warning-emphasis'
                      : 'text-danger'
                }
              >
                <strong>{result.file_name}</strong>: {resultText(result)}
                {callRecordText(result) && (
                  <span
                    className={
                      result.callRecord === 'imported' ? 'text-success' : 'text-warning-emphasis'
                    }
                  >
                    {' · '}
                    {callRecordText(result)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card.Body>
    </Card>
  );
}
