"use client";

import { COUNTRIES } from "@/lib/constants";
import { Rss, Globe, Tag, Newspaper, Copy, CheckCircle2 } from "lucide-react";
import { useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://mukoko-news-api.fly.dev";

const categoryFeeds = [
  "politics",
  "economy",
  "sports",
  "technology",
  "health",
  "entertainment",
  "education",
  "environment",
];

function FeedUrl({
  label,
  url,
  description,
}: {
  label: string;
  url: string;
  description?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      if (!navigator.clipboard) {
        const textArea = document.createElement("textarea");
        textArea.value = url;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      } else {
        await navigator.clipboard.writeText(url);
      }
      setCopied(true);
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    } catch {
      // Copy failed silently
    }
  };

  return (
    <div className="p-4 bg-surface rounded-xl border border-border">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-primary transition-colors"
        >
          {copied ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
              <span className="text-green-500">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      {description && (
        <p className="text-xs text-text-tertiary mb-2">{description}</p>
      )}
      <code className="text-xs font-mono text-primary break-all">{url}</code>
    </div>
  );
}

export default function ToolsRssPage() {
  return (
    <div className="max-w-[1000px] mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 rounded-xl bg-blue-500 flex items-center justify-center">
            <Rss className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">RSS Feeds</h1>
            <p className="text-sm text-text-tertiary">
              Subscribe to Mukoko News in any feed reader
            </p>
          </div>
        </div>
        <p className="text-text-secondary max-w-2xl mt-4">
          Get Mukoko News articles delivered to your feed reader, website, or
          app via standard RSS 2.0 feeds. Filter by country, category, or
          subscribe to everything.
        </p>
      </div>

      {/* Main Feed */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <Newspaper className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Main Feed</h2>
        </div>
        <FeedUrl
          label="All Articles"
          url={`${API_BASE}/api/feeds/rss`}
          description="Everything from all sources, all countries — the full firehose"
        />
      </section>

      {/* Country Feeds */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <Globe className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">
            Country Feeds
          </h2>
        </div>
        <p className="text-sm text-text-secondary mb-4">
          Subscribe to news from a specific country:
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {COUNTRIES.map((country) => (
            <FeedUrl
              key={country.code}
              label={`${country.flag} ${country.name}`}
              url={`${API_BASE}/api/feeds/rss?country=${country.code}`}
            />
          ))}
        </div>
      </section>

      {/* Category Feeds */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <Tag className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">
            Category Feeds
          </h2>
        </div>
        <p className="text-sm text-text-secondary mb-4">
          Subscribe to a specific news category:
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {categoryFeeds.map((cat) => (
            <FeedUrl
              key={cat}
              label={cat.charAt(0).toUpperCase() + cat.slice(1)}
              url={`${API_BASE}/api/feeds/rss?category=${cat}`}
            />
          ))}
        </div>
      </section>

      {/* Combined Filters */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-foreground mb-3">
          Combined Filters
        </h2>
        <p className="text-sm text-text-secondary mb-4">
          Combine country and category for targeted feeds:
        </p>
        <div className="space-y-3">
          <FeedUrl
            label="Zimbabwe Sports"
            url={`${API_BASE}/api/feeds/rss?country=ZW&category=sports`}
            description="Sports news from Zimbabwe"
          />
          <FeedUrl
            label="Kenya Technology"
            url={`${API_BASE}/api/feeds/rss?country=KE&category=technology`}
            description="Tech news from Kenya"
          />
          <FeedUrl
            label="Nigeria Politics"
            url={`${API_BASE}/api/feeds/rss?country=NG&category=politics`}
            description="Political news from Nigeria"
          />
        </div>
      </section>

      {/* Usage */}
      <section className="p-6 bg-surface rounded-2xl border border-border">
        <h3 className="font-semibold text-foreground mb-3">
          How to Use
        </h3>
        <ul className="space-y-2 text-sm text-text-secondary">
          <li className="flex items-start gap-2">
            <span className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-bold text-primary mt-0.5">
              1
            </span>
            <span>
              Copy any feed URL above and paste it into your feed reader
              (Feedly, Inoreader, NetNewsWire, etc.)
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-bold text-primary mt-0.5">
              2
            </span>
            <span>
              Combine query parameters for custom feeds:{" "}
              <code className="text-primary font-mono text-xs">
                ?country=ZW&category=sports&limit=20
              </code>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-xs font-bold text-primary mt-0.5">
              3
            </span>
            <span>
              Feeds update in real-time as new articles are published. No API
              key required.
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}
