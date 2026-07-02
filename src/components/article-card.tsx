"use client";

import Link from "next/link";
import Image from "next/image";
import { Clock } from "lucide-react";
import type { Article } from "@/lib/api";
import { isValidImageUrl, formatTimeAgo } from "@/lib/utils";
import { mukokoImageLoader } from "@/lib/image";
import { SourceBadge } from "@/components/ui/source-icon";
import { InlineEngagement } from "@/components/ui/engagement-bar";

interface ArticleCardProps {
  article: Article;
}

/**
 * Modern news card: clean cover image (routed through the image-worker proxy),
 * a category eyebrow, a 2-line title, a short dek, and a source · time meta row.
 * No date-stamp overlay or dark image wash — the image reads as itself and the
 * metadata lives in the content well, the way contemporary news feeds present it.
 */
export function ArticleCard({ article }: ArticleCardProps) {
  const hasImage = article.image_url && isValidImageUrl(article.image_url);
  const category = article.category_id || article.category;
  const timeAgo = formatTimeAgo(article.published_at);
  const hasEngagement =
    article.likesCount !== undefined || article.commentsCount !== undefined;

  return (
    <Link
      href={`/article/${article.id}`}
      className="group block rounded-[var(--radius-card)] overflow-hidden bg-surface border border-border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      aria-label={`Read article: ${article.title}`}
    >
      {/* Cover */}
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-elevated">
        {hasImage ? (
          <Image
            loader={mukokoImageLoader}
            src={article.image_url!}
            alt=""
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 400px"
          />
        ) : (
          <div
            className="absolute inset-0 bg-gradient-to-br from-container-tanzanite to-container-sodalite"
            aria-hidden="true"
          />
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        {category && (
          <span className="text-[11px] font-bold uppercase tracking-wider text-secondary">
            {category}
          </span>
        )}

        <h3 className="text-base font-bold leading-snug line-clamp-2 mt-1 mb-2 group-hover:underline decoration-2 underline-offset-2">
          {article.title}
        </h3>

        {article.description && (
          <p className="text-sm text-text-secondary line-clamp-2 mb-3">
            {article.description}
          </p>
        )}

        <div className="flex items-center justify-between">
          <SourceBadge source={article.source} iconSize={18} />

          <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{timeAgo}</span>
          </div>
        </div>

        {/* Engagement */}
        {hasEngagement && (
          <div className="mt-3 pt-3 border-t border-elevated">
            <InlineEngagement
              likesCount={article.likesCount || 0}
              commentsCount={article.commentsCount || 0}
              isLiked={article.isLiked}
            />
          </div>
        )}
      </div>
    </Link>
  );
}
