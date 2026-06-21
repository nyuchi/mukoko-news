import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import DiscoverPage from "../page";

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

vi.mock("@/components/article-card", () => ({
  ArticleCard: ({ article }: { article: { title: string } }) => (
    <div data-testid="article-card">{article.title}</div>
  ),
}));

vi.mock("@/components/ui/error-boundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/discover-skeleton", () => ({
  DiscoverPageSkeleton: () => <div data-testid="loading-skeleton" />,
}));

// Mock server actions
const mockGetArticles = vi.fn();
const mockGetCategories = vi.fn();
const mockGetSources = vi.fn();

vi.mock("@/lib/actions/feed", () => ({
  getArticlesAction: (...args: unknown[]) => mockGetArticles(...args),
  getCategoriesAction: (...args: unknown[]) => mockGetCategories(...args),
  getSourcesAction: (...args: unknown[]) => mockGetSources(...args),
}));

function setupDefaultMocks() {
  mockGetArticles.mockResolvedValue({
    articles: [
      {
        id: "1",
        title: "Test Article 1",
        slug: "test-1",
        source: "Daily Maverick",
        published_at: "2026-02-12T10:00:00Z",
        country_id: "ZA",
      },
      {
        id: "2",
        title: "Test Article 2",
        slug: "test-2",
        source: "The Herald",
        published_at: "2026-02-12T09:00:00Z",
        country_id: "ZW",
      },
    ],
  });

  mockGetCategories.mockResolvedValue([
    { id: "politics", name: "Politics", slug: "politics", article_count: 120 },
    { id: "economy", name: "Economy", slug: "economy", article_count: 80 },
  ]);

  mockGetSources.mockResolvedValue([
    { id: "src-1", name: "Daily Maverick", country_id: "ZA", article_count: 719 },
    { id: "src-2", name: "The Herald", country_id: "ZW", article_count: 245 },
    { id: "src-3", name: "Empty Source", country_id: "KE", article_count: 0 },
  ]);
}

describe("DiscoverPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it("should render the discover page header", async () => {
    render(<DiscoverPage />);
    await waitFor(() => {
      expect(screen.getByText("Discover")).toBeInTheDocument();
    });
  });

  it("should render search bar", async () => {
    render(<DiscoverPage />);
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Search articles, topics, or sources...")
      ).toBeInTheDocument();
    });
  });

  it("should render article cards in latest news section", async () => {
    render(<DiscoverPage />);
    await waitFor(() => {
      expect(screen.getByText("Latest News")).toBeInTheDocument();
    });
    expect(screen.getByText("Test Article 1")).toBeInTheDocument();
    expect(screen.getByText("Test Article 2")).toBeInTheDocument();
  });

  it("should render categories section", async () => {
    render(<DiscoverPage />);
    await waitFor(() => {
      expect(screen.getByText("Browse by Category")).toBeInTheDocument();
    });
    expect(screen.getByText("Politics")).toBeInTheDocument();
    expect(screen.getByText("Economy")).toBeInTheDocument();
  });

  it("should render browse by country section with all countries", async () => {
    render(<DiscoverPage />);
    await waitFor(() => {
      expect(screen.getByText("Browse by Country")).toBeInTheDocument();
    });
    // Countries appear in the country grid section
    const countryLinks = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href")?.startsWith("/discover?country="));
    expect(countryLinks.length).toBe(54); // All 54 AU member states
  });
});

describe("DiscoverPage - Sources Section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it("should only show sources with articles (filters out 0-count)", async () => {
    render(<DiscoverPage />);
    await waitFor(() => {
      expect(screen.getByText("Browse by Source")).toBeInTheDocument();
    });

    const sourceLinks = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href")?.startsWith("/discover?source="));
    // Only Daily Maverick (719) and The Herald (245) — not "Empty Source" (0)
    expect(sourceLinks).toHaveLength(2);
    expect(screen.queryByText("Empty Source")).not.toBeInTheDocument();
  });

  it("should sort sources by article count descending", async () => {
    render(<DiscoverPage />);
    await waitFor(() => {
      expect(screen.getByText("Browse by Source")).toBeInTheDocument();
    });

    const sourceLinks = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href")?.startsWith("/discover?source="));
    expect(sourceLinks[0]).toHaveTextContent("Daily Maverick");
    expect(sourceLinks[1]).toHaveTextContent("The Herald");
  });

  it("should link to /sources page via View All", async () => {
    render(<DiscoverPage />);
    await waitFor(() => {
      expect(screen.getByText("Browse by Source")).toBeInTheDocument();
    });

    const viewAllLinks = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href") === "/sources");
    expect(viewAllLinks.length).toBeGreaterThan(0);
  });

  it("should not render sources section when all sources have 0 articles", async () => {
    mockGetSources.mockResolvedValueOnce([
      { id: "e", name: "Empty", article_count: 0 },
    ]);

    render(<DiscoverPage />);
    await waitFor(() => {
      expect(screen.getByText("Latest News")).toBeInTheDocument();
    });
    expect(screen.queryByText("Browse by Source")).not.toBeInTheDocument();
  });
});
