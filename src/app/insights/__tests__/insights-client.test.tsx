import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import InsightsClient, { normalizeAuthors } from "../insights-client";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Mock server actions (pages read via Server Actions — Rule 4)
const mockGetStats = vi.fn();
const mockGetTrendingCategories = vi.fn();
const mockGetTrendingAuthors = vi.fn();

vi.mock("@/lib/actions/feed", () => ({
  getStatsAction: (...args: unknown[]) => mockGetStats(...args),
  getTrendingCategoriesAction: (...args: unknown[]) => mockGetTrendingCategories(...args),
  getTrendingAuthorsAction: (...args: unknown[]) => mockGetTrendingAuthors(...args),
}));

const stats = { total_articles: 18081, active_sources: 42, categories: 12 };
const trending = [
  { id: "politics", name: "Politics", slug: "politics", article_count: 3219 },
  { id: "economy", name: "Economy", slug: "economy", article_count: 1589 },
];

describe("normalizeAuthors", () => {
  it("keeps plain string author names", () => {
    expect(normalizeAuthors([{ id: "jane doe", name: "jane doe", article_count: 4 }])).toEqual([
      { id: "Jane Doe", name: "Jane Doe", article_count: 4 },
    ]);
  });

  it("unwraps schema.org Person objects (the crash regression)", () => {
    const raw = [
      {
        id: { "@type": "Person", name: "faty ba" },
        name: { "@type": "Person", name: "faty ba" },
        article_count: 2,
      },
    ];
    expect(normalizeAuthors(raw)).toEqual([{ id: "Faty Ba", name: "Faty Ba", article_count: 2 }]);
  });

  it("drops entries without a usable name and merges duplicates", () => {
    const raw = [
      { name: "jane doe", article_count: 2 },
      { name: { "@type": "Person", name: "jane doe" }, article_count: 3 },
      { name: null, article_count: 9 },
      { name: { "@type": "Person" }, article_count: 9 },
    ];
    expect(normalizeAuthors(raw)).toEqual([{ id: "Jane Doe", name: "Jane Doe", article_count: 5 }]);
  });

  it("returns empty for non-array input", () => {
    expect(normalizeAuthors(null)).toEqual([]);
    expect(normalizeAuthors(undefined)).toEqual([]);
  });
});

describe("InsightsClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders server-provided initial data without fetching", async () => {
    render(
      <InsightsClient
        initialStats={stats}
        initialTrending={trending}
        initialAuthors={[{ name: { "@type": "Person", name: "faty ba" }, article_count: 2 }]}
      />
    );

    expect(screen.getByText("Insights")).toBeInTheDocument();
    expect(screen.getByText("18,081")).toBeInTheDocument();
    expect(screen.getByText("Politics")).toBeInTheDocument();
    // Object-authors render as normalised strings, not "[object Object]"
    expect(screen.getByText("Faty Ba")).toBeInTheDocument();

    expect(mockGetStats).not.toHaveBeenCalled();
    expect(mockGetTrendingCategories).not.toHaveBeenCalled();
    expect(mockGetTrendingAuthors).not.toHaveBeenCalled();
  });

  it("fetches on mount when the server provided no data", async () => {
    mockGetStats.mockResolvedValue({ database: stats });
    mockGetTrendingCategories.mockResolvedValue(trending);
    mockGetTrendingAuthors.mockResolvedValue({
      trending_authors: [{ id: "john smith", name: "john smith", article_count: 7 }],
    });

    render(<InsightsClient />);

    await waitFor(() => {
      expect(screen.getByText("18,081")).toBeInTheDocument();
    });
    expect(screen.getByText("John Smith")).toBeInTheDocument();
    expect(mockGetStats).toHaveBeenCalled();
  });

  it("shows an error state with retry when every fetch fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetStats.mockRejectedValue(new Error("mongo down"));
    mockGetTrendingCategories.mockRejectedValue(new Error("mongo down"));
    mockGetTrendingAuthors.mockRejectedValue(new Error("mongo down"));

    render(<InsightsClient />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText("Unable to load insights")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    consoleSpy.mockRestore();
  });
});
