/**
 * Tests for ShareModal component
 * Tests rendering, share options, copy link, escape key handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ShareModal } from '../share-modal';
import type { Article } from '@/lib/api';

// Mock article for testing
const mockArticle: Article = {
  id: '123',
  slug: 'test-article-title',
  headline: 'Test Article Title',
  publisher_name: 'Test Source',
  description: 'Test description',
  date_published: '2024-01-15T10:00:00Z',
};

describe('ShareModal', () => {
  let originalClipboard: Clipboard;
  let originalShare: Navigator['share'];
  let mockOpen: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Store originals
    originalClipboard = navigator.clipboard;
    originalShare = navigator.share;

    // Mock window.open
    mockOpen = vi.fn();
    vi.stubGlobal('open', mockOpen);

    // Mock clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
      configurable: true,
    });

    // Mock window.location.origin
    Object.defineProperty(window, 'location', {
      value: {
        origin: 'https://news.mukoko.com',
      },
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('rendering', () => {
    it('should not render when isOpen is false', () => {
      render(<ShareModal article={mockArticle} isOpen={false} onClose={() => {}} />);

      expect(screen.queryByText('Share Article')).not.toBeInTheDocument();
    });

    it('should not render when article is null', () => {
      render(<ShareModal article={null} isOpen={true} onClose={() => {}} />);

      expect(screen.queryByText('Share Article')).not.toBeInTheDocument();
    });

    it('should render when isOpen and article provided', () => {
      render(<ShareModal article={mockArticle} isOpen={true} onClose={() => {}} />);

      expect(screen.getByText('Share Article')).toBeInTheDocument();
      expect(screen.getByText('Test Article Title')).toBeInTheDocument();
      expect(screen.getByText('Test Source')).toBeInTheDocument();
    });

    it('should render all share options', () => {
      render(<ShareModal article={mockArticle} isOpen={true} onClose={() => {}} />);

      expect(screen.getByText('Twitter')).toBeInTheDocument();
      expect(screen.getByText('Facebook')).toBeInTheDocument();
      expect(screen.getByText('WhatsApp')).toBeInTheDocument();
      expect(screen.getByText('LinkedIn')).toBeInTheDocument();
      expect(screen.getByText('Copy Link')).toBeInTheDocument();
    });
  });

  describe('close behavior', () => {
    it('should call onClose when close button clicked', () => {
      const onClose = vi.fn();
      render(<ShareModal article={mockArticle} isOpen={true} onClose={onClose} />);

      // Find the X button (close button)
      const closeButton = screen.getByRole('button', { name: '' });
      fireEvent.click(closeButton);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when backdrop clicked', () => {
      const onClose = vi.fn();
      const { container } = render(
        <ShareModal article={mockArticle} isOpen={true} onClose={onClose} />
      );

      // Click backdrop (first absolute div)
      const backdrop = container.querySelector('.bg-black\\/60');
      if (backdrop) fireEvent.click(backdrop);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should call onClose when Escape key pressed', () => {
      const onClose = vi.fn();
      render(<ShareModal article={mockArticle} isOpen={true} onClose={onClose} />);

      fireEvent.keyDown(window, { key: 'Escape' });

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should not listen for Escape when modal is closed', () => {
      const onClose = vi.fn();
      render(<ShareModal article={mockArticle} isOpen={false} onClose={onClose} />);

      fireEvent.keyDown(window, { key: 'Escape' });

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('copy link', () => {
    it('should copy link to clipboard when Copy Link clicked', async () => {
      const onClose = vi.fn();
      render(<ShareModal article={mockArticle} isOpen={true} onClose={onClose} />);

      const copyButton = screen.getByText('Copy Link');
      await act(async () => {
        fireEvent.click(copyButton);
      });

      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
          'https://news.mukoko.com/article/123'
        );
      });
    });

    it('should show Copied! feedback after copying', async () => {
      const onClose = vi.fn();
      render(<ShareModal article={mockArticle} isOpen={true} onClose={onClose} />);

      const copyButton = screen.getByText('Copy Link');
      await act(async () => {
        fireEvent.click(copyButton);
      });

      await waitFor(() => {
        expect(screen.getByText('Copied!')).toBeInTheDocument();
      });
    });

    it('should handle clipboard error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Clipboard error'));

      render(<ShareModal article={mockArticle} isOpen={true} onClose={() => {}} />);

      const copyButton = screen.getByText('Copy Link');
      await act(async () => {
        fireEvent.click(copyButton);
      });

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalled();
      });

      consoleSpy.mockRestore();
    });
  });

  describe('social share buttons', () => {
    it('should open Twitter share URL', () => {
      const onClose = vi.fn();
      render(<ShareModal article={mockArticle} isOpen={true} onClose={onClose} />);

      fireEvent.click(screen.getByText('Twitter'));

      expect(mockOpen).toHaveBeenCalledWith(
        expect.stringContaining('twitter.com/intent/tweet'),
        '_blank',
        'width=600,height=400'
      );
      expect(onClose).toHaveBeenCalled();
    });

    it('should open Facebook share URL', () => {
      const onClose = vi.fn();
      render(<ShareModal article={mockArticle} isOpen={true} onClose={onClose} />);

      fireEvent.click(screen.getByText('Facebook'));

      expect(mockOpen).toHaveBeenCalledWith(
        expect.stringContaining('facebook.com/sharer/sharer.php'),
        '_blank',
        'width=600,height=400'
      );
      expect(onClose).toHaveBeenCalled();
    });

    it('should open WhatsApp share URL', () => {
      const onClose = vi.fn();
      render(<ShareModal article={mockArticle} isOpen={true} onClose={onClose} />);

      fireEvent.click(screen.getByText('WhatsApp'));

      expect(mockOpen).toHaveBeenCalledWith(
        expect.stringContaining('wa.me'),
        '_blank'
      );
      expect(onClose).toHaveBeenCalled();
    });

    it('should open LinkedIn share URL', () => {
      const onClose = vi.fn();
      render(<ShareModal article={mockArticle} isOpen={true} onClose={onClose} />);

      fireEvent.click(screen.getByText('LinkedIn'));

      expect(mockOpen).toHaveBeenCalledWith(
        expect.stringContaining('linkedin.com/sharing/share-offsite'),
        '_blank',
        'width=600,height=400'
      );
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('native share', () => {
    it('should show More Options button when navigator.share is available', () => {
      Object.defineProperty(navigator, 'share', {
        value: vi.fn().mockResolvedValue(undefined),
        writable: true,
        configurable: true,
      });

      render(<ShareModal article={mockArticle} isOpen={true} onClose={() => {}} />);

      expect(screen.getByText('More Options')).toBeInTheDocument();
    });

    it('should call navigator.share when More Options clicked', async () => {
      const mockShare = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'share', {
        value: mockShare,
        writable: true,
        configurable: true,
      });

      const onClose = vi.fn();
      render(<ShareModal article={mockArticle} isOpen={true} onClose={onClose} />);

      await act(async () => {
        fireEvent.click(screen.getByText('More Options'));
      });

      await waitFor(() => {
        expect(mockShare).toHaveBeenCalledWith({
          title: 'Test Article Title',
          text: 'Test Article Title\n\nRead on Mukoko News',
          url: 'https://news.mukoko.com/article/123',
        });
      });
    });
  });

  describe('state reset', () => {
    it('should reset copied state when modal closes', async () => {
      const { rerender } = render(
        <ShareModal article={mockArticle} isOpen={true} onClose={() => {}} />
      );

      // Copy link
      await act(async () => {
        fireEvent.click(screen.getByText('Copy Link'));
      });

      await waitFor(() => {
        expect(screen.getByText('Copied!')).toBeInTheDocument();
      });

      // Close and reopen modal - the useEffect should reset copied state
      rerender(<ShareModal article={mockArticle} isOpen={false} onClose={() => {}} />);
      rerender(<ShareModal article={mockArticle} isOpen={true} onClose={() => {}} />);

      // Should show Copy Link again, not Copied!
      await waitFor(() => {
        expect(screen.getByText('Copy Link')).toBeInTheDocument();
      });
    });
  });
});
