import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal } from '@govtechsg/sgds-react';
import { AlertTriangle, Download, FileText, Phone, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import * as api from '../../services/api';
import { formatDateTime } from '../../utils/projectDates';
import { columnsOf, elementsOf, fieldLabel, formatCallDuration } from '../../utils/callRecord';
import type { CallRecord, CallRecordElement, CallRecordSummary } from '../../types/api';

// The groups of child elements the details show, by their tag in the file.
const GROUPS = [
  ['participants', 'Participantes_do_produto'],
  ['cells', 'Coordenadas_da_célula'],
  ['events', 'Etiqueta'],
  ['files', 'Ficheiros_de_produtos'],
] as const;

/** The summary fields the sidebar shows, in order (the rest are in the details). */
const SIDEBAR_FIELDS: (keyof CallRecordSummary)[] = [
  'caller',
  'callee',
  'start',
  'end',
  'duration_seconds',
  'answered_at',
];

/** The summary fields of the details, in order. */
const DETAIL_FIELDS: (keyof CallRecordSummary)[] = [
  'product_id',
  'target_product_number',
  'product_type',
  'product_subtype',
  'protocol',
  'start',
  'end',
  'duration_seconds',
  'answered_at',
  'direction',
  'caller',
  'callee',
  'recorded',
  'end_reason',
  'case',
  'subcase',
  'target',
  'target_number',
  'interception_id',
  'interception_criterion',
];

function value(summary: CallRecordSummary, key: keyof CallRecordSummary): string | null {
  if (key === 'duration_seconds') return formatCallDuration(summary.duration_seconds);
  const raw = summary[key];
  return raw === null || raw === undefined || raw === '' ? null : String(raw);
}

function ElementTable({ elements }: { elements: CallRecordElement[] }) {
  const columns = columnsOf(elements);
  return (
    <div className="table-responsive mb-3">
      <table className="table table-sm small mb-0">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="fw-semibold">
                {fieldLabel(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {elements.map((element, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column}>{element.attributes[column] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CallRecordDetails({
  record,
  jobId,
  show,
  onHide,
}: {
  record: CallRecord;
  jobId: string;
  show: boolean;
  onHide: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { summary, elements, attributes } = record.data;
  return (
    <Modal show={show} onHide={onHide} size="xl" scrollable>
      <Modal.Header closeButton>
        <Modal.Title>{t('callRecord.title')}</Modal.Title>
      </Modal.Header>
      <Modal.Body data-testid="call-record-details">
        <p className="small text-muted">{t('callRecord.timesAsInFile')}</p>
        <table className="table table-sm mb-4">
          <tbody>
            {DETAIL_FIELDS.filter((key) => value(summary, key) !== null).map((key) => (
              <tr key={key}>
                <th scope="row" className="fw-normal text-muted w-50">
                  {t(`callRecord.fields.${key}`)}
                </th>
                <td>{value(summary, key)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {GROUPS.map(([group, tag]) => {
          const found = elementsOf(elements, tag);
          if (found.length === 0) return null;
          return (
            <section key={group}>
              <h6>{t(`callRecord.groups.${group}`)}</h6>
              <ElementTable elements={found} />
            </section>
          );
        })}
        <details className="mb-3">
          <summary className="fw-semibold">
            {t('callRecord.allFields', { count: Object.keys(attributes).length })}
          </summary>
          <table className="table table-sm small mt-2 mb-0">
            <tbody>
              {Object.entries(attributes).map(([name, field]) => (
                <tr key={name}>
                  <th scope="row" className="fw-normal text-muted w-50">
                    {fieldLabel(name)}
                  </th>
                  <td>{field}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
        <h6>{t('callRecord.provenance')}</h6>
        <ul className="small list-unstyled mb-0">
          <li>
            {t('callRecord.imported', {
              name: record.source_name,
              who: record.imported_by ?? '—',
              when: formatDateTime(record.imported_at, i18n.language),
            })}
          </li>
          <li className="text-break">
            SHA-256: <code>{record.sha256}</code>
          </li>
          {record.history.map((entry) => (
            <li key={`${entry.sha256}-${entry.replaced_at}`} className="text-muted text-break">
              {t('callRecord.replaced', {
                name: entry.source_name,
                sha256: entry.sha256,
                who: entry.replaced_by ?? '—',
                when: formatDateTime(entry.replaced_at, i18n.language),
              })}
            </li>
          ))}
        </ul>
      </Modal.Body>
      <Modal.Footer>
        <a className="btn btn-outline-secondary" href={api.callRecordFileUrl(jobId)} download>
          <Download size={16} className="me-1" />
          {t('callRecord.download')}
        </a>
        <Button variant="outline-secondary" onClick={onHide}>
          {t('common.close')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

/**
 * The audio's call record (its TranslatedPRI.xml): the main fields, a way to
 * import or replace the file, and every detail in a window.
 */
export default function CallRecordSection({ jobId }: { jobId: string }) {
  const { t } = useTranslation();
  // undefined: still loading; null: the audio has none.
  const [record, setRecord] = useState<CallRecord | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getCallRecord(jobId)
      .then((found) => {
        if (!cancelled) setRecord(found);
      })
      .catch(() => {
        if (!cancelled) setRecord(null);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setRecord(await api.uploadCallRecord(jobId, file));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  if (record === undefined) return null;
  const summary = record?.data.summary;

  return (
    <div className="info-item mb-3" data-testid="call-record">
      <small className="text-muted d-flex align-items-center gap-1">
        <Phone size={12} />
        {t('callRecord.title')}
      </small>
      {record && summary ? (
        <>
          {record.guid_matches_audio === false && (
            <Alert show variant="warning" className="py-2 px-2 my-2 small d-flex gap-2">
              <AlertTriangle size={16} className="flex-shrink-0 mt-1" />
              <span>{t('callRecord.guidMismatch', { guid: summary.guid })}</span>
            </Alert>
          )}
          <dl className="call-record-fields small mb-1 mt-1">
            {SIDEBAR_FIELDS.filter((key) => value(summary, key) !== null).map((key) => (
              <div key={key} className="d-flex gap-2">
                <dt className="fw-normal text-muted">{t(`callRecord.fields.${key}`)}</dt>
                <dd className="mb-0 text-break">{value(summary, key)}</dd>
              </div>
            ))}
          </dl>
          <div className="d-flex flex-wrap gap-2">
            <Button variant="link" size="sm" className="p-0" onClick={() => setShowDetails(true)}>
              <FileText size={14} className="me-1" />
              {t('callRecord.showAll')}
            </Button>
            <Button
              variant="link"
              size="sm"
              className="p-0"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <Upload size={14} className="me-1" />
              {t('callRecord.replace')}
            </Button>
          </div>
          <CallRecordDetails
            record={record}
            jobId={jobId}
            show={showDetails}
            onHide={() => setShowDetails(false)}
          />
        </>
      ) : (
        <div className="small">
          <span className="text-muted d-block">{t('callRecord.none')}</span>
          <Button
            variant="link"
            size="sm"
            className="p-0"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <Upload size={14} className="me-1" />
            {t('callRecord.attach')}
          </Button>
        </div>
      )}
      {busy && <div className="small text-muted">{t('callRecord.importing')}</div>}
      {error && (
        <Alert show variant="danger" className="py-2 px-2 mt-2 mb-0 small" role="alert">
          {t('callRecord.importFailed', { reason: error })}
        </Alert>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".xml,application/xml,text/xml"
        aria-label={t('callRecord.attach')}
        style={{ display: 'none' }}
        onChange={(e) => importFile(e.target.files?.[0])}
      />
    </div>
  );
}
