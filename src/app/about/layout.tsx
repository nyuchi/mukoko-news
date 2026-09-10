import type { Metadata } from "next";
import { getFullUrl } from "@/lib/constants";

// /about is a client component and cannot export metadata itself, so it lives
// here — matching the convention used by /discover, /categories and /sources.
export const metadata: Metadata = {
  title: "About",
  description:
    "Mukoko News is a Pan-African news aggregator built for African readers. “Mukoko” means beehive in Shona — where the community gathers and stores knowledge.",
  alternates: {
    canonical: getFullUrl("/about"),
  },
  openGraph: {
    title: "About Mukoko News",
    description:
      "A Pan-African news aggregator built for African readers, starting in Zimbabwe.",
    url: getFullUrl("/about"),
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "About Mukoko News",
    description: "A Pan-African news aggregator built for African readers.",
    creator: "@mukokoafrica",
  },
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
