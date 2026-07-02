"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Heart,
  Bookmark,
  Share2,
  ChevronLeft,
  AlertCircle,
  Clock,
  Tag,
  RefreshCw,
  Check,
  ExternalLink,
} from "lucide-react";
import { Markdown } from "@/components/ui/markdown";
import { type Article } from "@/lib/api";
import { getArticleAction } from "@/lib/actions/feed";
import { getArticleUrl } from "@/lib/constants";
import { imageProxyUrl } from "@/lib/image";
import { isValidImageUrl } from "@/lib/utils";
import { ArticlePageSkeleton } from "@/components/ui/skeleton";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { ArticleJsonLd } from "@/components/ui/json-ld";
import { Breadcrumb } from "@/components/ui/breadcrumb";

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
        <div className="text-center bg-surface border border-elevated rounded-2xl p-8 max-w-md">
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
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white font-medium rounded-xl hover:opacity-90 transition-opacity"
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

  return (
    <ErrorBoundary fallback={<div className="p-8 text-center text-text-secondary">Failed to render article content</div>}>
      <ArticleJsonLd article={article} url={articleUrl} />
      <div className="pb-16">
        {/* Breadcrumb */}
        <div className="max-w-[800px] mx-auto px-6 py-3">
          <Breadcrumb
            items={[
              ...(category ? [{ label: category, href: `/discover?category=${category}` }] : []),
              { label: (article.title || "Article").substring(0, 100) },
            ]}
          />
        </div>

        {/* Hero Section */}
        <div className="bg-primary text-white px-6 py-12 relative">
        {/* Back Button */}
        <button
          onClick={() => router.back()}
          className="absolute top-6 left-6 w-10 h-10 flex items-center justify-center bg-background/20 rounded-full hover:bg-background/30 transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        {/* Share Button */}
        <button
          onClick={handleShare}
          className="absolute top-6 right-6 w-10 h-10 flex items-center justify-center bg-background/20 rounded-full hover:bg-background/30 transition-colors"
        >
          <Share2 className="w-5 h-5" />
        </button>

        <div className="max-w-[800px] mx-auto pt-12">
          {/* Category Badge */}
          {(article.category_id || article.category) && (
            <div className="flex items-center gap-2 mb-4">
              <Tag className="w-4 h-4" />
              <span className="text-sm font-bold uppercase tracking-wider">
                {article.category_id || article.category}
              </span>
            </div>
          )}

          {/* Title */}
          <h1 className="font-serif text-3xl md:text-4xl font-bold leading-tight mb-6">
            {article.title}
          </h1>

          {/* Source and Date */}
          <div className="flex items-center gap-4 text-white/80">
            <span className="font-medium">{article.source}</span>
            <span className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              {formatDate(article.published_at)}
            </span>
          </div>
        </div>
      </div>

      {/* Article Image */}
      {article.image_url && isValidImageUrl(article.image_url) && (
        <div className="max-w-[900px] mx-auto px-6 -mt-6">
          <div className="rounded-2xl overflow-hidden shadow-xl">
            <img
              src={imageProxyUrl(article.image_url, { width: 900 })}
              alt={article.title}
              className="w-full aspect-video object-cover"
            />
          </div>
        </div>
      )}

      {/* Article Content */}
      <div className="max-w-[800px] mx-auto px-6 py-8">
        {/* Description */}
        {article.description && (
          <p className="text-lg text-text-secondary leading-relaxed mb-8">
            {article.description}
          </p>
        )}

        {/* Content — prefer the pipeline's Markdown rendition (headings, lists,
            links, emphasis) for a richer reader; fall back to plain paragraphs
            for legacy articles that don't have Markdown yet. */}
        {article.content_markdown ? (
          <div className="mb-8">
            <Markdown>{article.content_markdown}</Markdown>
          </div>
        ) : (
          article.content && (
            <div className="prose prose-lg dark:prose-invert max-w-none mb-8">
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

        {/* Read original — sends the reader to the source article */}
        {article.original_url && isValidImageUrl(article.original_url) && (
          <a
            href={article.original_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-primary text-white font-semibold hover:opacity-90 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <ExternalLink className="w-5 h-5" aria-hidden="true" />
            Read full article{article.source ? ` at ${article.source}` : ""}
          </a>
        )}

        {/* Divider */}
        <div className="border-t border-elevated my-8" />

        {/* Action Buttons */}
        <div className="flex items-center gap-4 flex-wrap">
          <button
            onClick={handleLike}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-colors ${
              isLiked
                ? "bg-red-500/10 text-red-500"
                : "bg-surface text-foreground hover:bg-elevated"
            }`}
          >
            <Heart className={`w-5 h-5 ${isLiked ? "fill-current" : ""}`} />
            <span className="font-medium">{likesCount}</span>
          </button>

          <button
            onClick={handleSave}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-colors ${
              isSaved
                ? "bg-primary/10 text-primary"
                : "bg-surface text-foreground hover:bg-elevated"
            }`}
          >
            <Bookmark className={`w-5 h-5 ${isSaved ? "fill-current" : ""}`} />
            <span className="font-medium">{isSaved ? "Saved" : "Save"}</span>
          </button>

          <button
            onClick={handleShare}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all ml-auto ${
              copySuccess
                ? "bg-success text-white"
                : "bg-primary text-white hover:opacity-90"
            }`}
          >
            {copySuccess ? <Check className="w-5 h-5" /> : <Share2 className="w-5 h-5" />}
            <span className="font-medium">{copySuccess ? "Copied!" : "Share"}</span>
          </button>
        </div>
      </div>
      </div>
    </ErrorBoundary>
  );
}
