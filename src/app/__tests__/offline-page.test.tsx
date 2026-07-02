import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import OfflinePage from '@/app/offline/page';

describe('OfflinePage', () => {
  it('renders the offline message and a link back to the feed', () => {
    render(<OfflinePage />);

    expect(screen.getByRole('heading', { name: /you.re offline/i })).toBeInTheDocument();
    expect(screen.getByText(/previously read articles are still available/i)).toBeInTheDocument();

    const backLink = screen.getByRole('link', { name: /back to the feed/i });
    expect(backLink).toHaveAttribute('href', '/');
  });
});
