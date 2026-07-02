"use client";

import type { Article } from "@/lib/api";
import { isValidImageUrl, formatTimeAgo } from "@/lib/utils";
import { imageProxyUrl } from "@/lib/image";
import { NyuchiArticleCard } from "@/components/brand/nyuchi-article-card";
import { SourceBadge } from "@/components/ui/source-icon";

interface CompactCardProps {
  article: Article;
  /** Position in the list — drives the harness stagger animation */
  index?: number;
}

/**
 * Sidebar/list card = the canonical Mzizi N3 brand component
 * (nyuchi-article-card, row variant): title + source + time with a
 * small proxied thumbnail on the right.
 */
export function CompactCard({ article, index }: CompactCardProps) {
  const hasImage = article.image_url && isValidImageUrl(article.image_url);
  const category = article.category_id || article.category;

  return (
    <NyuchiArticleCard
      variant="row"
      href={`/article/${article.id}`}
      title={article.title}
      image={hasImage ? imageProxyUrl(article.image_url!, { width: 200 }) : undefined}
      category={category}
      publishedAt={formatTimeAgo(article.published_at)}
      index={index}
      sourceSlot={<SourceBadge source={article.source} iconSize={14} />}
    />
  );
}
