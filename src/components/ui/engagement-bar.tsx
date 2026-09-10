"use client";

import { Heart, MessageCircle, Share2, Bookmark } from "lucide-react";

interface EngagementBarProps {
  isLiked?: boolean;
  isSaved?: boolean;
  likesCount?: number;
  commentsCount?: number;
  onLike?: () => void;
  onSave?: () => void;
  onShare?: () => void;
  onComment?: () => void;
  layout?: "horizontal" | "vertical";
  variant?: "light" | "dark";
  size?: "sm" | "md";
}

export function EngagementBar({
  isLiked = false,
  isSaved = false,
  likesCount = 0,
  commentsCount = 0,
  onLike,
  onSave,
  onShare,
  onComment,
  layout = "horizontal",
  variant = "light",
  size = "md",
}: EngagementBarProps) {
  const iconSize = size === "sm" ? 18 : 22;
  const buttonSize = size === "sm" ? "w-9 h-9" : "w-11 h-11";
  const textSize = size === "sm" ? "text-[10px]" : "text-xs";

  const formatCount = (count: number) => {
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
    return count;
  };

  const bgClass = variant === "dark"
    ? "bg-white/10 border-white/20 hover:bg-white/20"
    : "bg-surface border-elevated hover:bg-elevated";

  const textClass = variant === "dark" ? "text-white" : "text-text-secondary";
  const accentClass = "text-primary";

  return (
    <div
      className={`flex items-center ${
        layout === "vertical" ? "flex-col gap-4" : "gap-3"
      }`}
    >
      {/* Like */}
      {onLike && (
        <button
          onClick={onLike}
          className="flex flex-col items-center gap-1"
          aria-label={isLiked ? "Unlike" : "Like"}
        >
          <div
            className={`${buttonSize} rounded-full flex items-center justify-center border transition-colors ${bgClass}`}
          >
            <Heart
              size={iconSize}
              className={isLiked ? "fill-destructive text-destructive" : textClass}
            />
          </div>
          {likesCount > 0 && (
            <span className={`${textSize} font-medium ${isLiked ? accentClass : textClass}`}>
              {formatCount(likesCount)}
            </span>
          )}
        </button>
      )}

      {/* Comment */}
      {onComment && (
        <button
          onClick={onComment}
          className="flex flex-col items-center gap-1"
          aria-label="Comments"
        >
          <div
            className={`${buttonSize} rounded-full flex items-center justify-center border transition-colors ${bgClass}`}
          >
            <MessageCircle size={iconSize} className={textClass} />
          </div>
          {commentsCount > 0 && (
            <span className={`${textSize} font-medium ${textClass}`}>
              {formatCount(commentsCount)}
            </span>
          )}
        </button>
      )}

      {/* Share */}
      {onShare && (
        <button
          onClick={onShare}
          className="flex flex-col items-center gap-1"
          aria-label="Share"
        >
          <div
            className={`${buttonSize} rounded-full flex items-center justify-center border transition-colors ${bgClass}`}
          >
            <Share2 size={iconSize} className={textClass} />
          </div>
          <span className={`${textSize} font-medium ${textClass}`}>Share</span>
        </button>
      )}

      {/* Save */}
      {onSave && (
        <button
          onClick={onSave}
          className="flex flex-col items-center gap-1"
          aria-label={isSaved ? "Unsave" : "Save"}
        >
          <div
            className={`${buttonSize} rounded-full flex items-center justify-center border transition-colors ${bgClass}`}
          >
            <Bookmark
              size={iconSize}
              className={isSaved ? "fill-primary text-primary" : textClass}
            />
          </div>
        </button>
      )}
    </div>
  );
}

// Compact inline version for article cards
interface InlineEngagementProps {
  likesCount?: number;
  commentsCount?: number;
  isLiked?: boolean;
  onLike?: () => void;
  className?: string;
}

export function InlineEngagement({
  likesCount = 0,
  commentsCount = 0,
  isLiked = false,
  onLike,
  className = "",
}: InlineEngagementProps) {
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <button
        onClick={onLike}
        className="flex items-center gap-1.5 text-text-secondary hover:text-primary transition-colors"
        aria-label={isLiked ? "Unlike" : "Like"}
      >
        <Heart
          size={16}
          className={isLiked ? "fill-destructive text-destructive" : ""}
        />
        <span className="text-xs font-medium">{likesCount}</span>
      </button>
      <div className="flex items-center gap-1.5 text-text-secondary">
        <MessageCircle size={16} />
        <span className="text-xs font-medium">{commentsCount}</span>
      </div>
    </div>
  );
}
