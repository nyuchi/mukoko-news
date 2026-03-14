"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Building2,
  Search,
  CheckCircle2,
  Clock,
  ExternalLink,
  Radio,
  Loader2,
  AlertCircle,
  ArrowRight,
  Plug,
  Shield,
  BarChart3,
  Zap,
  Globe,
} from "lucide-react";
import { fetchAPI } from "@/lib/api";
import { SourceIcon } from "@/components/ui/source-icon";

interface NewsSource {
  id: string;
  name: string;
  url: string;
  about_country_id?: string;
  article_section_id?: string;
  article_count?: number;
  is_active?: boolean;
  claimed?: boolean;
}

const claimSteps = [
  {
    icon: Search,
    title: "Find Your Source",
    description:
      "Search for your news source in our directory. If it's already being aggregated, you can claim it.",
  },
  {
    icon: Shield,
    title: "Verify Ownership",
    description:
      "Prove ownership by adding a DNS TXT record or meta tag to your website. We verify automatically.",
  },
  {
    icon: Plug,
    title: "Connect Your API",
    description:
      "Once verified, connect your content API for direct sync. Supports REST, RSS, and Atom feeds.",
  },
  {
    icon: BarChart3,
    title: "Manage & Monitor",
    description:
      "Access analytics, control content appearance, manage article metadata, and track performance.",
  },
];

const apiFeatures = [
  {
    icon: Zap,
    title: "Direct API Sync",
    description:
      "Skip RSS — push articles directly via our REST API with full control over metadata and schema.org fields.",
  },
  {
    icon: Globe,
    title: "Multi-Country Publishing",
    description:
      "Publish to any of our 16 supported African countries. Content is automatically categorized and indexed.",
  },
  {
    icon: Shield,
    title: "Schema.org Compliant",
    description:
      "All content follows NewsArticle schema.org standards. Full JSON-LD support for SEO and discovery.",
  },
];

export default function PublishersPage() {
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const loadSources = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchAPI<{ sources: NewsSource[] }>("/api/sources");
      setSources(data.sources || []);
    } catch {
      // Sources may fail to load - that's ok
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  const filteredSources = sources.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.url.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-[1000px] mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 rounded-xl bg-blue-500 flex items-center justify-center">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Publisher Portal
            </h1>
            <p className="text-sm text-text-tertiary">
              For news organizations and media houses
            </p>
          </div>
        </div>
        <p className="text-text-secondary max-w-2xl mt-4">
          Claim ownership of your news source on Mukoko News. Connect your API
          for direct content sync, manage how your articles appear, and access
          publisher analytics — like Google News Publisher Center for Africa.
        </p>
      </div>

      {/* How It Works */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          How It Works
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {claimSteps.map((step, i) => (
            <div
              key={step.title}
              className="relative p-5 bg-surface rounded-xl border border-border"
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                  {i + 1}
                </div>
                <step.icon className="w-4 h-4 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground text-sm mb-1">
                {step.title}
              </h3>
              <p className="text-xs text-text-secondary">{step.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* API Features */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Publisher API Features
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {apiFeatures.map((feature) => (
            <div
              key={feature.title}
              className="p-5 bg-surface rounded-xl border border-border"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                <feature.icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground text-sm mb-1">
                {feature.title}
              </h3>
              <p className="text-xs text-text-secondary">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Source Directory */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">
            News Source Directory
          </h2>
          <span className="text-sm text-text-tertiary">
            {sources.length} sources
          </span>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
          <input
            type="text"
            placeholder="Search sources by name or URL..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-surface border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
          />
        </div>

        {/* Source List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : filteredSources.length === 0 ? (
          <div className="text-center py-12 bg-surface rounded-xl border border-border">
            <AlertCircle className="w-8 h-8 text-text-tertiary mx-auto mb-3" />
            <p className="text-text-secondary text-sm">
              {search ? "No sources match your search" : "No sources found"}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredSources.slice(0, 20).map((source) => (
              <div
                key={source.id}
                className="flex items-center gap-4 p-4 bg-surface rounded-xl border border-border hover:border-primary/30 transition-colors"
              >
                <SourceIcon
                  source={source.name}
                  size={36}
                  className="rounded-lg shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-foreground text-sm truncate">
                      {source.name}
                    </h3>
                    {source.claimed && (
                      <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-text-tertiary mt-0.5">
                    <span className="truncate">{source.url}</span>
                    {source.article_count !== undefined && (
                      <>
                        <span className="text-border">·</span>
                        <span>{source.article_count} articles</span>
                      </>
                    )}
                  </div>
                </div>

                {source.claimed ? (
                  <span className="text-xs font-medium text-green-500 bg-green-500/10 px-2.5 py-1 rounded-full shrink-0">
                    Claimed
                  </span>
                ) : (
                  <button className="flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 px-3 py-1.5 rounded-full transition-colors shrink-0">
                    <span>Claim</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}

            {filteredSources.length > 20 && (
              <p className="text-center text-sm text-text-tertiary py-3">
                Showing 20 of {filteredSources.length} sources
              </p>
            )}
          </div>
        )}
      </section>

      {/* Not Listed CTA */}
      <section className="p-6 bg-surface rounded-2xl border border-border">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Radio className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground mb-1">
              Source not listed?
            </h3>
            <p className="text-sm text-text-secondary mb-3">
              If your news source isn&apos;t in our directory yet, you can
              submit it for review. We&apos;ll add your RSS feed and you can
              claim ownership once it&apos;s live.
            </p>
            <button className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity">
              <Building2 className="w-4 h-4" />
              Submit Your Source
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
