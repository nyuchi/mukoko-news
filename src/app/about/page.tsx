"use client";

import Link from "next/link";
import { Globe, Zap, Users, ChevronRight } from "lucide-react";
import { PreferredSourceCard } from "@/components/preferred-source-button";
import { useCoverage } from "@/contexts/coverage-context";

function buildValues(liveCount: number, scopeTotal: number) {
  return [
    {
      icon: Globe,
      title: "Pan-African by design",
      description:
        `News from across the continent in one place — live in ${liveCount} African countries today, with all ${scopeTotal} African Union member states in scope and local sources at the centre.`,
    },
    {
      icon: Zap,
      title: "Fast, clean reading",
      description:
        "AI-assisted summaries, categories, and a distraction-free reader let you catch up quickly and dive deeper only where you want to.",
    },
    {
      icon: Users,
      title: "Community-first",
      description:
        "“Mukoko” means beehive in Shona — where the community gathers and stores knowledge. The platform is built to serve African readers first.",
    },
  ];
}

export default function AboutPage() {
  // Read from the context the root layout seeded, so this paragraph, the page
  // title and the JSON-LD all state the same number on the same render.
  const coverage = useCoverage();
  const values = buildValues(coverage.count, coverage.scopeTotal);
  return (
    <div className="mx-auto w-full max-w-[var(--width-reading)] px-[var(--page-gutter)] sm:px-[var(--page-gutter-sm)] py-[var(--page-block-reading)]">
      <h1 className="text-3xl font-bold text-foreground mb-2">About Mukoko News</h1>
      <p className="text-text-secondary mb-8">
        A Pan-African digital news aggregation platform bringing the continent&rsquo;s stories
        together.
      </p>

      {/* Mission */}
      <div className="p-6 bg-primary/10 rounded-xl mb-12">
        <h2 className="font-semibold text-foreground mb-2">Our mission</h2>
        <p className="text-text-secondary text-sm leading-relaxed">
          Mukoko News aggregates trusted journalism from across Africa and makes it fast and easy to
          follow. &ldquo;Mukoko&rdquo; means <span className="italic">beehive</span> in Shona &mdash;
          a place where the community gathers and stores knowledge. We started in Zimbabwe and are
          live in {coverage.count} African countries today. The remaining{" "}
          {coverage.scopeTotal - coverage.count} African Union member states are in scope
          and coming soon &mdash; we would rather say where we are not yet than claim a continent we
          have not reached. Local voices and local sources stay at the heart of the feed.
        </p>
      </div>

      {/* What we're about */}
      <h2 className="text-xl font-bold text-foreground mb-6">What we&rsquo;re about</h2>
      <div className="space-y-4 mb-12">
        {values.map((value) => (
          <div key={value.title} className="flex items-start gap-4 p-4 bg-surface rounded-xl">
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center shrink-0">
              <value.icon className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-foreground">{value.title}</p>
              <p className="text-sm text-text-secondary leading-relaxed">{value.description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Google Preferred Sources. This page is the one surface where it earns
          its place: a reader here is deciding what they think of the
          publication. The control itself loads no third-party script until it
          is hovered, focused or tapped. */}
      <div className="mb-12">
        <PreferredSourceCard />
      </div>

      {/* Links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          href="/help"
          className="flex items-center justify-between p-4 bg-surface rounded-xl hover:bg-elevated transition-colors"
        >
          <span className="font-medium text-foreground">Help Center</span>
          <ChevronRight className="w-5 h-5 text-text-tertiary" />
        </Link>
        <Link
          href="https://mukoko.com"
          target="_blank"
          className="flex items-center justify-between p-4 bg-surface rounded-xl hover:bg-elevated transition-colors"
        >
          <span className="font-medium text-foreground">A Mukoko Product</span>
          <ChevronRight className="w-5 h-5 text-text-tertiary" />
        </Link>
      </div>
    </div>
  );
}
