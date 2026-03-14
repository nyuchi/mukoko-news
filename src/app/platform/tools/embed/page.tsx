"use client";

import Link from "next/link";
import {
  MonitorPlay,
  ExternalLink,
  Code2,
  Layout,
  Globe,
  Palette,
} from "lucide-react";
import { BASE_URL, COUNTRIES } from "@/lib/constants";

const layouts = [
  { name: "Cards Grid", value: "cards", description: "Visual card grid with images" },
  { name: "Hero Card", value: "hero", description: "Single featured story, large image" },
  { name: "Compact List", value: "compact", description: "Text-focused, minimal footprint" },
  { name: "Ticker", value: "ticker", description: "Horizontal scrollable strip" },
  { name: "Thumbnail List", value: "list", description: "Classic list with thumbnails" },
];

const feedTypes = [
  { name: "Top Stories", value: "top", description: "Trending articles" },
  { name: "Featured", value: "featured", description: "Popular articles" },
  { name: "Latest", value: "latest", description: "Newest articles" },
  { name: "Location", value: "location", description: "Local/country news" },
];

export default function ToolsEmbedPage() {
  return (
    <div className="max-w-[1000px] mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 rounded-xl bg-green-500 flex items-center justify-center">
            <MonitorPlay className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Embed Widgets
            </h1>
            <p className="text-sm text-text-tertiary">
              Add live African news to any website
            </p>
          </div>
        </div>
        <p className="text-text-secondary max-w-2xl mt-4">
          Embeddable news cards for any website or app. 5 layouts, 4 feed types,
          16 countries — free, no API key required. Ideal for publishers who
          want to cross-promote Mukoko News content.
        </p>
      </div>

      {/* Quick Start */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-foreground mb-3">
          Quick Start
        </h2>
        <p className="text-sm text-text-secondary mb-3">
          Drop this snippet anywhere in your HTML:
        </p>
        <div className="overflow-hidden rounded-2xl bg-surface border border-border">
          <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary border-b border-border bg-elevated">
            HTML
          </div>
          <div className="p-4">
            <pre className="overflow-x-auto text-sm">
              <code className="font-mono text-text-secondary">{`<!-- Mukoko News Embed -->
<div data-mukoko-embed
     data-country="ZW"
     data-type="top"
     data-layout="cards">
</div>
<script src="${BASE_URL}/embed/widget.js" async></script>`}</code>
            </pre>
          </div>
        </div>
      </section>

      {/* Layouts */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <Layout className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">
            Available Layouts
          </h2>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {layouts.map((layout) => (
            <div
              key={layout.value}
              className="p-4 bg-surface rounded-xl border border-border"
            >
              <p className="font-semibold text-foreground text-sm">
                {layout.name}
              </p>
              <p className="text-xs text-text-tertiary mt-0.5">
                {layout.description}
              </p>
              <code className="text-[10px] font-mono text-primary mt-2 block">
                data-layout=&quot;{layout.value}&quot;
              </code>
            </div>
          ))}
        </div>
      </section>

      {/* Feed Types */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <Code2 className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Feed Types</h2>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {feedTypes.map((type) => (
            <div
              key={type.value}
              className="p-4 bg-surface rounded-xl border border-border"
            >
              <p className="font-semibold text-foreground text-sm">
                {type.name}
              </p>
              <p className="text-xs text-text-tertiary mt-0.5">
                {type.description}
              </p>
              <code className="text-[10px] font-mono text-primary mt-2 block">
                data-type=&quot;{type.value}&quot;
              </code>
            </div>
          ))}
        </div>
      </section>

      {/* Countries */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <Globe className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">
            Supported Countries
          </h2>
        </div>
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
          {COUNTRIES.map((c) => (
            <div
              key={c.code}
              className="flex flex-col items-center gap-1 p-2 rounded-xl bg-surface border border-border text-center"
            >
              <span className="text-lg">{c.flag}</span>
              <span className="text-[10px] font-semibold">{c.code}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Theming */}
      <section className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <Palette className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Theming</h2>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {["light", "dark", "auto"].map((theme) => (
            <div
              key={theme}
              className="p-4 bg-surface rounded-xl border border-border text-center"
            >
              <p className="font-semibold text-foreground text-sm capitalize">
                {theme}
              </p>
              <code className="text-[10px] font-mono text-primary mt-1 block">
                data-theme=&quot;{theme}&quot;
              </code>
            </div>
          ))}
        </div>
      </section>

      {/* Full Documentation Link */}
      <section className="p-6 bg-surface rounded-2xl border border-border">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
            <MonitorPlay className="w-5 h-5 text-green-500" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground mb-1">
              Full Documentation & Live Examples
            </h3>
            <p className="text-sm text-text-secondary mb-3">
              See live previews of all 5 layouts, iframe embed examples, and
              detailed parameter reference.
            </p>
            <Link
              href="/embed"
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <ExternalLink className="w-4 h-4" />
              View Embed Documentation
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
