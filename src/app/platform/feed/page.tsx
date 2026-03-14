"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ExternalLink,
  Loader2,
  RefreshCw,
  Clock,
  AlertCircle,
} from "lucide-react";
import { api, type Article } from "@/lib/api";
import { isValidImageUrl, formatTimeAgo } from "@/lib/utils";
import { SourceIcon } from "@/components/ui/source-icon";

function FeedItem({ article }: { article: Article }) {
  const hasImage = article.image && isValidImageUrl(article.image);
  const snippet = article.article_body
    ? article.article_body.slice(0, 160).replace(/<[^>]*>/g, "") + "..."
    : null;

  return (
    <a
      href={article.main_entity_of_page || `/article/${article.id}`}
      target={article.main_entity_of_page ? "_blank" : undefined}
      rel={article.main_entity_of_page ? "noopener noreferrer" : undefined}
      className="flex gap-4 p-4 bg-surface rounded-xl border border-border hover:border-primary/30 transition-colors group"
    >
      {/* Image */}
      {hasImage && (
        <div className="w-24 h-24 sm:w-32 sm:h-24 rounded-lg overflow-hidden shrink-0 bg-elevated">
          <img
            src={article.image!}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-foreground line-clamp-2 group-hover:text-primary transition-colors text-sm sm:text-base">
          {article.headline}
        </h3>

        {snippet && (
          <p className="text-xs text-text-tertiary mt-1 line-clamp-2 hidden sm:block">
            {snippet}
          </p>
        )}

        <div className="flex items-center gap-2 mt-2 text-xs text-text-tertiary">
          {article.publisher_name && (
            <div className="flex items-center gap-1.5">
              <SourceIcon
                source={article.publisher_name}
                size={14}
                className="rounded"
              />
              <span className="font-medium text-text-secondary">
                {article.publisher_name}
              </span>
            </div>
          )}
          {article.date_published && (
            <>
              <span className="text-border">·</span>
              <span>{formatTimeAgo(article.date_published)}</span>
            </>
          )}
          {article.article_section_id && (
            <>
              <span className="text-border">·</span>
              <span className="capitalize">{article.article_section_id}</span>
            </>
          )}
          {article.main_entity_of_page && (
            <ExternalLink className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </div>
      </div>
    </a>
  );
}

export default function PlatformFeedPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadFeed = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getArticles({ limit: 30 });
      setArticles(data.articles || []);
    } catch {
      setError("Failed to load feed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  return (
    <div className="max-w-[720px] mx-auto px-4 sm:px-6 py-6">
      {/* Super App Banner */}
      <div className="mb-6 p-4 rounded-2xl bg-gradient-to-r from-primary/10 via-secondary/10 to-accent/10 border border-primary/20">
        <div className="flex items-center gap-3">
          <ArrowUpRight className="w-5 h-5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">
              Full interactive experience available in the{" "}
              <Link href="/" className="text-primary hover:underline">
                Mukoko App
              </Link>
            </p>
            <p className="text-xs text-text-tertiary mt-0.5">
              Personalized feeds, NewsBytes, saved articles, and more
            </p>
          </div>
        </div>
      </div>

      {/* Feed Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-foreground">Latest News</h1>
          <p className="text-xs text-text-tertiary mt-0.5">
            Pan-African news from {articles.length > 0 ? `${articles.length}` : ""} sources
          </p>
        </div>
        <button
          onClick={loadFeed}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-surface border border-border rounded-xl hover:bg-elevated transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* Loading */}
      {loading && articles.length === 0 && (
        <div className="space-y-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={`skeleton-${i}`}
              className="flex gap-4 p-4 bg-surface rounded-xl border border-border animate-pulse"
            >
              <div className="w-24 h-24 sm:w-32 sm:h-24 rounded-lg bg-elevated shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-elevated rounded w-3/4" />
                <div className="h-3 bg-elevated rounded w-full" />
                <div className="h-3 bg-elevated rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertCircle className="w-8 h-8 text-text-tertiary" />
          <p className="text-text-secondary">{error}</p>
          <button
            onClick={loadFeed}
            className="px-4 py-2 text-sm bg-primary text-white rounded-xl hover:opacity-90"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Feed */}
      {!loading && !error && (
        <div className="space-y-3">
          {articles.map((article) => (
            <FeedItem key={article.id} article={article} />
          ))}

          {articles.length === 0 && (
            <div className="text-center py-12">
              <Clock className="w-8 h-8 text-text-tertiary mx-auto mb-3" />
              <p className="text-text-secondary">No articles yet</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
