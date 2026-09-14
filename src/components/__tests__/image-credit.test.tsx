import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

import {
  ImageCredit,
  imageCreditName,
  imageCreditText,
} from "@/components/ui/image-credit";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const PUBLISHER = { id: "org-1", name: "The Herald", isVerified: true };

describe("the credit names who SUPPLIED the picture, never who took it", () => {
  it("prefers the masthead over the feed name", () => {
    // `source` is a delivery endpoint whose name can disagree with the
    // newsroom's; `publisher` is resolved from the article's
    // mediaOrganizationId and is who actually published.
    render(
      <ImageCredit
        article={{ publisher: PUBLISHER, source: "herald-zw-rss" }}
      />,
    );
    expect(screen.getByText(/Image via The Herald/)).toBeInTheDocument();
    expect(screen.queryByText(/herald-zw-rss/)).toBeNull();
  });

  it("falls back to the feed name when the masthead did not resolve", () => {
    // List reads do not resolve the organisation, so this is the common path
    // on a card — a fallback, not a lesser answer.
    expect(imageCreditName({ source: "Nyasa Times" })).toBe("Nyasa Times");
  });

  it("renders NOTHING rather than inventing a source", () => {
    // "Image via Unknown" printed over a photographer's work is the invented
    // verdict this codebase refuses everywhere else. A null is a known gap.
    const { container } = render(<ImageCredit article={{ source: "" }} />);
    expect(container).toBeEmptyDOMElement();
    expect(imageCreditName({ source: "   " })).toBeNull();
    expect(
      imageCreditText({ source: undefined as unknown as string }),
    ).toBeNull();
  });

  it("never claims authorship", () => {
    // The corpus stores `image: [{'@type', url}]` and nothing else — measured
    // 2026-09-14 across the 20,000 most recent articles, zero carry a credit,
    // caption or copyright holder. So the platform cannot say who made the
    // photograph, and "Photo: X" would say it anyway.
    const { container } = render(
      <ImageCredit article={{ publisher: PUBLISHER, source: "x" }} />,
    );
    const text = container.textContent ?? "";
    expect(text).toMatch(/\bvia\b/);
    expect(text).not.toMatch(/Photo(graph)?\s*(:|by)/i);
  });

  it("states the rights position on the caption variant", () => {
    render(
      <ImageCredit
        article={{ publisher: PUBLISHER, source: "x" }}
        variant="caption"
      />,
    );
    expect(
      screen.getByRole("link", {
        name: /rights remain with the copyright holder/i,
      }),
    ).toHaveAttribute("href", "/terms#images");
  });

  it("drops the scrim on the inline variant", () => {
    // It sits inside a caption block that is already on a wash of its own; a
    // second one reads as a separate floating control.
    const { container } = render(
      <ImageCredit article={{ source: "Daily Maverick" }} variant="inline" />,
    );
    expect(container.querySelector(".bg-black\\/60")).toBeNull();
    expect(container.textContent).toContain("Image via Daily Maverick");
  });

  it("places the overlay by prop, not by an appended class", () => {
    // Tailwind utilities do not cascade by string order: an appended `top-2`
    // against the base `bottom-2` would be settled by emission order, not by
    // the call site.
    const { container } = render(
      <ImageCredit
        article={{ source: "S" }}
        variant="overlay"
        place="top-right"
      />,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("top-2");
    expect(el.className).not.toContain("bottom-2");
  });
});

/**
 * Every surface that puts a publisher's photograph on screen is inventoried
 * here with a decision, and a file that renders one without appearing below
 * fails this suite.
 *
 * The inventory exists because `/terms` now states, to publishers and to
 * readers, that images "are displayed with a credit identifying where they came
 * from". That is a promise the product has to keep, and it is kept by seven
 * separate call sites — exactly the shape that drifts silently. A threshold on
 * the fetched image width was tried first and rejected: `imageProxyUrl(…,
 * {width: 600})` is the DPR-oversampled fetch, not the rendered size, so the
 * embed's 80px list thumbnail and its 280px hero both ask for 600 and the
 * number cannot tell them apart.
 *
 * `thumbnail` is a recorded decision rather than an exemption: below roughly
 * 128px a credit chip is either unreadable or wider than the picture, and in
 * every one of those cases the surface's own source badge sits immediately
 * beside the image.
 */
const IMAGE_SURFACES: Record<
  string,
  "credited" | "thumbnail" | "not-a-photograph"
> = {
  "src/app/article/[id]/article-detail-client.tsx": "credited",
  "src/app/embed/iframe/page.tsx": "credited",
  "src/app/newsbytes/page.tsx": "credited",
  "src/components/article-card.tsx": "credited",
  "src/components/hero-card.tsx": "credited",
  "src/components/story-cluster.tsx": "credited",

  // 64px row thumbnail, source badge alongside it.
  "src/components/compact-card.tsx": "thumbnail",
  // 128px timeline thumbnail, source named in the same row.
  "src/components/topic-timeline.tsx": "thumbnail",

  // Images inside an article BODY. This component is handed a Markdown string
  // and no article, so it has no publisher to name — and the body is already
  // attributed by the byline and the hero caption above it.
  "src/components/ui/markdown.tsx": "not-a-photograph",

  // Plumbing, not surfaces.
  "src/lib/image.ts": "not-a-photograph",
  "src/lib/publisher-icon.ts": "not-a-photograph",
  "src/lib/utils.ts": "not-a-photograph",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("the credit promise in /terms is kept at every call site", () => {
  const root = path.resolve(__dirname, "../..");
  const files = walk(root).filter((f) =>
    /imageProxyUrl\(|mukokoImageLoader/.test(fs.readFileSync(f, "utf8")),
  );

  it("finds the surfaces it is meant to be checking", () => {
    // Guards against the walk silently matching nothing, which would make
    // every assertion below vacuously true.
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it("inventories every file that renders a proxied image", () => {
    const unlisted = files
      .map((f) => path.relative(path.resolve(root, ".."), f))
      .filter((rel) => !(rel in IMAGE_SURFACES));
    expect(unlisted).toEqual([]);
  });

  it("has no inventory entry pointing at a file that no longer renders one", () => {
    const live = new Set(
      files.map((f) => path.relative(path.resolve(root, ".."), f)),
    );
    expect(Object.keys(IMAGE_SURFACES).filter((rel) => !live.has(rel))).toEqual(
      [],
    );
  });

  it.each(
    Object.entries(IMAGE_SURFACES)
      .filter(([, kind]) => kind === "credited")
      .map(([rel]) => rel),
  )("%s renders an ImageCredit", (rel) => {
    const src = fs.readFileSync(path.resolve(root, "..", rel), "utf8");
    expect(src).toContain("@/components/ui/image-credit");
    expect(src).toMatch(/<ImageCredit\b/);
  });
});
