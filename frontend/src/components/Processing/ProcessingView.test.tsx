import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProcessingView from './ProcessingView';

describe('ProcessingView', () => {
  it('renders the processing heading and step labels', () => {
    render(<ProcessingView processingProgress={0} />);
    expect(screen.getByText('Processing Your Communication')).toBeInTheDocument();
    expect(screen.getByText(/Transcribing with Whisper AI/)).toBeInTheDocument();
  });

  it('reflects the current progress percentage', () => {
    const { rerender } = render(<ProcessingView processingProgress={45} />);
    expect(screen.getByText('45%')).toBeInTheDocument();

    rerender(<ProcessingView processingProgress={100} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('shows how long it still takes, or that it is being worked out', () => {
    const at = new Date(Date.now() + 5 * 60_000).toISOString();
    const { rerender } = render(
      <ProcessingView processingProgress={20} eta={{ seconds: 300, at }} />
    );
    expect(screen.getByTestId('eta')).toHaveTextContent(/About 5 min left \(done around .+\)/);

    rerender(<ProcessingView processingProgress={20} eta={{ seconds: null, at: null }} />);
    expect(screen.getByTestId('eta')).toHaveTextContent('Working out the time left…');

    rerender(<ProcessingView processingProgress={100} eta={{ seconds: 0, at: null }} />);
    expect(screen.queryByTestId('eta')).not.toBeInTheDocument();
  });
});
