import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SearchPage from "../page";

// Searching is metered for readers without an account, so the page now reads
// the session through `useMeter`. Signed in by default here: this suite is
// about search behaviour, and the allowance has no ceiling for an account — the
// wall gets its own suite rather than being smuggled into every assertion.
const mockUseAuth = vi.fn(() => ({ user: { id: "user_1" }, loading: false }));
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
  getCategoriesAction: vi.fn(async () => []),
  getTrendingCategoriesAction: vi.fn(async () => []),
  getStatsAction: vi.fn(async () => ({
    database: {
      total_articles: 0,
      active_sources: 0,
      categories: 0,
      today_articles: 0,
    },
  })),
  searchArticlesAction: vi.fn(async () => []),
}));

import { searchArticlesAction } from "@/lib/actions/feed";

const searchAction = vi.mocked(searchArticlesAction);

function typeQuery(value: string) {
  const input = screen.getByRole("searchbox", { name: /search african news/i });
  fireEvent.change(input, { target: { value } });
  return input;
}

describe("the search page's submit control", () => {
  beforeEach(() => {
    searchAction.mockClear();
  });

  /**
   * The regression this file exists for. The form had exactly one control — the
   * text input — so the ONLY way to run a search was the browser's implicit
   * submit on Enter. That is invisible: a reader types, sees nothing to press,
   * and concludes search is broken. Asserting on the accessible role rather
   * than on a class name, because "there is a button" is the claim.
   */
  it("renders a submit button, so the search can be triggered by pressing it", () => {
    render(<SearchPage />);

    const button = screen.getByRole("button", { name: /^search$/i });
    expect(button).toHaveAttribute("type", "submit");
  });

  it("runs the search when the button is pressed", async () => {
    render(<SearchPage />);
    typeQuery("mining");

    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));

    await waitFor(() =>
      expect(searchAction).toHaveBeenCalledWith("mining", 50, {
        category: undefined,
      }),
    );
  });

  /**
   * Adding a submit button must not cost the keyboard path that already worked:
   * a form with a submit button still submits on Enter, and that is the route
   * most mobile keyboards offer via their "go" key.
   */
  it("still runs the search on Enter", async () => {
    render(<SearchPage />);
    const input = typeQuery("elections");

    fireEvent.submit(input.closest("form")!);

    await waitFor(() =>
      expect(searchAction).toHaveBeenCalledWith("elections", 50, {
        category: undefined,
      }),
    );
  });

  /**
   * A blank query cannot produce results — `performSearch` returns early on it —
   * so an enabled button would be a control that visibly does nothing.
   */
  it("disables the button until there is a term to search for", () => {
    render(<SearchPage />);
    const button = screen.getByRole("button", { name: /^search$/i });
    expect(button).toBeDisabled();

    typeQuery("   ");
    expect(button).toBeDisabled();

    typeQuery("harare");
    expect(button).toBeEnabled();
  });
});
