import type { Metadata } from "next";
import { getFullUrl, COVERAGE_FRAGMENT } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Embed Location News Cards",
  description:
    `Add live, location-based African news to any website or app. Embeddable news cards for top stories, featured content and local news — ${COVERAGE_FRAGMENT}. Free, no API key required.`,
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

export default function EmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
