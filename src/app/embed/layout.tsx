import type { Metadata } from "next";
import { getFullUrl } from "@/lib/constants";
import { getLiveCoverageAction } from "@/lib/actions/coverage";

// Async: the coverage claim is a live count, resolved through unstable_cache
// so this stays a cached read and the route stays statically renderable.
export async function generateMetadata(): Promise<Metadata> {
  const coverage = await getLiveCoverageAction();
  return {
    title: "Embed Location News Cards",
    description:
      `Add live, location-based African news to any website or app. Embeddable news cards for top stories, featured content and local news — ${coverage.fragment}. Free, no API key required.`,
    alternates: {
      canonical: getFullUrl("/embed"),
    },
    openGraph: {
      title: "Embed Location News Cards | Mukoko News",
      description:
        "Embeddable news cards for top stories, featured content, and location-based African news. Free widget for any website.",
      url: getFullUrl("/embed"),
      type: "website",
    },
    twitter: {
      card: "summary",
      title: "Embed Location News Cards | Mukoko News",
      description:
        "Embeddable news cards for top stories, featured content, and location-based African news. Free widget for any website.",
      creator: "@mukokoafrica",
      site: "@mukokoafrica",
    },
  };
}

export default function EmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
