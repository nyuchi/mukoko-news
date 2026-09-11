"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  AlertCircle,
  Tag,
  RefreshCw,
  ExternalLink,
  Heart,
  Bookmark,
  Share2,
  Check,
} from "lucide-react";
import { Markdown, decodeHtmlEntities } from "@/components/ui/markdown";
import { type Article } from "@/lib/api";
import { getArticleAction } from "@/lib/actions/feed";
import { getArticleUrl } from "@/lib/constants";
import { imageProxyUrl } from "@/lib/image";
import { isValidImageUrl, topicSlug } from "@/lib/utils";
import { ArticlePageSkeleton } from "@/components/ui/skeleton";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { ArticleJsonLd } from "@/components/ui/json-ld";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { ArticleReadingMeta, ArticleMetricsPanel } from "@/components/article/article-metrics";
import { ArticleByline } from "@/components/article/article-byline";
import { ArticleSummary } from "@/components/article/article-summary";
import { ArticleTrustPanel } from "@/components/article/article-trust";
import { RelatedArticles } from "@/components/article/related-articles";
import { ReadProgress } from "@/components/article/read-progress";
import { PageContainer, PageBleed } from "@/components/layout/page-container";
import { useIslandActions, type IslandAction } from "@/contexts/island-context";

/**
 * True when the article body is just the description again — excerpt-only RSS
 * sources (e.g. Zimpapers feeds) store the same ~30-word teaser in both
 * fields, and showing it twice reads like a bug. Compared on a normalized
 * prefix so trailing ellipses / entity differences don't defeat the check.
 */
function bodyRepeatsDescription(article: Article): boolean {
  const body = article.content_markdown || article.content;
  if (!body || !article.description) return false;
  const normalize = (s: string) =>
    decodeHtmlEntities(s)
      .toLowerCase()
      .replace(/[\s…]+/g, " ")
      .replace(/\.{3,}/g, " ")
      .trim();
  const desc = normalize(article.description);
  const bodyNorm = normalize(body);
  if (!desc || !bodyNorm) return false;
  const prefix = desc.slice(0, Math.min(desc.length, 120));
  return bodyNorm.startsWith(prefix) || bodyNorm.includes(prefix);
}

