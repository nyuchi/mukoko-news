import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SourcesPage from "../page";

// Mock Next.js modules
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// Mock SourceIcon — render a generic icon, NOT the source name (avoids duplicate text)
vi.mock("@/components/ui/source-icon", () => ({
  SourceIcon: () => <span data-testid="source-icon" />,
}));

// Mock ErrorBoundary to pass through
vi.mock("@/components/ui/error-boundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock Skeleton
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div className={className} data-testid="skeleton" />
  ),
}));

// Mock server action
const mockGetSourcesAction = vi.fn();
vi.mock("@/lib/actions/feed", () => ({
  getSourcesAction: (...args: unknown[]) => mockGetSourcesAction(...args),
}));

const defaultSources = [
  {
    id: "src-1",
    name: "Daily Maverick",
    url: "https://dailymaverick.co.za/rss",
    category: "general",
    country_id: "ZA",
    fetch_count: 100,
    error_count: 2,
    article_count: 719,
    latest_article_at: "2026-02-12T09:30:00Z",
  },
  {
    id: "src-2",
    name: "The Herald",
    url: "https://herald.co.zw/feed",
    category: "general",
    country_id: "ZW",
    fetch_count: 80,
    error_count: 1,
    article_count: 245,
    latest_article_at: "2026-02-12T07:15:00Z",
  },
  {
    id: "src-3",
    name: "Broken Source",
    url: "https://broken.example.com/rss",
    category: "politics",
    country_id: "KE",
    fetch_count: 50,
    error_count: 40,
    article_count: 0,
  },
  {
    id: "src-4",
    name: "Egypt Independent",
    url: "https://egyptindependent.com/feed",
    category: "general",
    country_id: "EG",
    fetch_count: 90,
    error_count: 5,
    article_count: 391,
    latest_article_at: "2026-02-12T10:45:00Z",
  },
];

describe("SourcesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSourcesAction.mockResolvedValue(defaultSources);
  });

  it("should render page header and stats after loading", async () => {
    render(<SourcesPage />);
    await waitFor(() => {
      expect(screen.getByText("News Sources")).toBeInTheDocument();
    });
    expect(screen.getByText("Total Sources")).toBeInTheDocument();
    expect(screen.getByText("Actively Publishing")).toBeInTheDocument();
    expect(screen.getByText("Total Articles")).toBeInTheDocument();
    expect(screen.getByText("Fetch Issues")).toBeInTheDocument();
  });

  it("should display correct total articles stat", async () => {
    render(<SourcesPage />);
    await waitFor(() => {
      expect(screen.getByText("1,355")).toBeInTheDocument();
    });
  });

  it("should render all source names", async () => {
    render(<SourcesPage />);
    await waitFor(() => {
      expect(screen.getByText("Daily Maverick")).toBeInTheDocument();
    });
    expect(screen.getByText("The Herald")).toBeInTheDocument();
    expect(screen.getByText("Broken Source")).toBeInTheDocument();
    expect(screen.getByText("Egypt Independent")).toBeInTheDocument();
  });

  it("should filter sources by search query", async () => {
    render(<SourcesPage />);
    await waitFor(() => {
      expect(screen.getByText("Daily Maverick")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText("Search sources..."), {
      target: { value: "herald" },
    });

    expect(screen.getByText("The Herald")).toBeInTheDocument();
    expect(screen.queryByText("Daily Maverick")).not.toBeInTheDocument();
  });

  it("should filter sources by country", async () => {
    render(<SourcesPage />);
    await waitFor(() => {
      expect(screen.getByText("Daily Maverick")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByDisplayValue("All Countries"), {
      target: { value: "ZW" },
    });

    expect(screen.getByText("The Herald")).toBeInTheDocument();
    expect(screen.queryByText("Daily Maverick")).not.toBeInTheDocument();
  });

  it("should show Back to Discover link", async () => {
    render(<SourcesPage />);
    await waitFor(() => {
      expect(screen.getByText("News Sources")).toBeInTheDocument();
    });
    expect(screen.getByText("Back to Discover").closest("a")).toHaveAttribute(
      "href",
      "/discover"
    );
  });

  it("should sort by name when selected", async () => {
    render(<SourcesPage />);
    await waitFor(() => {
      expect(screen.getByText("Daily Maverick")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByDisplayValue("Most Articles"), {
      target: { value: "name" },
    });

    const sourceLinks = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href")?.startsWith("/discover?source="));
    expect(sourceLinks[0]).toHaveTextContent("Broken Source");
  });

  it("should show empty state when filters exclude everything", async () => {
    render(<SourcesPage />);
    await waitFor(() => {
      expect(screen.getByText("Daily Maverick")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText("Search sources..."), {
      target: { value: "nonexistent-xyz" },
    });

    expect(screen.getByText("No sources match your filters.")).toBeInTheDocument();
  });

  it("should show skeleton while loading", () => {
    mockGetSourcesAction.mockReturnValue(new Promise(() => {}));
    render(<SourcesPage />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("should link source to discover page with source filter", async () => {
    render(<SourcesPage />);
    await waitFor(() => {
      expect(screen.getByText("Daily Maverick")).toBeInTheDocument();
    });
    expect(screen.getByText("Daily Maverick").closest("a")).toHaveAttribute(
      "href",
      "/discover?source=Daily%20Maverick"
    );
  });

  it("should show country flags for sources", async () => {
    render(<SourcesPage />);
    await waitFor(() => {
      expect(screen.getByText("Daily Maverick")).toBeInTheDocument();
    });
    expect(screen.getByTitle("South Africa")).toBeInTheDocument();
    expect(screen.getByTitle("Zimbabwe")).toBeInTheDocument();
    expect(screen.getByTitle("Egypt")).toBeInTheDocument();
  });

  it("should show error banner and zero stats when API fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetSourcesAction.mockRejectedValue(new Error("Network error"));
    render(<SourcesPage />);
    await waitFor(() => {
      expect(screen.getByText("News Sources")).toBeInTheDocument();
    });
    expect(screen.getByText("Unable to load sources. Please try again later.")).toBeInTheDocument();
    expect(screen.getByText("0 sources aggregating 0 articles across Africa.")).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it("should have accessible search input label", async () => {
    render(<SourcesPage />);
    await waitFor(() => {
      expect(screen.getByText("News Sources")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Search sources by name, URL, or category")).toBeInTheDocument();
  });
});
