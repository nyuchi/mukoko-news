"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  TrendingUp,
  Zap,
  Globe,
  Layers,
  Newspaper,
  Radio,
  RefreshCw,
  Loader2,
} from "lucide-react";

const COUNTRY_NAMES: Record<string, string> = {
  ZW: "Zimbabwe",
  KE: "Kenya",
  ZA: "South Africa",
  NG: "Nigeria",
  GH: "Ghana",
  EG: "Egypt",
  ET: "Ethiopia",
  TZ: "Tanzania",
  UG: "Uganda",
  RW: "Rwanda",
  SN: "Senegal",
  CI: "Côte d'Ivoire",
  CM: "Cameroon",
  MA: "Morocco",
  TN: "Tunisia",
  AO: "Angola",
};

const CATEGORY_EMOJIS: Record<string, string> = {
  politics: "🏛️",
  business: "💼",
  sports: "⚽",
  entertainment: "🎬",
  technology: "💻",
  health: "🏥",
  world: "🌍",
  local: "📍",
  opinion: "💭",
  breaking: "⚡",
  crime: "🚨",
  education: "📚",
  environment: "🌱",
  lifestyle: "✨",
  agriculture: "🌾",
  mining: "⛏️",
  tourism: "✈️",
  finance: "💰",
  culture: "🎭",
};

const getEmoji = (cat: string) => CATEGORY_EMOJIS[cat?.toLowerCase()] ?? "📰";

interface TrendingTopic {
  tag_id: string;
  name: string;
  slug: string;
  count: number;
}

interface SurgeAlert {
  tag: string;
  recent_24h: number;
  daily_avg: number;
  multiplier: number;
}

interface CountryItem {
  country: string;
  count: number;
}

interface CategoryItem {
  category: string;
  count: number;
}

interface AnalyticsData {
  meta: { generated_at: string; total_articles: number; active_sources: number };
  trending_topics: TrendingTopic[];
  surge_alerts: SurgeAlert[];
  country_breakdown: CountryItem[];
  category_breakdown: CategoryItem[];
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch("/api/analytics");
      if (res.ok) setData(await res.json());
    } catch {
      // analytics are best-effort
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  const maxCountry = data?.country_breakdown[0]?.count ?? 1;
  const maxCategory = data?.category_breakdown[0]?.count ?? 1;

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8 space-y-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-1">Open Analytics</h1>
          <p className="text-text-secondary text-sm">
            Real-time data across African news — no paywall, no account required.
          </p>
          {data && (
            <p className="text-xs text-text-tertiary mt-1">
              Updated {new Date(data.meta.generated_at).toLocaleTimeString()}
            </p>
          )}
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface border border-elevated text-sm text-foreground hover:border-primary/50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Stats row */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { icon: <Newspaper className="w-5 h-5" />, label: "Articles", value: data.meta.total_articles.toLocaleString() },
            { icon: <Radio className="w-5 h-5" />, label: "Active Sources", value: data.meta.active_sources.toLocaleString() },
            { icon: <TrendingUp className="w-5 h-5" />, label: "Trending Topics", value: data.trending_topics.length },
            { icon: <Zap className="w-5 h-5" />, label: "Surge Alerts", value: data.surge_alerts.length },
          ].map(({ icon, label, value }) => (
            <div key={label} className="bg-surface rounded-2xl p-5 border border-elevated">
              <div className="text-primary mb-2">{icon}</div>
              <div className="text-2xl font-bold text-foreground">{value}</div>
              <div className="text-xs text-text-secondary mt-1">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Surge Alerts */}
      {data && data.surge_alerts.length > 0 && (
        <section>
          <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" /> Surge Alerts
            <span className="ml-2 text-xs font-normal text-text-secondary">
              Topics with 2× higher volume in the last 24 h
            </span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.surge_alerts.map((s) => (
              <div
                key={s.tag}
                className="flex items-center gap-4 bg-surface rounded-xl p-4 border border-elevated"
              >
                <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                  <Zap className="w-5 h-5 text-amber-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground truncate">{s.tag}</p>
                  <p className="text-xs text-text-secondary">
                    {s.recent_24h} articles in 24 h · avg {s.daily_avg}/day
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className="text-lg font-bold text-amber-500">{s.multiplier}×</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Trending Topics */}
      {data && data.trending_topics.length > 0 && (
        <section>
          <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" /> Trending Topics
            <span className="ml-2 text-xs font-normal text-text-secondary">Last 7 days</span>
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {data.trending_topics.slice(0, 12).map((t, i) => (
              <Link
                key={t.tag_id}
                href={`/search?q=${encodeURIComponent(t.name)}`}
                className="bg-surface rounded-xl p-4 border border-elevated hover:border-primary/50 transition-colors"
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-2xl">{getEmoji(t.name)}</span>
                  {i < 3 && (
                    <span className="w-6 h-6 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                  )}
                </div>
                <p className="font-semibold text-foreground truncate text-sm">{t.name}</p>
                <p className="text-xs text-text-secondary mt-1">{t.count} articles</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Two-column: Country + Category */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Country breakdown */}
        {data && data.country_breakdown.length > 0 && (
          <section className="bg-surface rounded-2xl border border-elevated p-6">
            <h2 className="text-lg font-bold text-foreground mb-5 flex items-center gap-2">
              <Globe className="w-5 h-5 text-primary" /> By Country
              <span className="ml-2 text-xs font-normal text-text-secondary">30 days</span>
            </h2>
            <div className="space-y-3">
              {data.country_breakdown.map(({ country, count }) => (
                <div key={country}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-foreground font-medium">
                      {COUNTRY_NAMES[country] ?? country}
                    </span>
                    <span className="text-text-secondary">{count.toLocaleString()}</span>
                  </div>
                  <div className="h-2 bg-elevated rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${Math.round((count / maxCountry) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Category breakdown */}
        {data && data.category_breakdown.length > 0 && (
          <section className="bg-surface rounded-2xl border border-elevated p-6">
            <h2 className="text-lg font-bold text-foreground mb-5 flex items-center gap-2">
              <Layers className="w-5 h-5 text-primary" /> By Category
              <span className="ml-2 text-xs font-normal text-text-secondary">30 days</span>
            </h2>
            <div className="space-y-3">
              {data.category_breakdown.map(({ category, count }) => (
                <div key={category}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-foreground font-medium flex items-center gap-1">
                      {getEmoji(category)} {category}
                    </span>
                    <span className="text-text-secondary">{count.toLocaleString()}</span>
                  </div>
                  <div className="h-2 bg-elevated rounded-full overflow-hidden">
                    <div
                      className="h-full bg-secondary rounded-full transition-all"
                      style={{ width: `${Math.round((count / maxCategory) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Open data notice */}
      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-6 text-center">
        <p className="text-sm text-text-secondary">
          Mukoko News operates under an{" "}
          <strong className="text-foreground">open data policy</strong> — these analytics
          are freely available to journalists, researchers, and the public.
          Access programmatically at{" "}
          <code className="bg-surface px-1.5 py-0.5 rounded text-xs font-mono">
            /api/analytics
          </code>{" "}
          or via our{" "}
          <Link href="https://news.mukoko.dev/mcp" className="text-primary underline underline-offset-2">
            MCP server
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
