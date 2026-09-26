// API Service for MeetMemo Backend Communication

import i18n from '../i18n';
import {
  generateMarkdownFilename,
  generateTranscriptMarkdownFilename,
  generateTranscriptDocxFilename,
} from '../utils/fileNaming';
import type {
  ApiError,
  JobStatus,
  JobsResponse,
  SpeakerMapping,
  Summary,
  SystemInfo,
  Transcript,
  TranscriptSegment,
  TranslateResponse,
  UploadResponse,
  WaveformResponse,
} from '../types/api';

const API_BASE_URL = '/api/v1';

interface ErrorCategory {
  type: string;
  message: string;
  userMessage: string;
}

/**
 * Enhanced error logging for API calls
 * Logs detailed error information to help with debugging
 */
function logApiError(
  method: string,
  endpoint: string,
  error: ApiError,
  responseData: unknown = null
): void {
  const errorDetails = {
    timestamp: new Date().toISOString(),
    method,
    endpoint,
    error: error.message,
    stack: error.stack,
    responseData,
  };

  console.error('API Error Details:', errorDetails);

  // In production, you could send this to an error tracking service
  // Example: sendToErrorTrackingService(errorDetails);
}

/**
 * Categorize errors for better user messaging
 */
function categorizeError(response: Response | null, error: Error): ErrorCategory {
  if (!response) {
    return {
      type: 'NETWORK_ERROR',
      message: 'Network error - please check your connection',
      userMessage: i18n.t('errors.network'),
    };
  }

  const status = response.status;

  if (status === 404) {
    return {
      type: 'NOT_FOUND',
      message: 'Resource not found',
      userMessage: i18n.t('errors.notFound'),
    };
  } else if (status === 401 || status === 403) {
    return {
      type: 'AUTHENTICATION_ERROR',
      message: 'Authentication failed',
      userMessage: i18n.t('errors.unauthorized'),
    };
  } else if (status >= 400 && status < 500) {
    return {
      type: 'CLIENT_ERROR',
      message: `Client error: ${status}`,
      userMessage: i18n.t('errors.client'),
    };
  } else if (status >= 500) {
    return {
      type: 'SERVER_ERROR',
      message: `Server error: ${status}`,
      userMessage: i18n.t('errors.server'),
    };
  }

  return {
    type: 'UNKNOWN_ERROR',
    message: error.message || 'An unknown error occurred',
    userMessage: i18n.t('errors.unknown'),
  };
}

// Helper function for API calls
async function apiCall<T = unknown>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const method = options.method || 'GET';
  let response: Response;

  try {
    console.log(`API Request: ${method} ${endpoint}`);

    response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
      },
    });

    if (!response.ok) {
      // Try to get error details from response body
      let errorData: { detail?: string } | null;
      try {
        errorData = await response.json();
      } catch {
        errorData = null;
      }

      const errorCategory = categorizeError(response, new Error());
      const error: ApiError = new Error(errorData?.detail || errorCategory.userMessage);
      error.status = response.status;
      error.category = errorCategory.type;
      error.responseData = errorData;

      logApiError(method, endpoint, error, errorData);
      throw error;
    }

    const data = (await response.json()) as T;
    console.log(`API Response: ${method} ${endpoint} - Success`);
    return data;
  } catch (err) {
    const error = err as ApiError;
    // If error wasn't thrown by our code above, it's a network error
    if (!error.category) {
      const errorCategory = categorizeError(null, error);
      error.category = errorCategory.type;
      error.message = errorCategory.userMessage;
      logApiError(method, endpoint, error);
    }
    throw error;
  }
}

// Upload audio file
export async function uploadAudio(
  file: File,
  model: string | null = null,
  language: string | null = null
): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  if (model) {
    formData.append('model', model);
  }
  if (language) {
    formData.append('language', language);
  }

  // Reuse the shared apiCall for error categorization + logging. The browser
  // sets the multipart Content-Type (with boundary) automatically for FormData.
  return await apiCall<UploadResponse>('/jobs', {
    method: 'POST',
    body: formData,
  });
}

// Get all jobs
export async function getJobs(): Promise<JobsResponse> {
  return await apiCall<JobsResponse>('/jobs');
}

// Get job status by UUID
export async function getJobStatus(uuid: string): Promise<JobStatus> {
  return await apiCall<JobStatus>(`/jobs/${uuid}`);
}

// Get transcript
export async function getTranscript(uuid: string): Promise<Transcript> {
  return await apiCall<Transcript>(`/jobs/${uuid}/transcripts`);
}

// Get downsampled waveform peaks for a time range, for the split-segment scrubber
export async function getWaveformPeaks(
  uuid: string,
  start: number,
  end: number,
  buckets = 100
): Promise<WaveformResponse> {
  const params = new URLSearchParams({
    start: String(start),
    end: String(end),
    buckets: String(buckets),
  });
  return await apiCall<WaveformResponse>(`/jobs/${uuid}/waveform?${params}`);
}

