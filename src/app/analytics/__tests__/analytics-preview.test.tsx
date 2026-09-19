import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import AnalyticsPreview from "../analytics-preview";
import type { CorpusPreview } from "@/lib/mongodb/analytics";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/ui/error-boundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

function preview(over: Partial<CorpusPreview> = {}): CorpusPreview {
  return {
    query: {
      q: "",
      countries: [],
      categories: ["politics"],
      sources: [],
      sentiments: [],
      from: "2026-08-01",
      to: "2026-09-01",
      minQuality: null,
    } as unknown as CorpusPreview["query"],
    answered: true,
    total: 12431,
    usedSearchIndex: false,
    series: [{ date: "2026-08-01", count: 10 }],
    bySource: [
      {
        sourceId: "src-1",
        name: "The Herald",
        country: "ZW",
        count: 800,
        share: 6.4,
      },
    ],
    byCountry: [{ code: "ZW", name: "Zimbabwe", count: 5000, share: 40.2 }],
    byCategory: [{ term: "politics", count: 12431 }],
    byKeyword: [{ term: "elections", count: 310 }],
    sentiment: {
      positive: 1,
      neutral: 2,
      negative: 1,
      mixed: 0,
      coverage: 50,
      covered: 4,
    },
    generatedAt: "2026-09-19T00:00:00.000Z",
    ...over,
  };
}

describe("the anonymous analytics preview", () => {
  /**
   * The conversion argument. A reader who followed a topic from `/insights` has
   * to SEE their own question answered before being asked for an account —
   * that is the whole reason this replaced a redirect to `/sign-in`.
   */
  it("answers the reader's own query before asking for anything", () => {
    render(
      <AnalyticsPreview
        preview={preview()}
        returnTo="/analytics?category=politics"
      />,
    );

    // Scoped to the headline card: the total legitimately appears twice on a
    // single-category query (headline and the category bar), so an unscoped
    // getByText would fail on correct markup.
    const headline = screen.getByText(/showing/i).closest("div")!;
    expect(within(headline).getByText("12,431")).toBeInTheDocument();

    expect(screen.getByText("The Herald")).toBeInTheDocument();
    expect(screen.getByText("Zimbabwe")).toBeInTheDocument();
  });

  it("returns the reader to the exact query after signing in", () => {
    render(
      <AnalyticsPreview
        preview={preview()}
        returnTo="/analytics?category=politics"
      />,
    );

    const cta = screen.getByRole("link", { name: /create a free account/i });
    expect(cta).toHaveAttribute(
      "href",
      "/sign-in?returnTo=%2Fanalytics%3Fcategory%3Dpolitics",
    );
  });

  /**
   * "Sign in for more" is a promise with no content. Naming the four locked
   * panels is what makes the ask concrete, so it is asserted rather than left
   * to drift into a vague banner.
   */
  it("names what an account actually unlocks", () => {
    render(<AnalyticsPreview preview={preview()} returnTo="/analytics" />);

    expect(screen.getByText(/named entities/i)).toBeInTheDocument();
    expect(screen.getByText(/^bylines$/i)).toBeInTheDocument();
    expect(screen.getByText(/the articles themselves/i)).toBeInTheDocument();
    expect(screen.getByText(/csv and json export/i)).toBeInTheDocument();
  });

  /**
   * `answered: false` means no Search index can express the query shape — NOT
   * that the corpus holds nothing. Rendering a zero would state something we
   * never measured, which is the failure this repo's reads carry `ok` to avoid.
   */
  it("says it could not run the query rather than reporting zero", () => {
    render(
      <AnalyticsPreview
        preview={preview({
          answered: false,
          total: 0,
          bySource: [],
          byCountry: [],
        })}
        returnTo="/analytics"
      />,
    );

    expect(screen.getByText(/couldn't summarise/i)).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  /**
   * The load-bearing structural guard.
   *
   * The preview is only safe to hand an anonymous caller because it runs the
   * cheap `$searchMeta` facet pass and never the document scan. An edit that
   * reached for the full result here — or that called the gated action — would
   * reopen exactly the cost hole `guard.ts` gates the console for, and it would
   * look completely reasonable in review.
   */
  it("never reaches the gated read from the anonymous path", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/analytics/page.tsx"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, " ");

    const anonymousBranch = src.slice(
      src.indexOf("viewerCanAccess('analytics-console')"),
      src.indexOf("AnalyticsPreview preview"),
    );

    expect(anonymousBranch).toContain("runCorpusPreviewAction");
    expect(anonymousBranch).not.toContain("runCorpusQueryAction");
    expect(anonymousBranch).not.toContain("getQueryFacetsAction");
    expect(anonymousBranch).not.toContain("getCoverageConcentrationAction");
  });

  /**
   * The preview action is the ONE action in that module without
   * `requireViewer()`. If a future edit adds another, this fails and makes
   * whoever added it say why in a test rather than in a diff nobody reads.
   */
  it("leaves exactly one analytics action ungated", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/actions/analytics.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");

    const actions = [...src.matchAll(/export async function (\w+)/g)].map(
      (m) => m[1],
    );
    const ungated = actions.filter((name) => {
      const body = src.slice(src.indexOf(`export async function ${name}`));
      return !body.slice(0, body.indexOf("\n}")).includes("requireViewer()");
    });

    expect(ungated).toEqual(["runCorpusPreviewAction"]);
  });
});
