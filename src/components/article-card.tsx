"use client";

import type { Article } from "@/lib/api";
import { isValidImageUrl, formatTimeAgo } from "@/lib/utils";
import { imageProxyUrl } from "@/lib/image";
import { NyuchiArticleCard } from "@/components/brand/nyuchi-article-card";
import { SourceBadge } from "@/components/ui/source-icon";
import { InlineEngagement } from "@/components/ui/engagement-bar";

interface ArticleCardProps {
  article: Article;
  /** Position in the feed — drives the harness stagger animation */
  index?: number;
}

/**
 * Mukoko feed card = the canonical Mzizi N3 brand component
 * (nyuchi-article-card, compact variant) fed from our Article shape:
 * proxied cover image, category eyebrow, favicon source badge in the
 * sourceSlot, relative time, and the engagement bar in the footer slot.
 */
export function ArticleCard({ article, index }: ArticleCardProps) {
  const hasImage = article.image_url && isValidImageUrl(article.image_url);
  const category = article.category_id || article.category;
  const hasEngagement =
    article.likesCount !== undefined || article.commentsCount !== undefined;

  return (
    <NyuchiArticleCard
      variant="compact"
      href={`/article/${article.id}`}
      title={article.title}
      excerpt={article.description}
      image={hasImage ? imageProxyUrl(article.image_url!, { width: 600 }) : undefined}
      category={category}
      publishedAt={formatTimeAgo(article.published_at)}
      index={index}
      sourceSlot={<SourceBadge source={article.source} iconSize={16} />}
      footer={
        hasEngagement ? (
          <div className="mt-3 pt-3 border-t border-elevated">
            <InlineEngagement
              likesCount={article.likesCount || 0}
              commentsCount={article.commentsCount || 0}
              isLiked={article.isLiked}
            />
          </div>
        ) : undefined
      }
    />
  );
}
