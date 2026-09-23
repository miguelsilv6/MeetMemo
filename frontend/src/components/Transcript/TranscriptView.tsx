import { useState, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { Row, Col, Card, Button, ButtonGroup } from '@govtechsg/sgds-react';
import { FileText, Users, LayoutList, LayoutGrid, Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import TranscriptSegment from './TranscriptSegment';
import MeetingInfoSidebar from './MeetingInfoSidebar';
import AudioPlayer from './AudioPlayer';
import type { AudioPlayerHandle } from './AudioPlayer';
import type {
  SelectedFile,
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
  handleGenerateSummary: () => void;
  generatingSummary: boolean;
  identifyingSpeakers: boolean;
  translatedSegments: TranscriptSegmentType[] | null;
  translating: boolean;
  showTranslation: boolean;
  handleToggleTranslation: (segments: TranscriptSegmentType[] | undefined) => void;
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
  handleGenerateSummary,
  generatingSummary,
  identifyingSpeakers,
  translatedSegments,
  translating,
  showTranslation,
  handleToggleTranslation,
}: TranscriptViewProps) {
  const { t } = useTranslation();
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(-1);
  const [displayMode, setDisplayMode] = useState<TranscriptDisplayMode>('list');
  const audioPlayerRef = useRef<AudioPlayerHandle | null>(null);

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
                {showTranslation
                  ? t('transcript.showOriginal')
                  : t('transcript.translateToPortuguese')}
              </Button>
              <Button variant="outline-primary" size="sm" onClick={handleEditSpeakers}>
                <Users size={16} className="me-1" />
                {t('transcript.editSpeakers')}
              </Button>
            </div>
          </Card.Header>
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
          jobId={jobId}
        />
      </Col>
    </Row>
  );
}
