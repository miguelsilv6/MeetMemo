import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import CallRecordSection from './CallRecordSection';
import * as api from '../../services/api';
import { CALL_RECORD } from '../../test/callRecordFixture';

vi.mock('../../services/api', () => ({
  getCallRecord: vi.fn(),
  uploadCallRecord: vi.fn(),
  callRecordFileUrl: (uuid: string) => `/api/v1/jobs/${uuid}/call-record/file`,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const row = (container: HTMLElement, label: string) =>
  within(container).getByText(label).closest('div, tr') as HTMLElement;

describe('CallRecordSection', () => {
  it('shows who called whom, when and for how long', async () => {
    vi.mocked(api.getCallRecord).mockResolvedValue(CALL_RECORD);
    render(<CallRecordSection jobId="job1" />);

    const section = await screen.findByTestId('call-record');
    expect(api.getCallRecord).toHaveBeenCalledWith('job1');
    expect(within(row(section, 'From')).getByText('351912052349')).toBeInTheDocument();
    expect(within(row(section, 'To')).getByText('+351915592482')).toBeInTheDocument();
    expect(within(row(section, 'Start')).getByText('17-11-2026 20:31:50')).toBeInTheDocument();
    expect(within(row(section, 'Duration')).getByText('0:58')).toBeInTheDocument();
    expect(
      within(row(section, 'Answered at')).getByText('17-11-2026 20:32:10')
    ).toBeInTheDocument();
    // The case and the target are kept for the details.
    expect(within(section).queryByText('00000-25.0JGLSB')).toBeNull();
    expect(within(section).queryByText(/does not match/)).toBeNull();
  });

  it('opens every detail: fields, participants, cells, events, all fields and origin', async () => {
    vi.mocked(api.getCallRecord).mockResolvedValue({
      ...CALL_RECORD,
      history: [
        {
          source_name: 'old.xml',
          sha256: 'b'.repeat(64),
          imported_by: 'ana',
          imported_at: '2026-11-25T10:00:00Z',
          replaced_by: 'admin',
          replaced_at: '2026-11-26T15:00:00Z',
        },
      ],
    });
    render(<CallRecordSection jobId="job1" />);

    fireEvent.click(await screen.findByRole('button', { name: /See all the data/ }));
    const details = await screen.findByTestId('call-record-details');
    expect(within(row(details, 'Case')).getByText('00000-25.0JGLSB')).toBeInTheDocument();
    expect(within(row(details, 'Interception ID')).getByText('147277040')).toBeInTheDocument();
    for (const group of ['Participants', 'Cells', 'Events']) {
      expect(within(details).getByText(group)).toBeInTheDocument();
    }
    expect(within(details).getByText('-9.32859')).toBeInTheDocument();
    expect(within(details).getByText('Coordenada X da célula')).toBeInTheDocument();
    expect(within(details).getByText('Every field of the file (5)')).toBeInTheDocument();
    expect(within(details).getByText('Caminho do produto')).toBeInTheDocument();
    expect(within(details).getByText('a'.repeat(64))).toBeInTheDocument();
    expect(within(details).getByText(/Replaced old\.xml .*by admin/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Download the original XML/ })).toHaveAttribute(
      'href',
      '/api/v1/jobs/job1/call-record/file'
    );
  });

  it('warns when the file is not this audio’s', async () => {
    vi.mocked(api.getCallRecord).mockResolvedValue({ ...CALL_RECORD, guid_matches_audio: false });
    render(<CallRecordSection jobId="job1" />);

    expect(await screen.findByText(/does not match this audio/)).toBeInTheDocument();
  });

  it('imports one for an audio that has none', async () => {
    vi.mocked(api.getCallRecord).mockResolvedValue(null);
    vi.mocked(api.uploadCallRecord).mockResolvedValue(CALL_RECORD);
    render(<CallRecordSection jobId="job1" />);

    expect(await screen.findByText('No call data.')).toBeInTheDocument();
    const xml = new File(['<Produto/>'], 'TranslatedPRI.xml', { type: 'application/xml' });
    fireEvent.change(screen.getByLabelText('Attach TranslatedPRI.xml'), {
      target: { files: [xml] },
    });

    expect(await screen.findByText('351912052349')).toBeInTheDocument();
    expect(api.uploadCallRecord).toHaveBeenCalledWith('job1', xml);
  });

  it('says why a file was refused and keeps what it had', async () => {
    vi.mocked(api.getCallRecord).mockResolvedValue(null);
    vi.mocked(api.uploadCallRecord).mockRejectedValue(
      new Error('Not a TranslatedPRI.xml: its root is <Product>, not <Produto>')
    );
    render(<CallRecordSection jobId="job1" />);
    await screen.findByText('No call data.');

    fireEvent.change(screen.getByLabelText('Attach TranslatedPRI.xml'), {
      target: { files: [new File(['<Product/>'], 'x.xml')] },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(/its root is <Product>/);
    expect(screen.getByText('No call data.')).toBeInTheDocument();
  });
});
