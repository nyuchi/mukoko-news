import { cache } from "react";
import type { Metadata } from "next";
import { getArticleById } from "@/lib/mongodb/articles";
import { getArticleUrl, BASE_URL } from "@/lib/constants";
import { isValidImageUrl } from "@/lib/utils";
import ArticleDetailClient from "./article-detail-client";

interface Props {
  params: Promise<{ id: string }>;
}

// ISR: cache each article's rendered HTML for 5 minutes — article content only
// changes when the pipeline (re-)enriches it, so this removes the per-view
// MongoDB read without meaningful staleness. Nothing in this page reads
// cookies()/headers(), so the route stays cacheable.
export const revalidate = 300;

const fetchArticle = cache(async (id: string) => {
  try {
    return await getArticleById(id);
  } catch (error) {
    console.error("[ArticlePage] Failed to fetch article:", id, error);
    return null;
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const article = await fetchArticle(id);

  if (!article) {
    return { title: "Article Not Found" };
  }

  const articleUrl = getArticleUrl(id);
  const description =
    article.description ||
    `Read "${article.title}" — latest news from ${article.source} on Mukoko News.`;

  const hasValidImage = isValidImageUrl(article.image_url);

  return {
    title: article.title,
    description,
    authors: article.source ? [{ name: article.source }] : undefined,
    openGraph: {
      title: article.title,
      description,
      url: articleUrl,
      type: "article",
      publishedTime: article.published_at,
      section: article.category_id || article.category || undefined,
      siteName: "Mukoko News",
      images: hasValidImage
        ? [
            {
              url: article.image_url!,
              alt: article.title,
            },
          ]
        : [
            {
              url: `${BASE_URL}/mukoko-icon-dark.png`,
              width: 512,
              height: 512,
              alt: "Mukoko News",
            },
          ],
    },
    twitter: {
      card: hasValidImage ? "summary_large_image" : "summary",
      title: article.title,
      description,
      site: "@mukokoafrica",
      images: hasValidImage ? [article.image_url!] : undefined,
      creator: "@mukokoafrica",
    },
    alternates: {
      canonical: articleUrl,
    },
    robots: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  };
}

export default async function ArticleDetailPage({ params }: Props) {
  const { id } = await params;
  const article = await fetchArticle(id);
  return <ArticleDetailClient articleId={id} initialArticle={article} />;
}