// Update speaker names
export async function updateSpeakers(uuid: string, mapping: SpeakerMapping): Promise<unknown> {
  return await apiCall(`/jobs/${uuid}/speakers`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mapping }),
  });
}

// Update transcript content
export async function updateTranscript(
  uuid: string,
  transcript: TranscriptSegment[]
): Promise<unknown> {
  return await apiCall(`/jobs/${uuid}/transcripts`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ transcript }),
  });
}

// Translate transcript segments into European Portuguese (the only target).
// `start`/`limit` select a range, so long transcripts can be translated in
// blocks that each stay inside the LLM and proxy timeouts.
export async function translateTranscript(
  uuid: string,
  start = 0,
  limit?: number
): Promise<TranslateResponse> {
  return await apiCall<TranslateResponse>(`/jobs/${uuid}/transcripts/translate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ target_language: 'pt', start, limit }),
  });
}

// Update summary content
export async function updateSummary(uuid: string, summary: string): Promise<unknown> {
  return await apiCall(`/jobs/${uuid}/summaries`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ summary }),
  });
}

// Generate summary
export async function generateSummary(
  uuid: string,
  customPrompt: string | null = null
): Promise<Summary> {
  const body = customPrompt ? { custom_prompt: customPrompt } : {};

  return await apiCall<Summary>(`/jobs/${uuid}/summaries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

interface DownloadResult {
  success: boolean;
}

// Trigger a browser download for a blob returned by an export endpoint
function triggerBlobDownload(blob: Blob, filename: string): void {
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(downloadUrl);
}

// Download Markdown (Summary + Transcript)
export async function downloadMarkdown(
  uuid: string,
  originalFilename: string | null | undefined
): Promise<DownloadResult> {
  try {
    const url = `${API_BASE_URL}/jobs/${uuid}/exports/markdown`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const blob = await response.blob();
    triggerBlobDownload(blob, generateMarkdownFilename(originalFilename));

    return { success: true };
  } catch (error) {
    console.error('Markdown Download Error:', error);
    throw error;
  }
}

// Download Transcript Markdown (transcript only, no AI summary)
export async function downloadTranscriptMarkdown(
  uuid: string,
  originalFilename: string | null | undefined
): Promise<DownloadResult> {
  try {
    const url = `${API_BASE_URL}/jobs/${uuid}/exports/transcript/markdown`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const blob = await response.blob();
    triggerBlobDownload(blob, generateTranscriptMarkdownFilename(originalFilename));

    return { success: true };
  } catch (error) {
    console.error('Transcript Markdown Download Error:', error);
    throw error;
  }
}

// Download Transcript Word document (transcript only, no AI summary)
export async function downloadTranscriptDocx(
  uuid: string,
  originalFilename: string | null | undefined
): Promise<DownloadResult> {
  try {
    const url = `${API_BASE_URL}/jobs/${uuid}/exports/transcript/docx`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const blob = await response.blob();
    triggerBlobDownload(blob, generateTranscriptDocxFilename(originalFilename));

    return { success: true };
  } catch (error) {
    console.error('Transcript DOCX Download Error:', error);
    throw error;
  }
}

// Delete job
export async function deleteJob(uuid: string): Promise<unknown> {
  return await apiCall(`/jobs/${uuid}`, {
    method: 'DELETE',
  });
}

// Health check
export async function healthCheck(): Promise<unknown> {
  return await apiCall('/health');
}

// Detected hardware + resolved ML configuration
export async function getSystemInfo(): Promise<SystemInfo> {
  return await apiCall<SystemInfo>('/system');
}

// Non-sensitive runtime settings the upload screen needs (set in the admin panel).
export async function getPublicConfig(): Promise<{ default_language: string | null }> {
  return await apiCall<{ default_language: string | null }>('/config');
}

// ============================================================================
// New Workflow Step APIs
// ============================================================================

// Start transcription step. With no model, the backend uses the model of its
// configured hardware profile (or WHISPER_MODEL_NAME).
export async function startTranscription(
  uuid: string,
  model: string | null = null,
  language: string | null = null
): Promise<unknown> {
  const params = new URLSearchParams();
  if (model) {
    params.append('model_name', model);
  }
  if (language) {
    params.append('language', language);
  }
  const query = params.toString();
  return await apiCall(`/jobs/${uuid}/transcriptions${query ? `?${query}` : ''}`, {
    method: 'POST',
  });
}

// Start diarization step
export async function startDiarization(uuid: string): Promise<unknown> {
  return await apiCall(`/jobs/${uuid}/diarizations`, {
    method: 'POST',
  });
}

// Start alignment step
export async function startAlignment(uuid: string): Promise<unknown> {
  return await apiCall(`/jobs/${uuid}/alignments`, {
    method: 'POST',
  });
}

// Get audio stream URL for a job
export function getAudioUrl(uuid: string): string {
  return `${API_BASE_URL}/jobs/${uuid}/audio`;
}