export default function ArticleDetailClient({
  articleId,
  initialArticle,
}: {
  articleId: string;
  initialArticle?: Article | null;
}) {
  const router = useRouter();

  const [article, setArticle] = useState<Article | null>(initialArticle ?? null);
  const [loading, setLoading] = useState(!initialArticle);
  const [error, setError] = useState<string | null>(null);
  const [isLiked, setIsLiked] = useState(initialArticle?.isLiked || false);
  const [isSaved, setIsSaved] = useState(initialArticle?.isSaved || false);
  const [likesCount, setLikesCount] = useState(initialArticle?.likesCount || 0);
  const [heroImageFailed, setHeroImageFailed] = useState(false);

  const loadArticle = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const article = await getArticleAction(articleId);
      if (article) {
        setArticle(article);
        setIsLiked(article.isLiked || false);
        setIsSaved(article.isSaved || false);
        setLikesCount(article.likesCount || 0);
      } else {
        setError("Article not found");
      }
    } catch (err) {
      console.error("Failed to load article:", err);
      setError("Failed to load article. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [articleId]);

  // Only fetch client-side if no initial data was provided by the server
  useEffect(() => {
    if (!initialArticle && articleId) {
      loadArticle();
    }
  }, [articleId, initialArticle, loadArticle]);

  const handleLike = async () => {
    // Optimistic update
    const wasLiked = isLiked;
    setIsLiked(!wasLiked);
    setLikesCount(wasLiked ? likesCount - 1 : likesCount + 1);

    try {
      const result = await fetch(`/api/articles/${articleId}/like`, { method: 'POST' }).then(r => r.json()) as { liked: boolean };
      // Sync with server state if different
      if (result.liked !== !wasLiked) {
        setIsLiked(result.liked);
      }
    } catch (err) {
      // Revert on error
      console.error("Failed to like article:", err);
      setIsLiked(wasLiked);
      setLikesCount(wasLiked ? likesCount : likesCount - 1);
    }
  };

  const handleSave = async () => {
    // Optimistic update
    const wasSaved = isSaved;
    setIsSaved(!wasSaved);

    try {
      const result = await fetch(`/api/articles/${articleId}/save`, { method: 'POST' }).then(r => r.json()) as { saved: boolean };
      // Sync with server state if different
      if (result.saved !== !wasSaved) {
        setIsSaved(result.saved);
      }
    } catch (err) {
      // Revert on error
      console.error("Failed to save article:", err);
      setIsSaved(wasSaved);
    }
  };

  // Track article view on load
  useEffect(() => {
    if (article && articleId) {
      // Track view after short delay (avoid counting bounces)
      const viewTimer = setTimeout(() => {
        fetch(`/api/articles/${articleId}/view`, { method: 'POST' }).catch(() => {
          // Silent fail - view tracking is non-critical
        });
      }, 2000);

      return () => clearTimeout(viewTimer);
    }
  }, [article, articleId]);

  const [copySuccess, setCopySuccess] = useState(false);

  // Cleanup timeout on unmount to prevent memory leak
  useEffect(() => {
    if (copySuccess) {
      const timer = setTimeout(() => setCopySuccess(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copySuccess]);

  // SSR-safe article URL using centralized base URL
  const articleUrl = getArticleUrl(articleId);

  const handleShare = async () => {
    if (!article) return;

    if (navigator.share) {
      try {
        await navigator.share({
          title: article.title,
          text: article.description || article.title,
          url: articleUrl,
        });
      } catch (err) {
        // User cancelled or share failed - fallback to clipboard
        if ((err as Error).name !== "AbortError") {
          await copyToClipboard();
        }
      }
    } else {
      await copyToClipboard();
    }
  };

  const copyToClipboard = async () => {
    try {
      // Check if clipboard API is available
      if (!navigator.clipboard) {
        // Fallback for older browsers
        const textArea = document.createElement("textarea");
        textArea.value = articleUrl;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.select();
        const success = document.execCommand("copy");
        document.body.removeChild(textArea);
        if (success) setCopySuccess(true);
        return;
      }
      await navigator.clipboard.writeText(articleUrl);
      setCopySuccess(true);
    } catch (err) {
      console.error("Failed to copy:", err);
      // Still show feedback even on error - user can manually copy
    }
  };

  const formatDate = (dateString: string) => {
    try {
      if (!dateString) return "Recently";
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return "Recently";
      return date.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return "Recently";
    }
  };

  /**
   * The article's contribution to the floating island.
   *
   * These used to be a separate pinned bar of their own, which on a desktop
   * meant two pieces of furniture competing for the bottom edge — and the bar
   * shipped left-anchored with an invisible Share button because nobody was
   * looking at the one breakpoint it rendered at. The island is the only thing
   * down there now, and on an article it carries the article's actions between
   * its two fixed ends.
   *
   * Registered ABOVE the loading and error returns, because hooks cannot be
   * called conditionally. `null` while there is no article yet leaves the
   * island as plain navigation, which is the right thing to show on a skeleton.
   *
   * `useMemo` over exactly the state the handlers close over: the hook
   * re-registers on that same state, so a tap always runs a closure that can
   * see the current like/save values rather than the ones from first paint.
   */
  const islandActions = useMemo<IslandAction[] | null>(() => {
    if (!article) return null;

    const originalHref =
      article.original_url && isValidImageUrl(article.original_url)
        ? article.original_url
        : undefined;

    const actions: IslandAction[] = [
      {
        id: "like",
        label: "Like",
        icon: Heart,
        onSelect: handleLike,
        active: isLiked,
        count: likesCount,
        ariaLabel: isLiked ? "Remove like" : "Like this article",
      },
      {
        id: "save",
        label: isSaved ? "Saved" : "Save",
        icon: Bookmark,
        onSelect: handleSave,
        active: isSaved,
        ariaLabel: isSaved ? "Remove from saved" : "Save this article",
      },
    ];

    if (originalHref) {
      actions.push({
        id: "original",
        label: "Original",
        icon: ExternalLink,
        href: originalHref,
        external: true,
        ariaLabel: article.source
          ? `Read the original at ${article.source}`
          : "Read the original article",
      });
    }

    actions.push({
      id: "share",
      label: copySuccess ? "Copied" : "Share",
      icon: copySuccess ? Check : Share2,
      onSelect: handleShare,
      emphasis: copySuccess ? "success" : "primary",
      ariaLabel: "Share this article",
    });

    return actions;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the handlers are
    // re-created every render; the STATE they close over is what belongs here,
    // and it is exactly what `signatureOf` in the island keys re-registration
    // on. Adding the handlers would rebuild this every render for no gain.
  }, [article, isLiked, likesCount, isSaved, copySuccess]);

  useIslandActions(islandActions);

  if (loading) {
    return <ArticlePageSkeleton />;
  }

  // Force refresh handler
  const handleForceRefresh = () => {
    router.refresh();
    loadArticle();
  };

  if (error || !article) {
    return (
      <div className="min-h-[calc(100vh-200px)] flex items-center justify-center px-6">
        <div className="text-center bg-surface border border-outline rounded-2xl p-8 max-w-md">
          <AlertCircle className="w-16 h-16 text-text-tertiary mx-auto mb-4" />
          <h2 className="font-serif text-xl font-bold mb-2">Something went wrong</h2>
          <p className="text-text-secondary mb-6">{error || "This article doesn't exist."}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => router.back()}
              className="px-6 py-3 bg-elevated text-foreground font-medium rounded-xl hover:bg-elevated/80 transition-opacity"
            >
              Go Back
            </button>
            <button
              onClick={handleForceRefresh}
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-on-primary font-medium rounded-xl hover:opacity-90 transition-opacity"
            >
              <RefreshCw className="w-4 h-4" />
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }


  const category = article.category_id || article.category;
  const originalUrl =
    article.original_url && isValidImageUrl(article.original_url)
      ? article.original_url
      : undefined;
  const showHero = article.image_url && isValidImageUrl(article.image_url) && !heroImageFailed;

  return (
    <ErrorBoundary
      fallback={
        <div className="p-8 text-center text-text-secondary">
          Failed to render article content
        </div>
      }
    >
      <ArticleJsonLd article={article} url={articleUrl} />
      <ReadProgress />

      {/* Bottom padding clears the pinned action bar, so the last paragraph is
          never sitting underneath it. */}
      {/* Bottom padding clears whichever shape the action bar is in: on mobile
          the floating nav pill plus the rail beside it (`--bottom-nav-clearance`
          plus a line of breathing room), on desktop the full-width bar. */}
      <PageContainer
        as="main"
        width="reading"
        className="pb-[calc(var(--bottom-nav-clearance)_+_1rem)] md:pb-28"
      >
        {/* Back control, in the content column rather than pinned to the
            viewport edge: on a wide screen an `absolute left-6` button sits
            hundreds of pixels from the column it acts on and reads as page
            chrome. Share lives in the action bar now, so this row holds one
            control instead of two. */}
        <div className="pt-4">
          <button
            onClick={() => router.back()}
            aria-label="Go back"
            className="inline-flex min-h-[var(--touch-a11y)] min-w-[var(--touch-a11y)] items-center justify-center rounded-full bg-surface text-foreground transition-colors hover:bg-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="py-3">
          <Breadcrumb
            items={[
              ...(category
                ? [{ label: category, href: `/discover?category=${category}` }]
                : []),
              { label: (article.title || "Article").substring(0, 100) },
            ]}
          />
        </div>

        <article>
          {/* Eyebrow: the section, then the two figures a reader uses to decide
              whether to start — how long it takes and how much there is. Both
              are read off the document (`reading_time`, `word_count`) and each
              renders independently, so an article missing one still shows the
              other rather than the whole row vanishing. */}
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            {category && (
              <Link
                href={`/discover?category=${category}`}
                className="inline-flex min-h-[var(--touch-badge)] items-center gap-1.5 rounded-full bg-container-tanzanite px-3 text-xs font-bold uppercase tracking-wider text-on-container-tanzanite focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <Tag className="h-3.5 w-3.5" aria-hidden="true" />
                {category}
              </Link>
            )}
            <ArticleReadingMeta article={article} />
          </div>

          <h1 className="mb-4 font-serif text-3xl font-bold leading-tight text-foreground md:text-[2.75rem] md:leading-[1.15]">
            {article.title}
          </h1>

          {/* The dek — the publisher's own standfirst, in the publisher's
              voice. Skipped when the body just repeats it, which excerpt-only
              RSS sources do by storing the same ~30 words in both fields. */}
          {article.description && !bodyRepeatsDescription(article) && (
            <p className="mb-6 text-lg leading-relaxed text-text-secondary">
              {article.description}
            </p>
          )}

          <ArticleByline article={article} formattedDate={formatDate(article.published_at)} />

          {showHero && (
            <PageBleed className="my-6">
              <img
                src={imageProxyUrl(article.image_url!, { width: 900 })}
                alt=""
                className="aspect-video w-full object-cover sm:rounded-2xl"
                onError={() => setHeroImageFailed(true)}
              />
            </PageBleed>
          )}

          <ArticleSummary summary={article.summary} />

          {/* Body — the pipeline's Markdown rendition where it exists, plain
              paragraphs for legacy articles the Markdown backfill has not
              reached. */}
          {article.content_markdown ? (
            <div className="mb-8">
              <Markdown>{article.content_markdown}</Markdown>
            </div>
          ) : (
            article.content && (
              <div className="prose prose-lg mb-8 max-w-none dark:prose-invert">
                {article.content
                  .split(/\n+/)
                  .map((p) => p.trim())
                  .filter(Boolean)
                  .map((paragraph, index) => (
                    <p key={`${article.id}-p-${index}`} className="mb-4 leading-relaxed">
                      {paragraph}
                    </p>
                  ))}
              </div>
            )
          )}

          {/* Read at the publisher. Mukoko shows what the feed gave it and
              sends the reader on; the traffic belongs to the newsroom that did
              the reporting. */}
          {originalUrl && (
            <a
              href={originalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[var(--touch-hero)] items-center gap-2 rounded-full bg-primary px-6 font-semibold text-on-primary transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <ExternalLink className="h-5 w-5" aria-hidden="true" />
              Continue reading{article.source ? ` at ${article.source}` : ""}
            </a>
          )}

          <ArticleTrustPanel article={article} />

          {/* Topics, as the reader's way onward into the developing story.
              They sit after the body rather than in the header: the header
              answers "should I read this", and by here the reader has. */}
          {article.keywords && article.keywords.length > 0 && (
            <section aria-labelledby="article-topics-heading" className="mt-8">
              <h2
                id="article-topics-heading"
                className="mb-3 font-mono text-xs font-medium uppercase tracking-wider text-text-tertiary"
              >
                Follow the story
              </h2>
              <div className="flex flex-wrap gap-2">
                {article.keywords.slice(0, 6).map((kw) => {
                  const slug = topicSlug(kw.slug || kw.name);
                  if (!slug) return null;
                  return (
                    <Link
                      key={kw.id}
                      href={`/topic/${slug}`}
                      className="inline-flex min-h-[var(--touch-chip)] items-center gap-1.5 rounded-full border border-outline bg-elevated px-3 text-sm text-foreground transition-colors hover:border-primary hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      <Tag className="h-3.5 w-3.5" aria-hidden="true" />
                      {kw.name}
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          <ArticleMetricsPanel article={article} />

          <RelatedArticles articleId={articleId} category={category} />
        </article>
      </PageContainer>

    </ErrorBoundary>
  );
}
