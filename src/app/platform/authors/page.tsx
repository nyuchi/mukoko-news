"use client";

import {
  PenTool,
  Link2,
  FileText,
  Globe,
  CheckCircle2,
  ArrowRight,
  Rss,
  Code2,
  BookOpen,
  Shield,
  Newspaper,
  TrendingUp,
} from "lucide-react";

const publishMethods = [
  {
    icon: Rss,
    title: "Connect Your Blog",
    description:
      "Already have a blog or news site? Connect your RSS or Atom feed and we'll automatically sync your articles. Works with WordPress, Ghost, Substack, Medium, and any RSS-enabled site.",
    tag: "Automatic Sync",
    tagColor: "bg-green-500/10 text-green-500",
  },
  {
    icon: Code2,
    title: "API Publishing",
    description:
      "Push articles directly via our REST API with full control over metadata. Schema.org NewsArticle compliant — set headline, author, datePublished, articleBody, and more.",
    tag: "Full Control",
    tagColor: "bg-blue-500/10 text-blue-500",
  },
  {
    icon: FileText,
    title: "Write on Platform",
    description:
      "Don't have your own site? Write and publish articles directly on Mukoko News. Rich text editor with image uploads, categories, and country targeting.",
    tag: "Coming Soon",
    tagColor: "bg-purple-500/10 text-purple-500",
  },
];

const benefits = [
  {
    icon: Globe,
    title: "Reach 16 African Countries",
    description:
      "Your content gets distributed across our Pan-African network reaching readers in Zimbabwe, Kenya, Nigeria, South Africa, and 12 more countries.",
  },
  {
    icon: Shield,
    title: "Schema.org Compliant",
    description:
      "All published content follows JSON-LD NewsArticle standards — compatible with Google News, Apple News, and other news aggregators.",
  },
  {
    icon: TrendingUp,
    title: "Analytics & Insights",
    description:
      "Track how your articles perform with read counts, engagement metrics, and audience demographics across countries.",
  },
  {
    icon: Newspaper,
    title: "Automatic Categorization",
    description:
      "AI-powered content processing automatically categorizes your articles, extracts keywords, and generates quality scores.",
  },
];

const schemaExample = `{
  "@context": "https://schema.org",
  "@type": "NewsArticle",
  "headline": "Your Article Title",
  "author": {
    "@type": "Person",
    "name": "Author Name",
    "url": "https://yoursite.com/author"
  },
  "datePublished": "2026-03-14T10:00:00Z",
  "publisher": {
    "@type": "Organization",
    "name": "Your Publication"
  },
  "articleBody": "Full article content...",
  "articleSection": "Technology",
  "image": "https://yoursite.com/image.jpg"
}`;

const apiExample = `POST /api/articles/publish
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "headline": "Your Article Title",
  "articleBody": "Full article content...",
  "articleSection": "technology",
  "aboutCountryId": "ZW",
  "image": "https://yoursite.com/image.jpg",
  "mainEntityOfPage": "https://yoursite.com/article"
}`;

export default function AuthorsPage() {
  return (
    <div className="max-w-[1000px] mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-12 h-12 rounded-xl bg-purple-500 flex items-center justify-center">
            <PenTool className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Author Portal
            </h1>
            <p className="text-sm text-text-tertiary">
              For independent journalists, bloggers, and writers
            </p>
          </div>
        </div>
        <p className="text-text-secondary max-w-2xl mt-4">
          Publish your articles on Mukoko News — Africa&apos;s open news
          platform. Connect your blog, push via API, or write directly. Like
          Google News or Apple News for independent African voices.
        </p>
      </div>

      {/* How to Publish */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Ways to Publish
        </h2>
        <div className="space-y-4">
          {publishMethods.map((method) => (
            <div
              key={method.title}
              className="p-5 bg-surface rounded-xl border border-border"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <method.icon className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-foreground">
                      {method.title}
                    </h3>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${method.tagColor}`}
                    >
                      {method.tag}
                    </span>
                  </div>
                  <p className="text-sm text-text-secondary">
                    {method.description}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Benefits */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Why Publish on Mukoko News
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {benefits.map((benefit) => (
            <div
              key={benefit.title}
              className="p-5 bg-surface rounded-xl border border-border"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                <benefit.icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground text-sm mb-1">
                {benefit.title}
              </h3>
              <p className="text-xs text-text-secondary">
                {benefit.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Schema.org Reference */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-foreground mb-2">
          Schema.org NewsArticle Format
        </h2>
        <p className="text-sm text-text-secondary mb-4">
          All articles on Mukoko News follow the{" "}
          <a
            href="https://schema.org/NewsArticle"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Schema.org NewsArticle
          </a>{" "}
          specification. Your content is automatically formatted with JSON-LD
          structured data for maximum discoverability.
        </p>
        <div className="overflow-hidden rounded-2xl bg-surface border border-border">
          <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary border-b border-border bg-elevated">
            JSON-LD Example
          </div>
          <div className="p-4">
            <pre className="overflow-x-auto text-sm">
              <code className="font-mono text-text-secondary">
                {schemaExample}
              </code>
            </pre>
          </div>
        </div>
      </section>

      {/* API Reference */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-foreground mb-2">
          API Publishing
        </h2>
        <p className="text-sm text-text-secondary mb-4">
          Push articles directly via our REST API. Requires an author API key
          which you&apos;ll receive after registration.
        </p>
        <div className="overflow-hidden rounded-2xl bg-surface border border-border">
          <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary border-b border-border bg-elevated">
            API Request
          </div>
          <div className="p-4">
            <pre className="overflow-x-auto text-sm">
              <code className="font-mono text-text-secondary">
                {apiExample}
              </code>
            </pre>
          </div>
        </div>
      </section>

      {/* Connect RSS */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-foreground mb-2">
          Connect Your RSS Feed
        </h2>
        <p className="text-sm text-text-secondary mb-4">
          The simplest way to get started — provide your RSS or Atom feed URL
          and we&apos;ll handle the rest.
        </p>
        <div className="p-5 bg-surface rounded-xl border border-border">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
              <input
                type="url"
                placeholder="https://yourblog.com/feed.xml"
                className="w-full pl-10 pr-4 py-3 bg-background border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
              />
            </div>
            <button className="flex items-center justify-center gap-2 px-5 py-3 bg-primary text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity shrink-0">
              <Rss className="w-4 h-4" />
              Connect Feed
            </button>
          </div>
          <div className="mt-3 flex items-start gap-2 text-xs text-text-tertiary">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              Supports RSS 2.0, Atom, and JSON Feed. Works with WordPress,
              Ghost, Substack, Hugo, Jekyll, and more.
            </span>
          </div>
        </div>
      </section>

      {/* Get Started CTA */}
      <section className="p-6 bg-gradient-to-r from-primary/10 via-secondary/10 to-accent/10 rounded-2xl border border-primary/20">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
            <BookOpen className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground mb-1">
              Ready to publish?
            </h3>
            <p className="text-sm text-text-secondary mb-3">
              Register as an author on Mukoko News to start publishing your
              articles to readers across Africa. It&apos;s free for independent
              writers.
            </p>
            <button className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity">
              <PenTool className="w-4 h-4" />
              Register as Author
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
