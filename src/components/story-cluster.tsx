"use client";

import Link from "next/link";
import { Clock, Layers, ChevronRight } from "lucide-react";
import type { StoryCluster as StoryClusterType } from "@/lib/api";
import { isValidImageUrl, safeCssUrl, formatTimeAgo } from "@/lib/utils";
import { imageProxyUrl } from "@/lib/image";
import { SourceIcon } from "@/components/ui/source-icon";

interface StoryClusterProps {
  cluster: StoryClusterType;
}

export function StoryCluster({ cluster }: StoryClusterProps) {
  const { primaryArticle, relatedArticles, articleCount } = cluster;
  const hasImage = primaryArticle.image_url && isValidImageUrl(primaryArticle.image_url);
  const hasRelated = relatedArticles.length > 0;
  const timeAgo = formatTimeAgo(primaryArticle.published_at);

  return (
    <div className="rounded-[var(--radius-card)] overflow-hidden bg-surface border border-border">
      {/* Primary Article */}
      <Link href={`/article/${primaryArticle.id}`} className="block group">
        {/* Image */}
        {hasImage && (
          <div
            className="h-[200px] sm:h-[240px] relative bg-elevated"
            style={{
              background: `linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.7)), ${safeCssUrl(imageProxyUrl(primaryArticle.image_url!, { width: 800 }))} center/cover`,
            }}
          >
            {/* Category Badge */}
            {(primaryArticle.category_id || primaryArticle.category) && (
              <div className="absolute top-3 left-3 bg-black/70 text-white backdrop-blur-sm px-2.5 py-1 rounded-full text-[10px] font-bold uppercase">
                {primaryArticle.category_id || primaryArticle.category}
              </div>
            )}
          </div>
        )}

        {/* Content */}
        <div className="p-4">
          {/* Source and Time */}
          <div className="flex items-center gap-2 mb-2">
            <SourceIcon source={primaryArticle.source} size={16} showBorder={false} />
            <span className="text-xs font-medium text-text-secondary">{primaryArticle.source}</span>
            <span className="text-text-tertiary">·</span>
            <time className="flex items-center gap-1 text-xs text-text-tertiary" dateTime={primaryArticle.published_at}>
              <Clock className="w-3 h-3" aria-hidden="true" />
              <span>{timeAgo}</span>
            </time>
          </div>

          {/* Title */}
          <h3 className="text-lg font-bold leading-tight line-clamp-2 group-hover:underline decoration-2 underline-offset-2">
            {primaryArticle.title}
          </h3>

          {/* Description */}
          {primaryArticle.description && (
            <p className="text-sm text-text-secondary mt-2 line-clamp-2">
              {primaryArticle.description}
            </p>
          )}
        </div>
      </Link>

      {/* Related Articles (from different sources) */}
      {hasRelated && (
        <div className="border-t border-border">
          {relatedArticles.slice(0, 2).map((article) => (
            <Link
              key={article.id}
              href={`/article/${article.id}`}
              className="flex items-start gap-3 p-3 hover:bg-elevated transition-colors border-b border-border last:border-b-0"
            >
              {/* Thumbnail */}
              {article.image_url && isValidImageUrl(article.image_url) && (
                <div
                  className="w-16 h-16 flex-shrink-0 rounded-lg bg-elevated"
                  style={{
                    background: `${safeCssUrl(imageProxyUrl(article.image_url, { width: 400 }))} center/cover`,
                  }}
                />
              )}

              <div className="flex-1 min-w-0">
                {/* Source */}
                <div className="flex items-center gap-2 mb-1">
                  <SourceIcon source={article.source} size={12} showBorder={false} />
                  <span className="text-[11px] font-medium text-text-tertiary">{article.source}</span>
                </div>

                {/* Title */}
                <h4 className="text-sm font-medium leading-snug line-clamp-2 hover:underline decoration-2 underline-offset-2">
                  {article.title}
                </h4>

                {/* Time */}
                <time className="text-[11px] text-text-tertiary mt-1 block" dateTime={article.published_at}>
                  {formatTimeAgo(article.published_at)}
                </time>
              </div>
            </Link>
          ))}

          {/* Full Coverage Link - searches for related stories */}
          {articleCount > 2 && (
            <Link
              href={`/search?q=${encodeURIComponent(primaryArticle.title.split(' ').slice(0, 5).join(' '))}`}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-primary hover:bg-elevated transition-colors"
              aria-label={`View full coverage: ${articleCount} sources covering this story`}
            >
              <Layers className="w-4 h-4" aria-hidden="true" />
              Full Coverage · {articleCount} sources
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// Smaller variant for horizontal scrolling
export function StoryClusterCompact({ cluster }: StoryClusterProps) {
  const { primaryArticle, articleCount } = cluster;
  const hasImage = primaryArticle.image_url && isValidImageUrl(primaryArticle.image_url);
  const timeAgo = formatTimeAgo(primaryArticle.published_at);

  return (
    <Link
      href={`/article/${primaryArticle.id}`}
      className="block w-[280px] flex-shrink-0 rounded-xl overflow-hidden bg-surface border border-border hover:border-primary/60 transition-colors"
    >
      {/* Image */}
      {hasImage && (
        <div
          className="h-[140px] relative"
          style={{
            background: `${safeCssUrl(imageProxyUrl(primaryArticle.image_url!, { width: 800 }))} center/cover`,
          }}
        >
          {articleCount > 1 && (
            <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/70 backdrop-blur-sm text-white px-2 py-1 rounded-full text-[10px] font-medium">
              <Layers className="w-3 h-3" />
              {articleCount}
            </div>
          )}
        </div>
      )}

      <div className="p-3">
        {/* Source */}
        <div className="flex items-center gap-2 mb-1.5">
          <SourceIcon source={primaryArticle.source} size={14} showBorder={false} />
          <span className="text-[11px] font-medium text-text-tertiary">{primaryArticle.source}</span>
          <span className="text-text-tertiary">·</span>
          <span className="text-[11px] text-text-tertiary">{timeAgo}</span>
        </div>

        {/* Title */}
        <h3 className="text-sm font-semibold leading-snug line-clamp-2">
          {primaryArticle.title}
        </h3>
      </div>
    </Link>
  );
}
