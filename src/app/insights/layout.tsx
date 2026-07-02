import type { Metadata } from "next";
import { getFullUrl } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Open Data & Insights",
  description:
    "A live, public analytics dashboard for African news. Publishing volume, media-organization leaderboard, topic and country coverage, and sentiment — computed from the Mukoko News corpus and free to download as open data (JSON/CSV).",
  alternates: {
    canonical: getFullUrl("/insights"),
  },
  openGraph: {
    title: "Open Data & Insights | Mukoko News",
    description:
      "Public analytics for African news: publishing volume, source leaderboard, topic and country coverage, sentiment. Open data, free to download.",
    url: getFullUrl("/insights"),
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Open Data & Insights | Mukoko News",
    description:
      "Public analytics for African news, computed from the corpus. Open data, free to download.",
    creator: "@mukokoafrica",
  },
};

export default function InsightsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
