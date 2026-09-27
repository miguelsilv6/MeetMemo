import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProjectsView from './ProjectsView';
import * as projectsApi from '../../services/projectsApi';
import type { ProjectSummary } from '../../types/projects';

vi.mock('../../services/projectsApi', () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
}));

const inFiveDays = new Date(Date.now() + 5 * 24 * 3600 * 1000 - 60_000).toISOString();

const project: ProjectSummary = {
  uuid: 'p1',
  name: 'Inquiry 12',
  reference: 'NUIPC 1/26',
  description: null,
  created_at: '2026-09-27T10:00:00Z',
  expires_at: inFiveDays,
  audio_count: 4,
  completed_count: 3,
  error_count: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(projectsApi.listProjects).mockResolvedValue({
    projects: [project],
    retention_days: 7,
  });
});

describe('ProjectsView', () => {
  it('lists projects with their progress, failures and expiry', async () => {
    const onOpen = vi.fn();
    render(<ProjectsView onOpenProject={onOpen} />);

    expect(await screen.findByText('Inquiry 12')).toBeInTheDocument();
    expect(screen.getByText('3 of 4 audios completed')).toBeInTheDocument();
    expect(screen.getByText('1 failed')).toBeInTheDocument();
    expect(screen.getByText('Expires in 5 days')).toBeInTheDocument();
    expect(
      screen.getByText('The project and all its files are deleted automatically after 7 days.')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText('Inquiry 12'));
    expect(onOpen).toHaveBeenCalledWith('p1');
  });

  it('creates a project and opens it', async () => {
    vi.mocked(projectsApi.createProject).mockResolvedValue({ ...project, uuid: 'new' });
    const onOpen = vi.fn();
    render(<ProjectsView onOpenProject={onOpen} />);
    await screen.findByText('Inquiry 12');

    const submit = screen.getByRole('button', { name: /create project/i });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: '  Case 13 ' } });
    fireEvent.change(screen.getByLabelText('Reference'), { target: { value: ' ' } });
    fireEvent.click(submit);

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('new'));
    expect(projectsApi.createProject).toHaveBeenCalledWith({
      name: 'Case 13',
      reference: null,
      description: null,
    });
  });

  it('says when there are no projects', async () => {
    vi.mocked(projectsApi.listProjects).mockResolvedValue({ projects: [], retention_days: 7 });
    render(<ProjectsView onOpenProject={vi.fn()} />);
    expect(await screen.findByText('No projects yet.')).toBeInTheDocument();
  });
});
