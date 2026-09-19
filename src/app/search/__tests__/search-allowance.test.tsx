import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import SearchPage from "../page";
import { allowanceOf } from "@/lib/access";
import { recordMeterUse, readMeter } from "@/lib/metering";

const mockUseAuth = vi.fn(() => ({
  user: null as { id: string } | null,
  loading: false,
}));
vi.mock("@workos-inc/authkit-nextjs/components", () => ({
  useAuth: () => mockUseAuth(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/search" }));
vi.mock("@/components/ui/error-boundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/components/article-card", () => ({
  ArticleCard: ({ article }: { article: { id: string; title: string } }) => (
    <article>{article.title}</article>
  ),
}));
vi.mock("@/lib/actions/feed", () => ({
  getCategoriesAction: vi.fn(async () => [
    { id: "c1", name: "Politics", slug: "politics", article_count: 1 },
    { id: "c2", name: "Business", slug: "business", article_count: 1 },
  ]),
  getTrendingCategoriesAction: vi.fn(async () => []),
  getStatsAction: vi.fn(async () => ({
    database: {
      total_articles: 0,
      active_sources: 0,
      categories: 0,
      today_articles: 0,
    },
  })),
  searchArticlesAction: vi.fn(async () => [
    { id: "a-1", title: "A matching story" },
  ]),
}));

import { searchArticlesAction } from "@/lib/actions/feed";
const searchAction = vi.mocked(searchArticlesAction);

const ANON_SEARCHES = allowanceOf("searches", "anonymous") as number;

function runSearch(term: string) {
  fireEvent.change(
    screen.getByRole("searchbox", { name: /search african news/i }),
    { target: { value: term } },
  );
  fireEvent.click(screen.getByRole("button", { name: /^search$/i }));
}

beforeEach(() => {
  window.localStorage.clear();
  searchAction.mockClear();
  mockUseAuth.mockReturnValue({ user: null, loading: false });
});

describe("the anonymous search allowance", () => {
  it("runs the full allowance of searches, then walls the next one", async () => {
    render(<SearchPage />);

    for (let i = 0; i < ANON_SEARCHES; i++) {
      runSearch(`question ${i}`);
      await waitFor(() => expect(searchAction).toHaveBeenCalledTimes(i + 1));
    }

    runSearch("one too many");
    expect(
      await screen.findByRole("heading", { name: /free searches/i }),
    ).toBeInTheDocument();
    // The walled search was never issued: the wall is in front of the read, not
    // decoration over a result we paid for anyway.
    expect(searchAction).toHaveBeenCalledTimes(ANON_SEARCHES);
  });

  it("never claims the corpus is empty for a search it did not run", async () => {
    // ⚠️ The results header reads "Found N results for X". With the search
    // never issued, N is 0 — and rendering that would tell the reader this
    // corpus holds nothing on their subject, a claim about the corpus we did
    // not measure. Same failure `CorpusSummary.ok` exists to prevent.
    for (let i = 0; i < ANON_SEARCHES; i++) recordMeterUse("searches");
    render(<SearchPage />);

    runSearch("zimbabwe elections");
    await screen.findByRole("heading", { name: /free searches/i });

    expect(screen.queryByText(/found 0 results/i)).toBeNull();
    expect(screen.queryByText(/no results found/i)).toBeNull();
  });

  it("does NOT spend a search on refining the query already on screen", async () => {
    // Five chip taps while narrowing one question would otherwise burn the
    // whole allowance, which is not what "5 searches" means to anybody.
    render(<SearchPage />);
    runSearch("mining");
    await waitFor(() => expect(searchAction).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByRole("button", { name: /politics/i }));
    await waitFor(() => expect(searchAction).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole("button", { name: /business/i }));
    await waitFor(() => expect(searchAction).toHaveBeenCalledTimes(3));

    // Three reads of the corpus, ONE question asked.
    expect(readMeter("searches").used).toBe(1);
  });

  it("does not wall a signed-in reader, and clears the anonymous tally", async () => {
    for (let i = 0; i < ANON_SEARCHES * 3; i++) recordMeterUse("searches");
    mockUseAuth.mockReturnValue({ user: { id: "user_1" }, loading: false });
    render(<SearchPage />);

    runSearch("anything at all");
    await waitFor(() => expect(searchAction).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("heading", { name: /free searches/i }),
    ).toBeNull();
    expect(readMeter("searches").used).toBe(0);
  });
});
