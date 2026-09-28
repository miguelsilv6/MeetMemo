import { useEffect, useRef, useState } from 'react';
import { useTranslation as useI18n } from 'react-i18next';
import { Alert, Button, Card, Container, Modal } from '@govtechsg/sgds-react';
import { ArrowLeft, Shield } from 'lucide-react';
import type { ProjectAudio, ProjectDetail } from './types/projects';
import type { RecentJob, WorkflowStep } from './types/api';

// Custom Hooks
import useBackendHealth from './hooks/useBackendHealth';
import useJobHistory from './hooks/useJobHistory';
import useFileUpload from './hooks/useFileUpload';
import useAudioRecording from './hooks/useAudioRecording';
import useTranscriptPolling from './hooks/useTranscriptPolling';
import useTranscript from './hooks/useTranscript';
import useSpeakerManagement from './hooks/useSpeakerManagement';
import useSummary from './hooks/useSummary';
import useTranslation from './hooks/useTranslation';
import useHashRoute, {
  ADMIN_ROUTE,
  PROJECTS_ROUTE,
  isProjectsRoute,
  parseJobRoute,
  parseProjectRoute,
  projectRoute,
} from './hooks/useHashRoute';
import useSession from './hooks/useSession';
import * as api from './services/api';

// Layout Components
import Header from './components/Layout/Header';
import WorkflowSteps from './components/Layout/WorkflowSteps';
import Footer from './components/Layout/Footer';

// Common Components
import LoadingScreen from './components/Common/LoadingScreen';
import ErrorAlert from './components/Common/ErrorAlert';

// View Components
import UploadView from './components/Upload/UploadView';
import ProcessingView from './components/Processing/ProcessingView';
import TranscriptView from './components/Transcript/TranscriptView';
import SummaryView from './components/Summary/SummaryView';
import AdminView from './components/Admin/AdminView';
import LoginView from './components/Auth/LoginView';
import ChangePasswordForm from './components/Auth/ChangePasswordForm';
import ProjectsView from './components/Projects/ProjectsView';
import ProjectView from './components/Projects/ProjectView';

// Modal Components
import EditSpeakersModal from './components/Modals/EditSpeakersModal';
import EditTextModal from './components/Modals/EditTextModal';
import EditSummaryModal from './components/Modals/EditSummaryModal';
import RecordingModal from './components/Modals/RecordingModal';
import SplitSegmentModal from './components/Modals/SplitSegmentModal';

import './App.css';

