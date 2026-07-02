import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorPage from '../error';
import GlobalError from '../global-error';

describe('root error pages', () => {
  // Suppress React DOM-nesting warnings (global-error renders <html>/<body>)
  // and the components' own console.error reporting during tests.
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('error.tsx', () => {
    it('renders the branded fallback copy', () => {
      render(<ErrorPage error={new Error('boom')} reset={() => {}} />);
      expect(screen.getByText('Something went wrong loading Mukoko News')).toBeInTheDocument();
    });

    it('calls reset() when "Try again" is clicked', () => {
      const reset = vi.fn();
      render(<ErrorPage error={new Error('boom')} reset={reset} />);
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(reset).toHaveBeenCalledOnce();
    });

    it('logs the error for observability', () => {
      const error = new Error('boom');
      render(<ErrorPage error={error} reset={() => {}} />);
      expect(console.error).toHaveBeenCalledWith('[RootError]', error);
    });
  });

  describe('global-error.tsx', () => {
    it('renders the branded fallback copy', () => {
      render(<GlobalError error={new Error('boom')} reset={() => {}} />);
      expect(screen.getByText('Something went wrong loading Mukoko News')).toBeInTheDocument();
    });

    it('calls reset() when "Try again" is clicked', () => {
      const reset = vi.fn();
      render(<GlobalError error={new Error('boom')} reset={reset} />);
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(reset).toHaveBeenCalledOnce();
    });
  });
});
