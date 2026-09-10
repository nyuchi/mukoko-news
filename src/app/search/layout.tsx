import type { Metadata } from "next";
import { getFullUrl, COVERAGE_FRAGMENT } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Search",
  description:
    `Search African news articles, topics and sources on Mukoko News. AI-powered semantic search — ${COVERAGE_FRAGMENT}.`,
  alternates: {
    canonical: getFullUrl("/search"),
  },
  openGraph: {
    title: "Search African News | Mukoko News",
    description:
      `Search articles, topics and sources — ${COVERAGE_FRAGMENT}.`,
    url: getFullUrl("/search"),
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Search African News | Mukoko News",
    description:
      `Search articles, topics and sources — ${COVERAGE_FRAGMENT}.`,
    creator: "@mukokoafrica",
  },
};

export default function SearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
