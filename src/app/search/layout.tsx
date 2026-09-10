import type { Metadata } from "next";
import { getFullUrl } from "@/lib/constants";
import { getLiveCoverageAction } from "@/lib/actions/coverage";

// Async: the coverage claim is a live count, resolved through unstable_cache
// so this stays a cached read and the route stays statically renderable.
export async function generateMetadata(): Promise<Metadata> {
  const coverage = await getLiveCoverageAction();
  return {
    title: "Search",
    description:
      `Search African news articles, topics and sources on Mukoko News. AI-powered semantic search — ${coverage.fragment}.`,
    alternates: {
      canonical: getFullUrl("/search"),
    },
    openGraph: {
      title: "Search African News | Mukoko News",
      description:
        `Search articles, topics and sources — ${coverage.fragment}.`,
      url: getFullUrl("/search"),
      type: "website",
    },
    twitter: {
      card: "summary",
      title: "Search African News | Mukoko News",
      description:
        `Search articles, topics and sources — ${coverage.fragment}.`,
      creator: "@mukokoafrica",
    },
  };
}

export default function SearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
