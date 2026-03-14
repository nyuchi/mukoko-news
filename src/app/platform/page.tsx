"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Building2,
  PenTool,
  Newspaper,
  Radio,
  TrendingUp,
  Users,
  MonitorPlay,
  Code2,
  Rss,
  ChevronRight,
  Loader2,
  ArrowUpRight,
} from "lucide-react";

const quickActions = [
  {
    href: "/platform/publishers",
    icon: Building2,
    title: "Claim a News Source",
    description: "Register as the owner of a news source and manage your feed",
    color: "bg-blue-500",
  },
  {
    href: "/platform/authors",
    icon: PenTool,
    title: "Publish as Author",
    description: "Connect your blog or write directly on the platform",
    color: "bg-purple-500",
  },
  {
    href: "/platform/tools/embed",
    icon: MonitorPlay,
    title: "Embed News Widget",
    description: "Add live news feeds to your website or app",
    color: "bg-green-500",
  },
  {
    href: "/platform/tools/mcp",
    icon: Code2,
    title: "MCP Server",
    description: "Connect your content pipeline via Model Context Protocol",
    color: "bg-orange-500",
  },
];

const platformFeatures = [
  {
    icon: Building2,
    title: "Publisher Portal",
    description:
      "News organizations can claim their source, connect their API for direct content sync, and manage how their articles appear on Mukoko News.",
    href: "/platform/publishers",
  },
  {
    icon: PenTool,
    title: "Author Portal",
    description:
      "Independent journalists and bloggers can connect their personal sites or publish directly. Schema.org compliant — like Google News or Apple News.",
    href: "/platform/authors",
  },
  {
    icon: MonitorPlay,
    title: "Embed Widgets",
    description:
      "Embeddable news cards for any website. 5 layouts, 4 feed types, 16 countries. No API key required.",
    href: "/platform/tools/embed",
  },
  {
    icon: Code2,
    title: "MCP Server",
    description:
      "Model Context Protocol server for AI-powered content pipelines. Plug your news feed directly into Mukoko News.",
    href: "/platform/tools/mcp",
  },
  {
    icon: Rss,
    title: "RSS Feeds",
    description:
      "Subscribe to curated RSS feeds from Mukoko News. Filter by country, category, or topic.",
    href: "/platform/tools/rss",
  },
];

export default function PlatformDashboard() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<{
    articles: number;
    sources: number;
    authors: number;
    countries: number;
  } | null>(null);

  useEffect(() => {
    // Simulated stats - would come from API
    const timer = setTimeout(() => {
      setStats({
        articles: 12450,
        sources: 56,
        authors: 34,
        countries: 16,
      });
      setLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-[1000px] mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">
          Mukoko News Platform
        </h1>
        <p className="text-text-secondary max-w-2xl">
          The Pan-African news infrastructure. Publish, distribute, and embed
          news content across 16 African countries — compliant with Schema.org
          and JSON-LD standards.
        </p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          {[
            {
              icon: Newspaper,
              value: stats.articles.toLocaleString(),
              label: "Articles",
              color: "text-blue-500",
              bg: "bg-blue-500/10",
            },
            {
              icon: Radio,
              value: stats.sources.toString(),
              label: "News Sources",
              color: "text-green-500",
              bg: "bg-green-500/10",
            },
            {
              icon: Users,
              value: stats.authors.toString(),
              label: "Authors",
              color: "text-purple-500",
              bg: "bg-purple-500/10",
            },
            {
              icon: TrendingUp,
              value: stats.countries.toString(),
              label: "Countries",
              color: "text-orange-500",
              bg: "bg-orange-500/10",
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-surface rounded-xl p-5 border border-border"
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className={`w-10 h-10 rounded-lg ${stat.bg} flex items-center justify-center`}
                >
                  <stat.icon className={`w-5 h-5 ${stat.color}`} />
                </div>
                <div className="text-2xl font-bold text-foreground">
                  {stat.value}
                </div>
              </div>
              <p className="text-sm text-text-secondary">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Super App Banner */}
      <div className="mb-10 p-5 rounded-2xl bg-gradient-to-r from-primary/10 via-secondary/10 to-accent/10 border border-primary/20">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
            <ArrowUpRight className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground mb-1">
              Full news experience in the Mukoko App
            </h3>
            <p className="text-sm text-text-secondary">
              Interactive feeds, NewsBytes, personalized content, saved articles,
              and more — available in the main Mukoko super app.
            </p>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Get Started
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {quickActions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="flex items-center p-5 bg-surface rounded-xl border border-border hover:border-primary/50 transition-colors group"
            >
              <div
                className={`w-12 h-12 rounded-xl ${action.color} flex items-center justify-center mr-4 shrink-0`}
              >
                <action.icon className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-foreground">
                  {action.title}
                </h3>
                <p className="text-sm text-text-secondary line-clamp-1">
                  {action.description}
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-text-tertiary group-hover:text-primary transition-colors shrink-0" />
            </Link>
          ))}
        </div>
      </section>

      {/* Platform Features */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Platform Services
        </h2>
        <div className="space-y-4">
          {platformFeatures.map((feature) => (
            <Link
              key={feature.href}
              href={feature.href}
              className="block p-5 bg-surface rounded-xl border border-border hover:border-primary/30 transition-colors group"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <feature.icon className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground">
                      {feature.title}
                    </h3>
                    <ChevronRight className="w-4 h-4 text-text-tertiary group-hover:text-primary transition-colors" />
                  </div>
                  <p className="text-sm text-text-secondary mt-1">
                    {feature.description}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
