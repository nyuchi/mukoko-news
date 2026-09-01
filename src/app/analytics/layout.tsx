import type { Metadata } from "next";
import { getFullUrl } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Analytics",
  description:
    "Query the Mukoko News corpus directly — any topic, any African country, any window. Volume over time, who is covering it, topics, named entities, sentiment and source concentration, computed live and exportable as CSV.",
  alternates: { canonical: getFullUrl("/analytics") },
  openGraph: {
    title: "Analytics | Mukoko News",
    description:
      "Query African news coverage by topic, country and date. Volume, sources, topics, entities, sentiment and coverage concentration.",
    url: getFullUrl("/analytics"),
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Analytics | Mukoko News",
    description: "Query African news coverage by topic, country and date — live from the Mukoko News corpus.",
    creator: "@mukokoafrica",
  },
};

export default function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
