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

// The directory reads `useAuth()` to decide whether to show Mukoko's own record
// of each source (feed last read, delivering since, country provenance). Mocked
// at the components entry point like every other suite that gates on a session —
// importing it for real drags in the AuthKit server module and `next/cache`.
const mockUseAuth = vi.fn(() => ({ user: null, loading: false }));
vi.mock("@workos-inc/authkit-nextjs/components", () => ({
  useAuth: () => mockUseAuth(),
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
const mockGetSourceAuthorsAction = vi.fn();
vi.mock("@/lib/actions/feed", () => ({
  getSourcesAction: (...args: unknown[]) => mockGetSourcesAction(...args),
  getSourceAuthorsAction: (...args: unknown[]) => mockGetSourceAuthorsAction(...args),
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
    mockGetSourceAuthorsAction.mockResolvedValue([]);
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


describe("source directory filters: country, newsroom, author", () => {
  /**
   * The three levels these filters cut across:
   *
   *   publisher / entity   the publishing house
   *     └── newsroom       the masthead
   *           └── source   the feed endpoint
   *
   * Zimpapers runs The Herald and Chronicle Zimbabwe; The Herald is delivered
   * by two feeds. So filtering by newsroom is not the same as filtering by
   * source, and the fixture below is built to make a filter that confused them
   * visibly wrong.
   */
  const NEWSROOM_SOURCES = [
    {
      id: "src-herald-main",
      name: "The Herald",
      url: "https://herald.co.zw/feed",
      country_id: "ZW",
      article_count: 900,
      newsroom_id: "org-herald-zw",
      newsroom_name: "The Herald",
    },
    {
      id: "src-herald-alt",
      name: "The Herald (secondary)",
      url: "https://herald.co.zw/rss",
      country_id: "ZW",
      article_count: 120,
      newsroom_id: "org-herald-zw",
      newsroom_name: "The Herald",
    },
    {
      id: "src-chronicle",
      name: "Chronicle Zimbabwe",
      url: "https://chronicle.co.zw/feed",
      country_id: "ZW",
      article_count: 400,
      newsroom_id: "org-chronicle-zw",
      newsroom_name: "Chronicle Zimbabwe",
    },
    {
      id: "src-nation",
      name: "Daily Nation",
      url: "https://nation.africa/feed",
      country_id: "KE",
      article_count: 700,
      newsroom_id: "org-nation-ke",
      newsroom_name: "Daily Nation",
    },
  ];

  const AUTHORS = [
    { name: "Tendai Moyo", articleCount: 42, sourceIds: ["src-herald-main", "src-chronicle"] },
    { name: "Wanjiku Kamau", articleCount: 31, sourceIds: ["src-nation"] },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSourcesAction.mockResolvedValue(NEWSROOM_SOURCES);
    mockGetSourceAuthorsAction.mockResolvedValue(AUTHORS);
  });

  /**
   * The names of the source ROWS currently listed.
   *
   * Scoped to links rather than bare text because a newsroom name now appears
   * twice on the page — once as a row and once as an <option> in the newsroom
   * select. `getByText` matches both, so an assertion written that way would
   * pass on a filter that changed nothing but left the option in the dropdown.
   */
  function rowNames(): string[] {
    return screen
      .getAllByRole("link")
      .map((el) => el.textContent?.trim() ?? "")
      .filter((t) => NEWSROOM_SOURCES.some((s) => s.name === t));
  }

  async function renderPage() {
    render(<SourcesPage />);
    await waitFor(() => expect(rowNames()).toContain("The Herald"));
  }

  it("filters to one newsroom, keeping BOTH of its feeds", async () => {
    // The distinction the filter exists for. The Herald has two endpoints;
    // selecting the newsroom must keep both, not collapse to one row and not
    // behave like a source filter.
    await renderPage();
    fireEvent.change(screen.getByLabelText("Filter sources by newsroom"), {
      target: { value: "org-herald-zw" },
    });

    expect(rowNames()).toEqual(
      expect.arrayContaining(["The Herald", "The Herald (secondary)"])
    );
    expect(rowNames()).not.toContain("Chronicle Zimbabwe");
    expect(rowNames()).not.toContain("Daily Nation");
  });

  it("narrows the newsroom list to the chosen country", async () => {
    // 537 mastheads in one select is a scroll, not a control.
    await renderPage();
    fireEvent.change(screen.getByLabelText("Filter sources by country"), {
      target: { value: "ZW" },
    });

    const newsroomSelect = screen.getByLabelText("Filter sources by newsroom");
    expect(newsroomSelect).toHaveTextContent("The Herald");
    expect(newsroomSelect).not.toHaveTextContent("Daily Nation");
  });

  it("clears a newsroom selection the new country cannot contain", async () => {
    // Otherwise the page filters to a newsroom the country select says is not
    // there, and shows an empty directory with two filters that each look fine.
    await renderPage();
    fireEvent.change(screen.getByLabelText("Filter sources by newsroom"), {
      target: { value: "org-nation-ke" },
    });
    expect(rowNames()).toContain("Daily Nation");

    fireEvent.change(screen.getByLabelText("Filter sources by country"), {
      target: { value: "ZW" },
    });

    await waitFor(() => expect(rowNames()).toContain("The Herald"));
    expect(rowNames()).toContain("Chronicle Zimbabwe");
  });

  it("filters to the sources an author actually files to", async () => {
    // Tendai Moyo files to The Herald's main feed and to the Chronicle — two
    // newsrooms, and NOT the Herald's second feed.
    await renderPage();
    fireEvent.change(screen.getByLabelText("Filter sources by author byline"), {
      target: { value: "Tendai Moyo" },
    });

    await waitFor(() => expect(rowNames()).not.toContain("Daily Nation"));
    expect(rowNames()).toContain("The Herald");
    expect(rowNames()).toContain("Chronicle Zimbabwe");
    expect(rowNames()).not.toContain("The Herald (secondary)");
  });

  it("matches a partial byline as it is typed", async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText("Filter sources by author byline"), {
      target: { value: "wanjiku" },
    });

    await waitFor(() => expect(rowNames()).toContain("Daily Nation"));
    expect(rowNames()).not.toContain("The Herald");
  });

  it("an empty author box filters nothing", async () => {
    // `null`, not an empty Set. An empty Set is indistinguishable from "this
    // author files to nothing" and would blank the directory on every load.
    await renderPage();
    const input = screen.getByLabelText("Filter sources by author byline");
    fireEvent.change(input, { target: { value: "Tendai" } });
    await waitFor(() => expect(rowNames()).not.toContain("Daily Nation"));

    fireEvent.change(input, { target: { value: "  " } });
    await waitFor(() => expect(rowNames()).toContain("Daily Nation"));
  });

  it("hides the author control entirely when the index failed to load", async () => {
    // A control that silently matches nothing is worse than no control.
    mockGetSourceAuthorsAction.mockResolvedValue([]);
    render(<SourcesPage />);
    await waitFor(() => expect(rowNames()).toContain("The Herald"));
    expect(screen.queryByLabelText("Filter sources by author byline")).toBeNull();
  });

  it("combines country, newsroom and author", async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText("Filter sources by country"), {
      target: { value: "ZW" },
    });
    fireEvent.change(screen.getByLabelText("Filter sources by newsroom"), {
      target: { value: "org-chronicle-zw" },
    });
    fireEvent.change(screen.getByLabelText("Filter sources by author byline"), {
      target: { value: "Tendai" },
    });

    await waitFor(() => expect(rowNames()).toContain("Chronicle Zimbabwe"));
    expect(rowNames()).not.toContain("The Herald");
    expect(rowNames()).not.toContain("Daily Nation");
  });
});
