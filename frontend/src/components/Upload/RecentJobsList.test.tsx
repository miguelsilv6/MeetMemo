import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import RecentJobsList from './RecentJobsList';
import type { RecentJob } from '../../types/api';
import { formatDateTime } from '../../utils/projectDates';

const jobs: RecentJob[] = [
  { uuid: 'u1', filename: 'standup.mp3', status_code: 200, created_at: '2024-01-01T10:00:00Z' },
  { uuid: 'u2', filename: 'retro.wav', status_code: 202, created_at: '2024-01-02T10:00:00Z' },
];

describe('RecentJobsList', () => {
  it('shows a loading state', () => {
    render(
      <RecentJobsList
        recentJobs={[]}
        loadingJobs
        handleLoadJob={vi.fn()}
        handleDeleteJob={vi.fn()}
        handleViewSummary={vi.fn()}
      />
    );
    expect(screen.getByText(/loading recent transcriptions/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no jobs', () => {
    render(
      <RecentJobsList
        recentJobs={[]}
        loadingJobs={false}
        handleLoadJob={vi.fn()}
        handleDeleteJob={vi.fn()}
        handleViewSummary={vi.fn()}
      />
    );
    expect(screen.getByText(/no recent transcriptions/i)).toBeInTheDocument();
  });

  it('renders each job and loads one when its row is clicked', () => {
    const handleLoadJob = vi.fn();
    render(
      <RecentJobsList
        recentJobs={jobs}
        loadingJobs={false}
        handleLoadJob={handleLoadJob}
        handleDeleteJob={vi.fn()}
        handleViewSummary={vi.fn()}
      />
    );

    expect(screen.getByText('standup.mp3')).toBeInTheDocument();
    expect(screen.getByText('retro.wav')).toBeInTheDocument();

    fireEvent.click(screen.getByText('standup.mp3'));
    expect(handleLoadJob).toHaveBeenCalledWith(jobs[0]);
  });

  it('confirms before deleting a job', async () => {
    const handleDeleteJob = vi.fn().mockResolvedValue(undefined);
    render(
      <RecentJobsList
        recentJobs={jobs}
        loadingJobs={false}
        handleLoadJob={vi.fn()}
        handleDeleteJob={handleDeleteJob}
        handleViewSummary={vi.fn()}
      />
    );

    // Deleting requires confirming in the modal first.
    const standup = screen.getByText('standup.mp3').closest('.list-group-item') as HTMLElement;
    fireEvent.click(within(standup).getByTitle('Delete this communication'));
    expect(screen.getByText('Delete Communication')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(handleDeleteJob).toHaveBeenCalledWith('u1');
  });

  it('does not show a "view summary" button for a job without a summary', () => {
    render(
      <RecentJobsList
        recentJobs={jobs}
        loadingJobs={false}
        handleLoadJob={vi.fn()}
        handleDeleteJob={vi.fn()}
        handleViewSummary={vi.fn()}
      />
    );

    expect(screen.queryByTitle('View AI summary')).not.toBeInTheDocument();
  });

  it('shows a "view summary" button for a job that has one, and it does not also load the job', () => {
    const handleLoadJob = vi.fn();
    const handleViewSummary = vi.fn();
    const jobsWithSummary: RecentJob[] = [{ ...jobs[0], has_summary: true }];
    render(
      <RecentJobsList
        recentJobs={jobsWithSummary}
        loadingJobs={false}
        handleLoadJob={handleLoadJob}
        handleDeleteJob={vi.fn()}
        handleViewSummary={handleViewSummary}
      />
    );

    fireEvent.click(screen.getByTitle('View AI summary'));

    expect(handleViewSummary).toHaveBeenCalledWith(jobsWithSummary[0]);
    expect(handleLoadJob).not.toHaveBeenCalled();
  });

  it('shows when each transcription was imported and the language detected in it', () => {
    render(
      <RecentJobsList
        recentJobs={[
          { ...jobs[0], detected_language: 'en', language_probability: 0.42 },
          { ...jobs[1], detected_language: 'pt', language_probability: 0.9 },
        ]}
        loadingJobs={false}
        handleLoadJob={vi.fn()}
        handleDeleteJob={vi.fn()}
        handleViewSummary={vi.fn()}
      />
    );
    const row = (name: string) => screen.getByText(name).closest('.list-group-item') as HTMLElement;
    expect(row('standup.mp3')).toHaveTextContent(
      `Imported: ${formatDateTime('2024-01-01T10:00:00Z', 'en')}`
    );
    const language = within(row('standup.mp3')).getByTestId('job-language');
    expect(language).toHaveTextContent('English');
    expect(within(language).getByText('42%')).toHaveClass('bg-danger');
    // Still processing: nothing detected to show yet.
    expect(within(row('retro.wav')).getByTestId('job-language')).toHaveTextContent('—');
  });

  it('sorts by import date, remembers the choice, and shows them all on demand', () => {
    localStorage.clear();
    const many: RecentJob[] = Array.from({ length: 7 }, (_, i) => ({
      uuid: `j${i}`,
      filename: `call-${i}.wav`,
      status_code: 200,
      created_at: `2024-01-0${i + 1}T10:00:00Z`,
    }));
    const props = {
      recentJobs: many,
      loadingJobs: false,
      handleLoadJob: vi.fn(),
      handleDeleteJob: vi.fn(),
      handleViewSummary: vi.fn(),
    };
    const names = () => screen.getAllByText(/^call-\d\.wav$/).map((element) => element.textContent);
    const { unmount } = render(<RecentJobsList {...props} />);

    expect(names()).toEqual(['call-6.wav', 'call-5.wav', 'call-4.wav', 'call-3.wav', 'call-2.wav']);
    fireEvent.change(screen.getByLabelText('Sort:'), { target: { value: 'oldest' } });
    expect(names()).toEqual(['call-0.wav', 'call-1.wav', 'call-2.wav', 'call-3.wav', 'call-4.wav']);
    fireEvent.click(screen.getByRole('button', { name: 'Show all (7)' }));
    expect(names()).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(names()).toHaveLength(5);

    unmount();
    render(<RecentJobsList {...props} />);
    expect(screen.getByLabelText('Sort:')).toHaveValue('oldest');
    expect(names()[0]).toBe('call-0.wav');
    localStorage.clear();
  });
});
