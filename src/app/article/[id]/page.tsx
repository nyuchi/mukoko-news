import { cache, Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { articleExists, getArticleById } from "@/lib/mongodb/articles";
import { getArticleUrl, BASE_URL } from "@/lib/constants";
import { isValidImageUrl } from "@/lib/utils";
import ArticleDetailClient from "./article-detail-client";
import { ArticlePageSkeleton } from "@/components/ui/skeleton";

interface Props {
  params: Promise<{ id: string }>;
}

// ISR: cache each article's rendered HTML for 5 minutes — article content only
// changes when the pipeline (re-)enriches it, so this removes the per-view
// MongoDB read without meaningful staleness. Nothing in this page reads
// cookies()/headers(), so the route stays cacheable.
export const revalidate = 300;

// `missing` and `unavailable` must stay distinguishable: a genuinely absent id
// should 404, but a MongoDB outage must not — answering 404 for a transient
// read failure would hand Google a deindex signal for every live article.
type ArticleFetch =
  | { status: "ok"; article: NonNullable<Awaited<ReturnType<typeof getArticleById>>> }
  | { status: "missing" }
  | { status: "unavailable" };

const fetchArticle = cache(async (id: string): Promise<ArticleFetch> => {
  try {
    const article = await getArticleById(id);
    return article ? { status: "ok", article } : { status: "missing" };
  } catch (error) {
    console.error("[ArticlePage] Failed to fetch article:", id, error);
    return { status: "unavailable" };
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const result = await fetchArticle(id);

  if (result.status !== "ok") {
    // The page answers a real 404 for `missing`. Keep both non-ok states out of
    // the index: previously an unresolvable id rendered HTTP 200 with
    // "index, follow", so every dead article id was an indexable thin page.
    return { title: "Article Not Found", robots: { index: false, follow: false } };
  }
  const article = result.article;

  const articleUrl = getArticleUrl(id);
  const description =
    article.description ||
    `Read "${article.title}" — latest news from ${article.source} on Mukoko News.`;

  const hasValidImage = isValidImageUrl(article.image_url);

  return {
    title: article.title,
    description,
    authors: article.source ? [{ name: article.source }] : undefined,
    openGraph: {
      title: article.title,
      description,
      url: articleUrl,
      type: "article",
      publishedTime: article.published_at,
      section: article.category_id || article.category || undefined,
      siteName: "Mukoko News",
      images: hasValidImage
        ? [
            {
              url: article.image_url!,
              alt: article.title,
            },
          ]
        : [
            {
              url: `${BASE_URL}/mukoko-icon-dark.png`,
              width: 512,
              height: 512,
              alt: "Mukoko News",
            },
          ],
    },
    twitter: {
      card: hasValidImage ? "summary_large_image" : "summary",
      title: article.title,
      description,
      site: "@mukokoafrica",
      images: hasValidImage ? [article.image_url!] : undefined,
      creator: "@mukokoafrica",
    },
    alternates: {
      canonical: articleUrl,
    },
    robots: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  };
}

/**
 * The article itself, behind the boundary.
 *
 * Split out so the expensive read — the full document plus the two joins in
 * `resolveArticleDetail` — happens INSIDE `<Suspense>` and streams, while the
 * decision that sets the status code happens outside it. `fetchArticle` is
 * `cache()`d, so `generateMetadata` and this share one read per request.
 */
async function ArticleBody({ id }: { id: string }) {
  const result = await fetchArticle(id);
  // A read FAILURE still renders the shell, so an outage degrades instead of
  // deindexing. `missing` cannot reach here — the route already 404'd on it.
  const article = result.status === "ok" ? result.article : null;
  return <ArticleDetailClient articleId={id} initialArticle={article} />;
}

export default async function ArticleDetailPage({ params }: Props) {
  const { id } = await params;

  // The existence check is deliberately the FIRST thing awaited and sits
  // OUTSIDE the boundary below, because everything above a `<Suspense>`
  // decides the status line and everything inside it is already too late.
  //
  // ⚠️ The 404 here was ASPIRATIONAL until 2026-09-17: measured on production,
  // a dead id answered `200` with `Article Not Found` in the title. This route
  // carried a `loading.tsx`, and a Suspense boundary ABOVE a page streams the
  // shell — and the status line — before the page decides anything, so this
  // `notFound()` landed in a response that had already said `200 OK`. That file
  // is gone; the skeleton it rendered now hangs off the in-page boundary below,
  // which keeps the streaming without buying it with the status code.
  // `route-status-codes.test.ts` keeps a `loading.tsx` from coming back.
  //
  // `null` is "we could not look", and is NOT a 404 — see `articleExists`.
  if ((await articleExists(id)) === false) notFound();

  return (
    <Suspense fallback={<ArticlePageSkeleton />}>
      <ArticleBody id={id} />
    </Suspense>
  );
}