function App() {
  const { t } = useI18n();
  // Core application state
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('upload');
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The project a transcript was opened from, for the way back to it.
  const [openedFromProject, setOpenedFromProject] = useState<{
    uuid: string;
    name: string;
  } | null>(null);
  const route = useHashRoute();
  const session = useSession();
  const me = session.state.status === 'signedIn' ? session.state.me : null;
  // Signed in with a usable account (a temporary password must be replaced first).
  const signedIn = !!me && !me.must_change_password;
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  // Leaving the admin panel (by its button, a link or the address bar): the
  // administrator may have signed in or out there, so check the session again.
  const lastRouteRef = useRef(route);
  const refreshSession = session.refresh;
  useEffect(() => {
    if (lastRouteRef.current === ADMIN_ROUTE && route !== ADMIN_ROUTE) refreshSession();
    lastRouteRef.current = route;
  }, [route, refreshSession]);
  const projectsRoute = isProjectsRoute(route);
  const openProjectUuid = parseProjectRoute(route);

  // Backend health check
  const { backendReady, backendError } = useBackendHealth();

  // Transcript management
  const {
    transcript,
    setTranscriptWithColors,
    editingSegment,
    setEditingSegment,
    showEditTextModal,
    handleEditText,
    handleSaveSegmentText,
    handleCancelEditText,
    handleInsertSegmentAfter,
    handleMoveSegmentSpeaker,
    handleBulkMoveSegments,
    handleDeleteSegments,
    splittingSegment,
    showSplitModal,
    handleRequestSplitSegment,
    handleCancelSplitSegment,
    handleSplitSegment,
    canUndo,
    handleUndo,
  } = useTranscript(jobId, setError);

  // Transcript translation (Portuguese)
  const {
    translatedSegments,
    translating,
    translationProgress,
    showTranslation,
    handleToggleTranslation,
  } = useTranslation(jobId, setError);

  // Speaker management
  const {
    editingSpeakers,
    setEditingSpeakers,
    showEditSpeakersModal,
    setShowEditSpeakersModal,
    handleEditSpeakers,
    handleSaveSpeakers,
  } = useSpeakerManagement(jobId, transcript, setTranscriptWithColors, setError);

  // Transcript polling (defined before useFileUpload that depends on it)
  const { processingProgress, startPolling, stopPolling, setProcessingProgress } =
    useTranscriptPolling(setTranscriptWithColors, setCurrentStep, null, setError);

  // File upload
  const {
    selectedFile,
    uploading,
    fileInputRef,
    handleFileSelect,
    handleDragOver,
    handleDrop,
    handleUpload,
    setSelectedFile,
    selectedLanguage,
    setSelectedLanguage,
    applyDefaultLanguage,
    maxUploadMb,
    applyUploadLimit,
  } = useFileUpload(
    setError,
    setCurrentStep,
    setProcessingProgress,
    setJobId,
    setTranscriptWithColors,
    startPolling
  );

  // Audio recording
  const {
    isRecording,
    recordingTime,
    stopRecording,
    cleanup: cleanupRecording,
  } = useAudioRecording(
    setError,
    setCurrentStep,
    setProcessingProgress,
    setJobId,
    setTranscriptWithColors,
    startPolling
  );

  // Job history
  const { recentJobs, loadingJobs, fetchRecentJobs, handleLoadJob, handleDeleteJob } =
    useJobHistory(
      backendReady && signedIn,
      setTranscriptWithColors,
      setCurrentStep,
      setJobId,
      setSelectedFile,
      setError,
      handleUpload
    );

  // Summary management
  const {
    summary,
    generatingSummary,
    editingSummary,
    setEditingSummary,
    showEditSummaryModal,
    setShowEditSummaryModal,
    handleGenerateSummary,
    generateSummaryFor,
    handleEditSummary,
    handleSaveSummary,
  } = useSummary(jobId, setCurrentStep, setError);

  // View a past job's summary directly from Recent Meetings, without making
  // the user regenerate it — the backend serves the cached copy for a job
  // that already has one.
  const handleViewRecentSummary = async (job: RecentJob) => {
    await handleLoadJob(job);
    await generateSummaryFor(job.uuid);
  };

  // Start new meeting handler
  const handleStartNewMeeting = () => {
    stopPolling();
    cleanupRecording();
    setCurrentStep('upload');
    setSelectedFile(null);
    setJobId(null);
    setError(null);
    setProcessingProgress(0);
    setOpenedFromProject(null);
    if (window.location.hash) window.location.hash = '';
    fetchRecentJobs();
  };

  const openProjects = () => {
    window.location.hash = PROJECTS_ROUTE;
  };

  // Open a processed project audio in the usual transcript view.
  const handleOpenProjectAudio = async (project: ProjectDetail, audio: ProjectAudio) => {
    setOpenedFromProject({ uuid: project.uuid, name: project.name });
    window.location.hash = '';
    await handleLoadJob({ uuid: audio.uuid, filename: audio.file_name, status_code: 200 });
  };

  const handleLogout = async () => {
    handleStartNewMeeting();
    await session.signOut();
  };

  // The token balance changes with each upload (and comes back if processing
  // fails): refresh it as the workflow moves on or reports an error.
  useEffect(() => {
    if (signedIn && !me?.is_admin) refreshSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on workflow changes only
  }, [jobId, currentStep, error]);

  // #/jobs/<uuid> opens one audio's transcript (links from the admin panel).
  const openJobUuid = parseJobRoute(route);
  useEffect(() => {
    if (!openJobUuid || !signedIn) return undefined;
    let cancelled = false;
    api
      .getJobStatus(openJobUuid)
      .then((status) => {
        if (cancelled) return;
        window.location.hash = '';
        handleLoadJob({
          uuid: openJobUuid,
          filename: status.file_name,
          status_code: status.status_code,
        });
      })
      .catch((err: Error) => {
        if (cancelled) return;
        window.location.hash = '';
        setError(err.message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the route or session changes
  }, [openJobUuid, signedIn]);

  // Show loading screen while backend is initializing
  if (!backendReady && !backendError) {
    return <LoadingScreen backendError={backendError} />;
  }

  // Show error screen if backend failed to load
  if (backendError) {
    return <LoadingScreen backendError={backendError} />;
  }

  // Everything but the admin panel needs a signed-in account.
  if (route !== ADMIN_ROUTE && !signedIn) {
    return (
      <div className="app">
        <Header onStartNewMeeting={() => {}} />
        <Container className="py-5">
          {session.state.status === 'loading' ? (
            <p className="text-center text-muted py-5">{t('common.loading')}</p>
          ) : me?.must_change_password ? (
            <Card className="auth-card mx-auto">
              <Card.Header>
                <h1 className="h5 mb-0">{t('auth.forcedChange.title')}</h1>
              </Card.Header>
              <Card.Body>
                <p className="text-muted small">{t('auth.forcedChange.intro')}</p>
                <ChangePasswordForm
                  onChanged={() => session.refresh()}
                  secondaryAction={
                    <Button variant="outline-secondary" onClick={() => session.signOut()}>
                      {t('auth.menu.logout')}
                    </Button>
                  }
                />
              </Card.Body>
            </Card>
          ) : (
            <>
              {session.state.status === 'error' && (
                <Alert show variant="danger" className="auth-card mx-auto">
                  {session.state.message}
                </Alert>
              )}
              <LoginView onSignedIn={session.signedIn} />
            </>
          )}
        </Container>
        <Footer />
      </div>
    );
  }

  return (
    <div className="app">
      <Header
        onStartNewMeeting={handleStartNewMeeting}
        onOpenProjects={route === ADMIN_ROUTE ? undefined : openProjects}
        projectsActive={projectsRoute}
        me={route === ADMIN_ROUTE ? null : me}
        onChangePassword={() => setShowPasswordModal(true)}
        onLogout={handleLogout}
      />
      {route !== ADMIN_ROUTE && !projectsRoute && <WorkflowSteps currentStep={currentStep} />}

      <Container className="py-5">
        {me?.is_admin && route !== ADMIN_ROUTE && (
          <Alert show variant="info" className="d-flex align-items-start gap-2 admin-browse-banner">
            <Shield size={18} className="flex-shrink-0 mt-1" aria-hidden="true" />
            <div>{t('auth.adminBanner', { username: me.username })}</div>
          </Alert>
        )}
        {route === ADMIN_ROUTE ? (
          <AdminView
            onExit={() => {
              window.location.hash = '';
            }}
          />
        ) : openProjectUuid ? (
          <ProjectView
            key={openProjectUuid}
            projectUuid={openProjectUuid}
            canUpload={!me?.is_admin}
            tokenBalance={me?.token_balance ?? null}
            onBalanceChange={refreshSession}
            onBack={openProjects}
            onOpenAudio={handleOpenProjectAudio}
          />
        ) : projectsRoute ? (
          <ProjectsView
            canCreate={!me?.is_admin}
            onOpenProject={(uuid) => {
              window.location.hash = projectRoute(uuid);
            }}
          />
        ) : (
          <>
            <ErrorAlert error={error} onClose={() => setError(null)} />

            {openedFromProject && (currentStep === 'transcript' || currentStep === 'summary') && (
              <Button
                variant="link"
                className="px-0 mb-3"
                onClick={() => {
                  window.location.hash = projectRoute(openedFromProject.uuid);
                }}
              >
                <ArrowLeft size={16} className="me-1" />
                {t('projects.backTo', { name: openedFromProject.name })}
              </Button>
            )}

            {/* Step 1: Upload */}
            {currentStep === 'upload' && (
              <UploadView
                uploading={uploading}
                fileInputRef={fileInputRef}
                handleFileSelect={handleFileSelect}
                handleDragOver={handleDragOver}
                handleDrop={handleDrop}
                recentJobs={recentJobs}
                loadingJobs={loadingJobs}
                handleLoadJob={handleLoadJob}
                handleDeleteJob={handleDeleteJob}
                handleViewSummary={handleViewRecentSummary}
                selectedLanguage={selectedLanguage}
                onLanguageChange={setSelectedLanguage}
                onDefaultLanguage={applyDefaultLanguage}
                maxUploadMb={maxUploadMb}
                onUploadLimit={applyUploadLimit}
                onOpenProjects={openProjects}
                canUpload={!me?.is_admin}
                tokenBalance={me?.token_balance ?? null}
              />
            )}

            {/* Step 2: Processing */}
            {currentStep === 'processing' && (
              <ProcessingView processingProgress={processingProgress} />
            )}

            {/* Step 3: Transcript */}
            {currentStep === 'transcript' && (
              <TranscriptView
                transcript={transcript}
                selectedFile={selectedFile}
                jobId={jobId}
                handleEditSpeakers={handleEditSpeakers}
                handleEditText={handleEditText}
                handleMoveSegmentSpeaker={handleMoveSegmentSpeaker}
                handleBulkMoveSegments={handleBulkMoveSegments}
                handleDeleteSegments={handleDeleteSegments}
                handleInsertSegmentAfter={handleInsertSegmentAfter}
                handleRequestSplitSegment={handleRequestSplitSegment}
                handleGenerateSummary={handleGenerateSummary}
                generatingSummary={generatingSummary}
                summary={summary}
                translatedSegments={translatedSegments}
                translating={translating}
                translationProgress={translationProgress}
                showTranslation={showTranslation}
                handleToggleTranslation={handleToggleTranslation}
                canUndo={canUndo}
                handleUndo={handleUndo}
              />
            )}

            {/* Step 4: Summary */}
            {currentStep === 'summary' && (
              <SummaryView
                summary={summary}
                transcript={transcript}
                selectedFile={selectedFile}
                jobId={jobId}
                handleEditSummary={handleEditSummary}
                handleStartNewMeeting={handleStartNewMeeting}
                setCurrentStep={setCurrentStep}
              />
            )}
          </>
        )}
      </Container>

      <Footer />

      <Modal show={showPasswordModal} onHide={() => setShowPasswordModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>{t('auth.menu.changePassword')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <ChangePasswordForm
            onChanged={() => setShowPasswordModal(false)}
            secondaryAction={
              <Button variant="outline-secondary" onClick={() => setShowPasswordModal(false)}>
                {t('common.cancel')}
              </Button>
            }
          />
        </Modal.Body>
      </Modal>

      {/* Modals */}
      <EditSpeakersModal
        show={showEditSpeakersModal}
        onHide={() => setShowEditSpeakersModal(false)}
        editingSpeakers={editingSpeakers}
        setEditingSpeakers={setEditingSpeakers}
        handleSaveSpeakers={handleSaveSpeakers}
      />

      <EditTextModal
        show={showEditTextModal}
        onHide={handleCancelEditText}
        editingSegment={editingSegment}
        setEditingSegment={setEditingSegment}
        handleSaveSegmentText={handleSaveSegmentText}
        transcript={transcript}
        editingSpeakers={editingSpeakers}
      />

      <SplitSegmentModal
        key={splittingSegment?.index ?? 'none'}
        show={showSplitModal}
        onHide={handleCancelSplitSegment}
        segment={splittingSegment}
        jobId={jobId}
        speakers={[...new Set((transcript?.segments ?? []).map((s) => s.speaker))]}
        editingSpeakers={editingSpeakers}
        onSplit={handleSplitSegment}
      />

      <EditSummaryModal
        show={showEditSummaryModal}
        onHide={() => setShowEditSummaryModal(false)}
        editingSummary={editingSummary}
        setEditingSummary={setEditingSummary}
        handleSaveSummary={handleSaveSummary}
      />

      <RecordingModal
        show={isRecording}
        onHide={() => {}}
        recordingTime={recordingTime}
        onStop={stopRecording}
      />
    </div>
  );
}

export default App;
