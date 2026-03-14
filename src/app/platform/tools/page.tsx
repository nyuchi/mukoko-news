"use client";

import Link from "next/link";
import {
  MonitorPlay,
  Code2,
  Rss,
  ChevronRight,
  Wrench,
  Globe,
  Zap,
  Shield,
} from "lucide-react";

const tools = [
  {
    href: "/platform/tools/embed",
    icon: MonitorPlay,
    title: "Embed Widgets",
    description:
      "Add live, location-based African news to any website or app. 5 layouts, 4 feed types, 16 countries — no API key required.",
    features: [
      "Cards, compact, hero, ticker, and list layouts",
      "Filter by country, category, and feed type",
      "Auto-refresh every 5 minutes",
      "Sandboxed iframes for security",
    ],
    color: "bg-green-500",
    status: "Available",
    statusColor: "bg-green-500/10 text-green-500",
  },
  {
    href: "/platform/tools/mcp",
    icon: Code2,
    title: "MCP Server",
    description:
      "Model Context Protocol server for AI-powered workflows. Query articles, search news, and publish content directly from Claude, Cursor, or any MCP-compatible client.",
    features: [
      "Search articles by keyword, country, category",
      "Get trending topics and stories",
      "Browse news sources and categories",
      "Publish articles via AI assistant",
    ],
    color: "bg-orange-500",
    status: "Available",
    statusColor: "bg-orange-500/10 text-orange-500",
  },
  {
    href: "/platform/tools/rss",
    icon: Rss,
    title: "RSS Feeds",
    description:
      "Subscribe to curated RSS feeds from Mukoko News. Filter by country, category, or get the full firehose — compatible with any feed reader.",
    features: [
      "Country-specific feeds for all 16 countries",
      "Category feeds (politics, sports, tech, economy, etc.)",
      "Combined feed with all articles",
      "Standard RSS 2.0 format",
    ],
    color: "bg-blue-500",
    status: "Available",
    statusColor: "bg-blue-500/10 text-blue-500",
  },
];

const highlights = [
  {
    icon: Globe,
    title: "16 African Countries",
    description: "Content from Zimbabwe, Kenya, Nigeria, South Africa, and 12 more",
  },
  {
    icon: Zap,
    title: "Real-time Updates",
    description: "Articles indexed within minutes of publication",
  },
  {
    icon: Shield,
    title: "Schema.org Compliant",
    description: "All content follows NewsArticle JSON-LD standards",
  },
];

export default function ToolsPage() {
  return (
    <div className="max-w-[1000px] mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <Wrench className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Platform Tools
            </h1>
            <p className="text-sm text-text-tertiary">
              Integrate Mukoko News into your workflow
            </p>
          </div>
        </div>
        <p className="text-text-secondary max-w-2xl mt-4">
          Embed live news feeds, connect via MCP for AI workflows, or subscribe
          to RSS feeds — all free, no API key required for read access.
        </p>
      </div>

      {/* Highlights */}
      <div className="grid grid-cols-3 gap-4 mb-10">
        {highlights.map((h) => (
          <div
            key={h.title}
            className="flex items-center gap-3 p-4 bg-surface rounded-xl border border-border"
          >
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <h.icon className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{h.title}</p>
              <p className="text-xs text-text-tertiary">{h.description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tools */}
      <div className="space-y-6">
        {tools.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            className="block p-6 bg-surface rounded-2xl border border-border hover:border-primary/30 transition-colors group"
          >
            <div className="flex items-start gap-4">
              <div
                className={`w-12 h-12 rounded-xl ${tool.color} flex items-center justify-center shrink-0`}
              >
                <tool.icon className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-lg font-semibold text-foreground">
                    {tool.title}
                  </h2>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${tool.statusColor}`}
                  >
                    {tool.status}
                  </span>
                  <ChevronRight className="w-4 h-4 text-text-tertiary group-hover:text-primary transition-colors ml-auto" />
                </div>
                <p className="text-sm text-text-secondary mb-3">
                  {tool.description}
                </p>
                <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {tool.features.map((feature) => (
                    <li
                      key={feature}
                      className="text-xs text-text-tertiary flex items-center gap-1.5"
                    >
                      <span className="w-1 h-1 rounded-full bg-primary/50 shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
