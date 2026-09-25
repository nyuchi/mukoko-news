/**
 * The home feed must never trade something on screen for a skeleton.
 *
 * WHAT BREAKS IF THIS REGRESSES (owner report 2026-09-25): the server renders
 * the default feed into the HTML, and a reader whose saved countries differ
 * refetches on mount. That refetch used to swap the feed they were already
 * reading for a full-page skeleton until the server answered, which on a
 * cold cluster took up to 30 seconds.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { SectionedFeed } from "@/lib/actions/feed";

const prefs = vi.hoisted(() => ({ countries: ["KE"] as string[] }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/contexts/preferences-context", () => ({
  usePreferences: () => ({
    selectedCategories: [],
    selectedCountries: prefs.countries,
  }),
}));
vi.mock("@/lib/actions/refresh", () => ({ triggerFeedCollection: vi.fn() }));
vi.mock("@/lib/actions/feed", () => ({
  getSectionedFeedAction: vi.fn(),
  getArticlesAction: vi.fn(async () => ({
    articles: [],
    nextCursor: null,
    hasMore: false,
    total: null,
  })),
  getCategoriesAction: vi.fn(async () => []),
}));

import HomeClient from "../home-client";
import { getSectionedFeedAction } from "@/lib/actions/feed";

function article(id: string, title: string) {
  return {
    id,
    title,
    slug: id,
    description: "",
    source: "The Herald",
    source_id: "src-1",
    category: "Politics",
    published_at: "2026-09-25T06:00:00.000Z",
    original_url: `https://herald.co.zw/${id}`,
  } as never;
}

function feed(title: string): SectionedFeed {
  const a = article(title.toLowerCase().replace(/\s+/g, "-"), title);
  return {
    topStories: [],
    yourNews: [a],
    byCategory: [],
    latest: [a],
    countries: [],
    timestamp: "2026-09-25T06:00:00.000Z",
    nextCursor: null,
    hasMore: false,
    degraded: false,
  };
}

beforeEach(() => {
  vi.mocked(getSectionedFeedAction).mockReset();
  globalThis.IntersectionObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
    takeRecords() {
      return [];
    }
  } as never;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as never;
});

describe("the home feed while a reader's own preferences load", () => {
  it("keeps the server-rendered feed on screen until the personalised one arrives", async () => {
    let resolve!: (f: SectionedFeed) => void;
    vi.mocked(getSectionedFeedAction).mockReturnValue(
      new Promise((r) => (resolve = r)),
    );

    render(
      <HomeClient initialFeed={feed("Default story")} initialCategories={[]} />,
    );

    await waitFor(() => expect(getSectionedFeedAction).toHaveBeenCalled());
    expect(screen.getAllByText("Default story").length).toBeGreaterThan(0);
    expect(screen.getByText("Updating…")).toBeInTheDocument();

    resolve(feed("Kenya story"));
    await waitFor(() =>
      expect(screen.getAllByText("Kenya story").length).toBeGreaterThan(0),
    );
  });

  it("keeps the feed and says so when the update fails, instead of an error screen", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getSectionedFeedAction).mockRejectedValue(new Error("timed out"));

    render(
      <HomeClient initialFeed={feed("Default story")} initialCategories={[]} />,
    );

    await waitFor(() =>
      expect(
        screen.getByText("Couldn't update your feed. Pull down to retry."),
      ).toBeInTheDocument(),
    );
    expect(screen.getAllByText("Default story").length).toBeGreaterThan(0);
    expect(
      screen.queryByText("Unable to load articles"),
    ).not.toBeInTheDocument();
  });
});
