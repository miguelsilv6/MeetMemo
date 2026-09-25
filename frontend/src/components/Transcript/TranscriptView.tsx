import { useState, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { Row, Col, Card, Button, ButtonGroup, Modal, Form } from '@govtechsg/sgds-react';
import {
  FileText,
  Users,
  LayoutList,
  LayoutGrid,
  Languages,
  CheckSquare,
  Undo2,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import TranscriptSegment from './TranscriptSegment';
import MeetingInfoSidebar from './MeetingInfoSidebar';
import AudioPlayer from './AudioPlayer';
import type { AudioPlayerHandle } from './AudioPlayer';
import { formatTime } from '../../utils/timeFormat';
import type { TranslationProgress } from '../../hooks/useTranslation';
import type {
  SelectedFile,
  Summary,
  Transcript,
  TranscriptSegment as TranscriptSegmentType,
} from '../../types/api';

type TranscriptDisplayMode = 'list' | 'kanban';

// Pulls in @dnd-kit/core; only fetched once the user actually switches to the
// Kanban view instead of bloating the initial transcript-view bundle.
const TranscriptKanbanView = lazy(() => import('./TranscriptKanbanView'));

interface TranscriptViewProps {
  transcript: Transcript | null;
  selectedFile: SelectedFile;
  jobId: string | null;
  handleEditSpeakers: () => void;
  handleEditText: (segment: TranscriptSegmentType, index: number) => void;
  handleMoveSegmentSpeaker: (index: number, newSpeaker: string) => void;
  handleBulkMoveSegments: (indices: number[], newSpeaker: string) => void;
  handleDeleteSegments: (indices: number[]) => void;
  handleInsertSegmentAfter: (index: number) => void;
  handleRequestSplitSegment: (segment: TranscriptSegmentType, index: number) => void;
  handleGenerateSummary: () => void;
  generatingSummary: boolean;
  summary: Summary | null;
  identifyingSpeakers: boolean;
  translatedSegments: TranscriptSegmentType[] | null;
  translating: boolean;
  /** Blocks translated so far, while a translation is running. */
  translationProgress?: TranslationProgress | null;
  showTranslation: boolean;
  handleToggleTranslation: (segments: TranscriptSegmentType[] | undefined) => void;
  canUndo: boolean;
  handleUndo: () => void;
}

/**
 * Find the active segment index based on current playback time.
 */
function findActiveSegmentIndex(
  segments: TranscriptSegmentType[] | undefined,
  currentTime: number
): number {
  if (!segments || segments.length === 0) return -1;

  for (let i = 0; i < segments.length; i++) {
    const start = Number(segments[i].start);
    const end = Number(segments[i].end);
    if (currentTime >= start && currentTime < end) {
      return i;
    }
  }

  // If past the last segment, return last segment
  const lastEnd = Number(segments[segments.length - 1].end);
  if (currentTime >= lastEnd) {
    return segments.length - 1;
  }

  return -1;
}

export default function TranscriptView({
  transcript,
  selectedFile,
  jobId,
  handleEditSpeakers,
  handleEditText,
  handleMoveSegmentSpeaker,
  handleBulkMoveSegments,
  handleDeleteSegments,
  handleInsertSegmentAfter,
  handleRequestSplitSegment,
  handleGenerateSummary,
  generatingSummary,
  summary,
  identifyingSpeakers,
  translatedSegments,
  translating,
  translationProgress = null,
  showTranslation,
  handleToggleTranslation,
  canUndo,
  handleUndo,
}: TranscriptViewProps) {
  const { t } = useTranslation();
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(-1);
  const [displayMode, setDisplayMode] = useState<TranscriptDisplayMode>('list');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [bulkMoveTarget, setBulkMoveTarget] = useState('');
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  // Index of a single segment awaiting delete confirmation.
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null);
  const audioPlayerRef = useRef<AudioPlayerHandle | null>(null);

  const speakers = useMemo(
    () => [...new Set((transcript?.segments ?? []).map((s) => s.speaker))],
    [transcript]
  );

  const toggleSelectMode = () => {
    setSelectMode((prev) => !prev);
    setSelectedIndices(new Set());
  };

  const handleToggleSelect = useCallback((index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIndices(new Set());
  };

  const handleBulkMove = () => {
    if (!bulkMoveTarget || selectedIndices.size === 0) return;
    handleBulkMoveSegments([...selectedIndices], bulkMoveTarget);
    exitSelectMode();
  };

  const pendingDeleteSegment =
    pendingDeleteIndex !== null ? transcript?.segments?.[pendingDeleteIndex] : undefined;

  const handleConfirmDeleteSegment = () => {
    if (pendingDeleteIndex !== null) handleDeleteSegments([pendingDeleteIndex]);
    setPendingDeleteIndex(null);
  };

  const handleConfirmBulkDelete = () => {
    handleDeleteSegments([...selectedIndices]);
    setShowBulkDeleteConfirm(false);
    exitSelectMode();
  };

  // Translated text to display in place of each segment's original text, by
  // index, when a Portuguese translation is active. Segments themselves (and
  // what gets handed to the edit modal) always stay the original data — only
  // the rendered text is swapped, so editing never overwrites the original
  // with a translation.
  const displayTextByIndex = useMemo(() => {
    if (!showTranslation || !translatedSegments) return undefined;
    return translatedSegments.map((segment) => segment.text);
  }, [showTranslation, translatedSegments]);

  // Handle time update from audio player
  const handleTimeUpdate = useCallback(
    (currentTime: number) => {
      if (transcript?.segments) {
        const newIndex = findActiveSegmentIndex(transcript.segments, currentTime);
        setActiveSegmentIndex((prev) => (newIndex !== prev ? newIndex : prev));
      }
    },
    [transcript]
  );

  // Handle seeking to a segment
  const handleSeekToSegment = useCallback((time: number) => {
    if (audioPlayerRef.current?.seekTo) {
      audioPlayerRef.current.seekTo(time);
    }
  }, []);

  return (
    <Row>
      <Col lg={8}>
        <Card className="mb-4">
          <Card.Header className="d-flex justify-content-between align-items-center">
            <h5 className="mb-0">
              <FileText size={20} className="me-2" />
              {t('transcript.title')}
            </h5>
            <div className="d-flex gap-2 align-items-center">
              <ButtonGroup>
                <Button
                  variant={displayMode === 'list' ? 'primary' : 'outline-primary'}
                  size="sm"
                  onClick={() => setDisplayMode('list')}
                  title={t('transcript.listViewTitle')}
                >
                  <LayoutList size={16} />
                </Button>
                <Button
                  variant={displayMode === 'kanban' ? 'primary' : 'outline-primary'}
                  size="sm"
                  onClick={() => setDisplayMode('kanban')}
                  title={t('transcript.kanbanViewTitle')}
                >
                  <LayoutGrid size={16} />
                </Button>
              </ButtonGroup>
              {/* Translation always targets European Portuguese, so it is pointless
                  for a transcript that is already in Portuguese. */}
              {transcript?.language !== 'pt' && (
                <Button
                  variant={showTranslation ? 'primary' : 'outline-primary'}
                  size="sm"
                  onClick={() => handleToggleTranslation(transcript?.segments)}
                  disabled={translating || !transcript?.segments?.length}
                  title={t('transcript.translateToPortuguese')}
                >
                  {translating ? (
                    <span
                      className="spinner-border spinner-border-sm me-1"
                      role="status"
                      aria-hidden="true"
                    ></span>
                  ) : (
                    <Languages size={16} className="me-1" />
                  )}
                  {translating && translationProgress
                    ? t('transcript.translatingProgress', { ...translationProgress })
                    : showTranslation
                      ? t('transcript.showOriginal')
                      : t('transcript.translateToPortuguese')}
                </Button>
              )}
              <Button variant="outline-primary" size="sm" onClick={handleEditSpeakers}>
                <Users size={16} className="me-1" />
                {t('transcript.editSpeakers')}
              </Button>
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={handleUndo}
                disabled={!canUndo}
                title={t('transcript.undo')}
              >
                <Undo2 size={16} />
              </Button>
              <Button
                variant={selectMode ? 'primary' : 'outline-secondary'}
                size="sm"
                onClick={toggleSelectMode}
                disabled={!transcript?.segments?.length}
                title={t('transcript.selectSegments')}
              >
                <CheckSquare size={16} />
              </Button>
            </div>
          </Card.Header>
          {selectMode && (
            <div className="bulk-actions-bar d-flex flex-wrap gap-2 align-items-center px-3 py-2 border-bottom">
              <span className="text-muted small">
                {t('bulkActions.selectedCount', { count: selectedIndices.size })}
              </span>
              <Form.Select
                size="sm"
                style={{ width: 'auto' }}
                value={bulkMoveTarget}
                onChange={(e) => setBulkMoveTarget(e.target.value)}
                disabled={selectedIndices.size === 0}
              >
                <option value="">{t('bulkActions.moveTo')}</option>
                {speakers.map((speaker) => (
                  <option key={speaker} value={speaker}>
                    {speaker}
                  </option>
                ))}
              </Form.Select>
              <Button
                variant="outline-primary"
                size="sm"
                onClick={handleBulkMove}
                disabled={selectedIndices.size === 0 || !bulkMoveTarget}
              >
                {t('bulkActions.move')}
              </Button>
              <Button
                variant="outline-danger"
                size="sm"
                onClick={() => setShowBulkDeleteConfirm(true)}
                disabled={selectedIndices.size === 0}
              >
                <Trash2 size={14} className="me-1" />
                {t('bulkActions.delete')}
              </Button>
              <Button variant="link" size="sm" onClick={exitSelectMode}>
                {t('bulkActions.cancel')}
              </Button>
            </div>
          )}
          <Card.Body>
            {transcript && transcript.segments ? (
              displayMode === 'kanban' ? (
                <Suspense
                  fallback={
                    <div className="text-center text-muted py-5">
                      <span
                        className="spinner-border spinner-border-sm me-2"
                        role="status"
                        aria-hidden="true"
                      ></span>
                      {t('transcript.loadingKanban')}
                    </div>
                  }
                >
                  <TranscriptKanbanView
                    segments={transcript.segments}
                    displayTextByIndex={displayTextByIndex}
                    activeSegmentIndex={activeSegmentIndex}
                    handleEditText={handleEditText}
                    onSeekToSegment={handleSeekToSegment}
                    onMoveSegmentSpeaker={handleMoveSegmentSpeaker}
                    onBulkMoveSegments={handleBulkMoveSegments}
                    onDeleteSegments={handleDeleteSegments}
                    onInsertSegmentAfter={handleInsertSegmentAfter}
                    onSplitSegment={handleRequestSplitSegment}
                    onRequestDeleteSegment={setPendingDeleteIndex}
                    selectMode={selectMode}
                    selectedIndices={selectedIndices}
                    onToggleSelect={handleToggleSelect}
                  />
                </Suspense>
              ) : (
                <div className="transcript-content">
                  {transcript.segments.map((segment, index) => (
                    <TranscriptSegment
                      key={index}
                      segment={segment}
                      displayText={displayTextByIndex?.[index]}
                      index={index}
                      handleEditText={handleEditText}
                      isActive={index === activeSegmentIndex}
                      onSeekToSegment={handleSeekToSegment}
                      onInsertSegmentAfter={handleInsertSegmentAfter}
                      onSplitSegment={handleRequestSplitSegment}
                      onDeleteSegment={setPendingDeleteIndex}
                      selectMode={selectMode}
                      isSelected={selectedIndices.has(index)}
                      onToggleSelect={handleToggleSelect}
                    />
                  ))}
                </div>
              )
            ) : (
              <div className="transcript-placeholder text-center text-muted py-5">
                <FileText size={48} className="mb-3 opacity-50" />
                <p>{t('transcript.placeholder')}</p>
              </div>
            )}
          </Card.Body>
        </Card>
      </Col>

      <Col lg={4}>
        <AudioPlayer
          jobId={jobId}
          onTimeUpdate={handleTimeUpdate}
          currentSegmentRef={audioPlayerRef}
        />
        <MeetingInfoSidebar
          selectedFile={selectedFile}
          transcript={transcript}
          identifyingSpeakers={identifyingSpeakers}
          handleGenerateSummary={handleGenerateSummary}
          generatingSummary={generatingSummary}
          summary={summary}
          jobId={jobId}
        />
      </Col>

      <Modal show={pendingDeleteSegment !== undefined} onHide={() => setPendingDeleteIndex(null)}>
        <Modal.Header closeButton>
          <Modal.Title>{t('transcript.deleteSegmentConfirmTitle')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>{t('transcript.deleteSegmentConfirmBody')}</p>
          {pendingDeleteSegment && (
            <blockquote className="delete-segment-preview mb-0">
              <small className="text-muted d-block mb-1">
                {pendingDeleteSegment.speaker} · {formatTime(pendingDeleteSegment.start)} -{' '}
                {formatTime(pendingDeleteSegment.end)}
              </small>
              {pendingDeleteSegment.text}
            </blockquote>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setPendingDeleteIndex(null)}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={handleConfirmDeleteSegment}>
            {t('common.delete')}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showBulkDeleteConfirm} onHide={() => setShowBulkDeleteConfirm(false)}>
        <Modal.Header closeButton>
          <Modal.Title>{t('bulkActions.deleteConfirmTitle')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {t('bulkActions.deleteConfirmBody', { count: selectedIndices.size })}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setShowBulkDeleteConfirm(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="outline-danger" onClick={handleConfirmBulkDelete}>
            {t('common.delete')}
          </Button>
        </Modal.Footer>
      </Modal>
    </Row>
  );
}
