import Link from "next/link";
import { Clock } from "lucide-react";
import type { Article } from "@/lib/api";
import { isValidImageUrl, safeCssUrl } from "@/lib/utils";
import { imageProxyUrl } from "@/lib/image";
import { SourceBadge } from "@/components/ui/source-icon";
import { InlineEngagement } from "@/components/ui/engagement-bar";

interface ArticleCardProps {
  article: Article;
}

function formatDate(dateString: string): { day: string; month: string; time: string } {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return { day: "--", month: "---", time: "Recently" };

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    let time = "";
    if (diffHours < 1) time = "Just now";
    else if (diffHours < 24) time = `${diffHours}h ago`;
    else if (diffDays < 7) time = `${diffDays}d ago`;
    else time = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    return {
      day: String(date.getDate()).padStart(2, "0"),
      month: date.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
      time,
    };
  } catch {
    return { day: "--", month: "---", time: "Recently" };
  }
}

export function ArticleCard({ article }: ArticleCardProps) {
  const hasImage = article.image_url && isValidImageUrl(article.image_url);
  const dateInfo = formatDate(article.published_at);

  const coverStyle = hasImage
    ? {
        background: `linear-gradient(135deg, rgba(0,0,0,0.3), rgba(0,0,0,0.6)), ${safeCssUrl(imageProxyUrl(article.image_url!, { width: 800 }))} center/cover`,
      }
    : { background: "linear-gradient(135deg, var(--primary), var(--secondary))" };

  return (
    <Link href={`/article/${article.id}`} className="block">
      <div className="rounded-[var(--radius-card)] overflow-hidden bg-surface cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:shadow-2xl hover:shadow-black/40 border border-border">
        {/* Cover */}
        <div className="h-[180px] relative" style={coverStyle}>
          {/* Date Badge - glassmorphism for image overlay */}
          <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md px-3.5 py-2.5 rounded-xl text-center border border-white/10">
            <div className="text-2xl font-extrabold text-white leading-none">
              {dateInfo.day}
            </div>
            <div className="text-[11px] font-semibold text-white/70 uppercase tracking-wide">
              {dateInfo.month}
            </div>
          </div>

          {/* Category Badge */}
          {(article.category_id || article.category) && (
            <div className="absolute top-4 right-4 bg-secondary text-white px-3 py-1.5 rounded-full text-[11px] font-bold uppercase">
              {article.category_id || article.category}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="p-5">
          <h3 className="text-lg font-bold mb-2.5 leading-tight line-clamp-2">
            {article.title}
          </h3>

          {article.description && (
            <p className="text-sm text-foreground/60 line-clamp-2 mb-4">
              {article.description}
            </p>
          )}

          <div className="flex items-center justify-between">
            <SourceBadge source={article.source} iconSize={18} />

            <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
              <Clock className="w-3.5 h-3.5 text-text-tertiary" />
              <span>{dateInfo.time}</span>
            </div>
          </div>

          {/* Engagement */}
          {(article.likesCount !== undefined || article.commentsCount !== undefined) && (
            <div className="mt-3 pt-3 border-t border-elevated">
              <InlineEngagement
                likesCount={article.likesCount || 0}
                commentsCount={article.commentsCount || 0}
                isLiked={article.isLiked}
              />
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
