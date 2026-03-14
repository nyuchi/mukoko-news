import { cache } from "react";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { getArticleUrl, BASE_URL } from "@/lib/constants";
import { isValidImageUrl } from "@/lib/utils";
import ArticleDetailClient from "./article-detail-client";

interface Props {
  params: Promise<{ id: string }>;
}

const fetchArticle = cache(async (id: string) => {
  try {
    const data = await api.getArticle(id);
    return data.article || null;
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
    `Read "${article.headline}" — latest news from ${article.publisher_name} on Mukoko News.`;

  const hasValidImage = isValidImageUrl(article.image);

  return {
    title: article.headline,
    description,
    authors: article.publisher_name ? [{ name: article.publisher_name }] : undefined,
    openGraph: {
      title: article.headline,
      description,
      url: articleUrl,
      type: "article",
      publishedTime: article.date_published,
      section: article.article_section_id || undefined,
      siteName: "Mukoko News",
      images: hasValidImage
        ? [
            {
              url: article.image!,
              alt: article.headline,
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
      title: article.headline,
      description,
      site: "@mukokoafrica",
      images: hasValidImage ? [article.image!] : undefined,
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
