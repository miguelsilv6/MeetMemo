// Client for the projects API.

import { apiCall } from './api';
import type {
  Project,
  ProjectDetail,
  ProjectDetails,
  ProjectListResponse,
  UploadResult,
} from '../types/projects';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function listProjects(): Promise<ProjectListResponse> {
  return apiCall<ProjectListResponse>('/projects');
}

export async function createProject(details: ProjectDetails): Promise<Project> {
  return apiCall<Project>('/projects', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(details),
  });
}

export async function getProject(uuid: string): Promise<ProjectDetail> {
  return apiCall<ProjectDetail>(`/projects/${uuid}`);
}

export async function updateProject(uuid: string, details: ProjectDetails): Promise<Project> {
  return apiCall<Project>(`/projects/${uuid}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(details),
  });
}

export async function deleteProject(uuid: string): Promise<void> {
  await apiCall<void>(`/projects/${uuid}`, { method: 'DELETE' });
}

/** Upload audios to a project; each is queued for processing on the server. */
export async function uploadProjectAudios(
  uuid: string,
  files: File[],
  language: string | null
): Promise<UploadResult[]> {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));
  if (language) formData.append('language', language);
  const response = await apiCall<{ results: UploadResult[] }>(`/projects/${uuid}/audios`, {
    method: 'POST',
    body: formData,
  });
  return response.results;
}

export async function retryProjectAudio(uuid: string, audioUuid: string): Promise<void> {
  await apiCall<void>(`/projects/${uuid}/audios/${audioUuid}/retry`, { method: 'POST' });
}

export async function deleteProjectAudio(uuid: string, audioUuid: string): Promise<void> {
  await apiCall<void>(`/projects/${uuid}/audios/${audioUuid}`, { method: 'DELETE' });
}
