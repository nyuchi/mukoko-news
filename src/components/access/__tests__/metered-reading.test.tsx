import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { MeteredArticleBody } from "@/components/access/metered-article-body";
import { allowanceOf } from "@/lib/access";
import { recordMeterUse, readMeter } from "@/lib/metering";

const mockUseAuth = vi.fn(() => ({
  user: null as { id: string } | null,
  loading: false,
}));
vi.mock("@workos-inc/authkit-nextjs/components", () => ({
  useAuth: () => mockUseAuth(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/article/a-99" }));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

/** The allowance is read from the map, never written down here. */
const ANON_ARTICLES = allowanceOf("articles", "anonymous") as number;

function signedOut() {
  mockUseAuth.mockReturnValue({ user: null, loading: false });
}
function signedIn() {
  mockUseAuth.mockReturnValue({ user: { id: "user_1" }, loading: false });
}
/** Spend `n` of the article allowance on ids that are not the one under test. */
function spend(n: number) {
  for (let i = 0; i < n; i++) recordMeterUse("articles", `prior-${i}`);
}

beforeEach(() => {
  window.localStorage.clear();
  signedOut();
});

const BODY = <p>The reported facts of the matter.</p>;

describe("the anonymous reading allowance", () => {
  it("shows the article and no wall well inside the allowance", async () => {
    render(<MeteredArticleBody articleId="a-99">{BODY}</MeteredArticleBody>);
    await waitFor(() =>
      expect(screen.getByText(/reported facts/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("heading", { name: /free reading/i })).toBeNull();
  });

  it("walls the article AFTER the allowance is spent, not on the one that spends it", async () => {
    // One short of the ceiling. Opening this article spends the last one, so it
    // must still be readable — a reader promised fifty gets fifty.
    spend(ANON_ARTICLES - 1);
    render(<MeteredArticleBody articleId="last">{BODY}</MeteredArticleBody>);
    await waitFor(() => expect(readMeter("articles").used).toBe(ANON_ARTICLES));
    expect(screen.queryByRole("heading", { name: /free reading/i })).toBeNull();
  });

  it("walls the next article once the allowance is spent", async () => {
    spend(ANON_ARTICLES);
    render(
      <MeteredArticleBody articleId="one-too-many">{BODY}</MeteredArticleBody>,
    );
    expect(
      await screen.findByRole("heading", { name: /free reading/i }),
    ).toBeInTheDocument();
  });

  it("NEVER removes the body from the DOM — the wall is a mask, not a deletion", async () => {
    // Load-bearing for the whole product: Googlebot executes JavaScript, and an
    // aggregator whose article text vanishes from the rendered DOM has deleted
    // itself from the search traffic it runs on.
    spend(ANON_ARTICLES);
    render(
      <MeteredArticleBody articleId="one-too-many">{BODY}</MeteredArticleBody>,
    );
    await screen.findByRole("heading", { name: /free reading/i });
    expect(screen.getByText(/reported facts/i)).toBeInTheDocument();
  });

  it("does not hide the clipped body from assistive technology", async () => {
    // The top of the block is still on screen. `aria-hidden` over visible text
    // would leave a screen-reader user with less than a sighted reader gets.
    spend(ANON_ARTICLES);
    render(
      <MeteredArticleBody articleId="one-too-many">{BODY}</MeteredArticleBody>,
    );
    await screen.findByRole("heading", { name: /free reading/i });

    // Scoped to the article text and its ancestors. A blanket "nothing is
    // aria-hidden" would fail on the wall's own decorative lock icon, which is
    // correctly hidden — the rule is about CONTENT, not about every element.
    for (
      let el: HTMLElement | null = screen.getByText(/reported facts/i);
      el;
      el = el.parentElement
    ) {
      expect(el.getAttribute("aria-hidden")).not.toBe("true");
    }
  });

  it("keeps an article you have ALREADY read readable at the limit", async () => {
    // Dedupe alone would wall it: `used` is still at the ceiling and the
    // comparison does not care which article is on screen. Taking back
    // something already given reads as the site breaking.
    recordMeterUse("articles", "already-read");
    spend(ANON_ARTICLES - 1);
    expect(readMeter("articles").used).toBe(ANON_ARTICLES);

    render(
      <MeteredArticleBody articleId="already-read">{BODY}</MeteredArticleBody>,
    );
    await waitFor(() =>
      expect(screen.getByText(/reported facts/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("heading", { name: /free reading/i })).toBeNull();
  });

  it("counts articles, not page loads — a re-read spends nothing", async () => {
    const { unmount } = render(
      <MeteredArticleBody articleId="a-1">{BODY}</MeteredArticleBody>,
    );
    await waitFor(() => expect(readMeter("articles").used).toBe(1));
    unmount();
    render(<MeteredArticleBody articleId="a-1">{BODY}</MeteredArticleBody>);
    await waitFor(() => expect(readMeter("articles").used).toBe(1));
  });
});

describe("an account removes the ceiling", () => {
  it("never walls a signed-in reader, however much they had read anonymously", async () => {
    spend(ANON_ARTICLES * 4);
    signedIn();
    render(
      <MeteredArticleBody articleId="anything">{BODY}</MeteredArticleBody>,
    );
    await waitFor(() =>
      expect(screen.getByText(/reported facts/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("heading", { name: /free reading/i })).toBeNull();
  });

  it("CLEARS the anonymous tally on sign-in, so signing out does not land on a wall", async () => {
    // Without this, a reader who signed up at fifty articles and later signed
    // out would be walled by a count they already answered.
    spend(ANON_ARTICLES);
    signedIn();
    render(
      <MeteredArticleBody articleId="anything">{BODY}</MeteredArticleBody>,
    );
    await waitFor(() => expect(readMeter("articles").used).toBe(0));
  });
});

describe("while the session is still resolving", () => {
  it("shows the article rather than the wall", async () => {
    // Optimistic on purpose: the body is already in the HTML, so showing it and
    // then walling costs nothing — while starting walled would flash a sign-up
    // screen over every article on every load, crawlers included.
    spend(ANON_ARTICLES);
    mockUseAuth.mockReturnValue({ user: null, loading: true });
    render(
      <MeteredArticleBody articleId="one-too-many">{BODY}</MeteredArticleBody>,
    );
    expect(screen.getByText(/reported facts/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /free reading/i })).toBeNull();
  });
});
