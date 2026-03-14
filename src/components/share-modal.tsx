"use client";

import { useState, useEffect } from "react";
import { X, Link, Check, Twitter, Facebook, Linkedin, MessageCircle, Share2 } from "lucide-react";
import type { Article } from "@/lib/api";

interface ShareModalProps {
  article: Article | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ShareModal({ article, isOpen, onClose }: ShareModalProps) {
  const [copied, setCopied] = useState(false);

  // Reset copied state when modal closes
  useEffect(() => {
    if (!isOpen) setCopied(false);
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      window.addEventListener("keydown", handleEscape);
      return () => window.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen, onClose]);

  if (!isOpen || !article) return null;

  const shareUrl = `${window.location.origin}/article/${article.id}`;
  const shareTitle = article.headline;
  const shareText = `${shareTitle}\n\nRead on Mukoko News`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        onClose();
      }, 1500);
    } catch (error) {
      console.error("Copy error:", error);
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl,
        });
        onClose();
      } catch (error) {
        // User cancelled or error
      }
    }
  };

  const handleShareTwitter = () => {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(url, "_blank", "width=600,height=400");
    onClose();
  };

  const handleShareWhatsApp = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${shareUrl}`)}`;
    window.open(url, "_blank");
    onClose();
  };

  const handleShareFacebook = () => {
    const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
    window.open(url, "_blank", "width=600,height=400");
    onClose();
  };

  const handleShareLinkedIn = () => {
    const url = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;
    window.open(url, "_blank", "width=600,height=400");
    onClose();
  };

  const shareOptions = [
    { icon: Twitter, label: "Twitter", onClick: handleShareTwitter, color: "hover:bg-[#1DA1F2]/10 hover:text-[#1DA1F2]" },
    { icon: Facebook, label: "Facebook", onClick: handleShareFacebook, color: "hover:bg-[#1877F2]/10 hover:text-[#1877F2]" },
    { icon: MessageCircle, label: "WhatsApp", onClick: handleShareWhatsApp, color: "hover:bg-[#25D366]/10 hover:text-[#25D366]" },
    { icon: Linkedin, label: "LinkedIn", onClick: handleShareLinkedIn, color: "hover:bg-[#0A66C2]/10 hover:text-[#0A66C2]" },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-surface rounded-t-3xl sm:rounded-3xl overflow-hidden animate-in slide-in-from-bottom duration-300">
        {/* Handle bar (mobile) */}
        <div className="w-12 h-1 rounded-full bg-text-tertiary/30 mx-auto mt-3 sm:hidden" />

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-elevated">
          <h2 className="text-lg font-semibold text-foreground">Share Article</h2>
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-elevated transition-colors"
          >
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        {/* Article Preview */}
        <div className="p-4 border-b border-elevated">
          <p className="font-medium text-foreground line-clamp-2">{article.headline}</p>
          <p className="text-sm text-text-secondary mt-1">{article.publisher_name}</p>
        </div>

        {/* Share Options */}
        <div className="p-4">
          <div className="grid grid-cols-4 gap-3 mb-4">
            {shareOptions.map((option) => (
              <button
                key={option.label}
                onClick={option.onClick}
                className={`flex flex-col items-center gap-2 p-3 rounded-xl transition-colors ${option.color}`}
              >
                <option.icon className="w-6 h-6" />
                <span className="text-xs font-medium">{option.label}</span>
              </button>
            ))}
          </div>

          {/* Copy Link */}
          <button
            onClick={handleCopyLink}
            className="w-full flex items-center justify-center gap-2 p-3 bg-elevated rounded-xl font-medium transition-colors hover:bg-primary/10"
          >
            {copied ? (
              <>
                <Check className="w-5 h-5 text-green-500" />
                <span className="text-green-500">Copied!</span>
              </>
            ) : (
              <>
                <Link className="w-5 h-5 text-text-secondary" />
                <span className="text-foreground">Copy Link</span>
              </>
            )}
          </button>

          {/* Native Share (if supported) */}
          {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
            <button
              onClick={handleNativeShare}
              className="w-full flex items-center justify-center gap-2 p-3 mt-3 bg-primary text-white rounded-xl font-medium transition-opacity hover:opacity-90"
            >
              <Share2 className="w-5 h-5" />
              <span>More Options</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
