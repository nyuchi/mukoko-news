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

// Mock API — wrapper function avoids vi.mock hoisting issue
const mockGetArticles = vi.fn();
const mockGetCategories = vi.fn();
const mockGetSources = vi.fn();
const mockGetKeywords = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    getArticles: (...args: unknown[]) => mockGetArticles(...args),
    getCategories: (...args: unknown[]) => mockGetCategories(...args),
    getSources: (...args: unknown[]) => mockGetSources(...args),
    getKeywords: (...args: unknown[]) => mockGetKeywords(...args),
  },
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

  mockGetCategories.mockResolvedValue({
    categories: [
      { id: "politics", name: "Politics", slug: "politics", article_count: 120 },
      { id: "economy", name: "Economy", slug: "economy", article_count: 80 },
    ],
  });

  mockGetSources.mockResolvedValue({
    sources: [
      { id: "src-1", name: "Daily Maverick", country_id: "ZA", article_count: 719 },
      { id: "src-2", name: "The Herald", country_id: "ZW", article_count: 245 },
      { id: "src-3", name: "Empty Source", country_id: "KE", article_count: 0 },
    ],
    total: 3,
  });

  mockGetKeywords.mockResolvedValue({
    keywords: [
      { id: "kw-1", name: "Climate", slug: "climate", type: "topic", article_count: 500 },
      { id: "kw-2", name: "Elections", slug: "elections", type: "topic", article_count: 200 },
      { id: "kw-3", name: "AI", slug: "ai", type: "topic", article_count: 3000 },
      { id: "kw-4", name: "Health", slug: "health", type: "topic", article_count: 100 },
      { id: "kw-5", name: "Mining", slug: "mining", type: "topic", article_count: 50 },
    ],
    total: 5,
  });
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

describe("DiscoverPage - Tag Cloud", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it("should render trending topics section with all keywords", async () => {
    render(<DiscoverPage />);
    await waitFor(() => {
      expect(screen.getByText("Trending Topics")).toBeInTheDocument();
    });
    expect(screen.getByText("Climate")).toBeInTheDocument();
    expect(screen.getByText("Elections")).toBeInTheDocument();
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText("Mining")).toBeInTheDocument();
  });

  it("should link keywords to search page", async () => {
    render(<DiscoverPage />);
    await waitFor(() => {
      expect(screen.getByText("AI")).toBeInTheDocument();
    });
    expect(screen.getByText("AI").closest("a")).toHaveAttribute(
      "href",
      "/search?q=AI"
    );
    expect(screen.getByText("Climate").closest("a")).toHaveAttribute(
      "href",
      "/search?q=Climate"
    );
  });

  it("should use logarithmic scaling — outlier should not dominate", async () => {
    render(<DiscoverPage />);
    await waitFor(() => {
      expect(screen.getByText("AI")).toBeInTheDocument();
    });

    const aiTag = screen.getByText("AI");
    const miningTag = screen.getByText("Mining");

    const aiFontSize = parseFloat(aiTag.style.fontSize);
    const miningFontSize = parseFloat(miningTag.style.fontSize);

    // AI has 3000 articles, Mining has 50 — 60x difference in raw count
    // With log scaling, font size ratio should be well under 3x
    const ratio = aiFontSize / miningFontSize;
    expect(ratio).toBeLessThan(3);
    expect(ratio).toBeGreaterThan(1);
  });

  it("should give higher font weight to popular keywords", async () => {
    render(<DiscoverPage />);
    await waitFor(() => {
      expect(screen.getByText("AI")).toBeInTheDocument();
    });

    const aiWeight = parseInt(screen.getByText("AI").style.fontWeight);
    const miningWeight = parseInt(screen.getByText("Mining").style.fontWeight);
    expect(aiWeight).toBeGreaterThanOrEqual(miningWeight);
  });

  it("should use em-based padding that scales with font size", async () => {
    render(<DiscoverPage />);
    await waitFor(() => {
      expect(screen.getByText("AI")).toBeInTheDocument();
    });
    expect(screen.getByText("AI").style.padding).toMatch(/em/);
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
    mockGetSources.mockResolvedValueOnce({
      sources: [{ id: "e", name: "Empty", article_count: 0 }],
      total: 1,
    });

    render(<DiscoverPage />);
    await waitFor(() => {
      expect(screen.getByText("Latest News")).toBeInTheDocument();
    });
    expect(screen.queryByText("Browse by Source")).not.toBeInTheDocument();
  });
});
