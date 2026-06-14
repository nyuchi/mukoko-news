import type { Metadata } from "next";
import { getFullUrl } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Analytics",
  description:
    "Open data analytics from Mukoko News — trending topics, surge alerts, and content breakdowns across 16 African countries.",
  alternates: { canonical: getFullUrl("/analytics") },
  openGraph: {
    title: "Open Analytics | Mukoko News",
    description:
      "Trending topics, surge detection, and content breakdowns across African news.",
    url: getFullUrl("/analytics"),
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Open Analytics | Mukoko News",
    description: "Trending topics and surge alerts from Mukoko News.",
    creator: "@mukokoafrica",
  },
};

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
