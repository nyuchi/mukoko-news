import type { Article } from "@/lib/api";
import {
  BASE_URL,
  getFullUrl,
  getArticleUrl,
  COVERAGE_FRAGMENT,
  RELEASED_COUNTRY_COUNT,
  COUNTRY_SCOPE_TOTAL,
} from "@/lib/constants";
import { toExcerpt } from "@/lib/excerpt";

interface NewsArticleSchema {
  "@context": "https://schema.org";
  "@type": "NewsArticle";
  headline: string;
  description?: string;
  /**
   * An EXCERPT of the article — never the publisher's full text.
   *
   * This carried `article.content`, which is the complete body of someone
   * else's reporting, emitted machine-readable on Mukoko's own origin. It
   * earned nothing (no `NewsArticle` rich result reads `articleBody`; the
   * appearance comes from `headline`/`description`/`datePublished` and the
   * rendered page), it duplicated the largest payload on the page for readers
   * on metered mobile data, and it let an answer engine satisfy a reader
   * end-to-end without the newsroom that wrote it ever being fetched.
   *
   * Bounded by `ARTICLE_EXCERPT_MAX_CHARS`; omitted entirely when the only text
   * available is the description, which `description` already carries.
   */
  articleBody?: string;
  image?: string | { "@type": "ImageObject"; url: string; width?: number; height?: number };
  datePublished: string;
  dateModified?: string;
  author: {
    "@type": "Person" | "Organization";
    name: string;
    url?: string;
  };
  publisher: {
    "@type": "Organization";
    name: string;
    logo: {
      "@type": "ImageObject";
      url: string;
    };
  };
  mainEntityOfPage: {
    "@type": "WebPage";
    "@id": string;
  };
  isAccessibleForFree: boolean;
  inLanguage: string;
  keywords?: string;
  articleSection?: string;
  wordCount?: number;
}

interface BreadcrumbSchema {
  "@context": "https://schema.org";
  "@type": "BreadcrumbList";
  itemListElement: Array<{
    "@type": "ListItem";
    position: number;
    name: string;
    item?: string;
  }>;
}

interface ItemListSchema {
  "@context": "https://schema.org";
  "@type": "ItemList";
  name?: string;
  description?: string;
  numberOfItems: number;
  itemListElement: Array<{
    "@type": "ListItem";
    position: number;
    item: {
      "@type": "NewsArticle";
      "@id": string;
      headline: string;
      description?: string;
      image?: string;
      datePublished: string;
      author?: {
        "@type": "Organization";
        name: string;
      };
      publisher: {
        "@type": "Organization";
        name: string;
      };
    };
  }>;
}

interface CollectionPageSchema {
  "@context": "https://schema.org";
  "@type": "CollectionPage";
  name: string;
  description: string;
  url: string;
  isPartOf: {
    "@type": "WebSite";
    name: string;
    url: string;
  };
  mainEntity?: {
    "@type": "ItemList";
    numberOfItems: number;
    itemListElement: Array<{
      "@type": "ListItem";
      position: number;
      url: string;
    }>;
  };
}

/**
 * Safely stringify JSON for embedding in script tags.
 * Escapes sequences that could break out of the script context.
 * This prevents XSS via </script> or <!-- injection in user content.
 */
function safeJsonLdStringify(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")  // Escape < to prevent </script> injection
    .replace(/>/g, "\\u003e")  // Escape > for safety
    .replace(/&/g, "\\u0026"); // Escape & for HTML entity safety
}

export function ArticleJsonLd({ article, url }: { article: Article; url: string }) {
  // Determine author type: if author field differs from source, treat as Person
  const authorName = article.author || article.source;
  const isPersonAuthor = article.author && article.author !== article.source;

  const schema: NewsArticleSchema = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: article.title,
    description: article.description,
    // An excerpt, not the body. See `NewsArticleSchema.articleBody` above and
    // `@/lib/excerpt` for the bound and why it is that number. No fallback to
    // `description`: it is emitted a line above, and repeating it here would be
    // the same bytes twice for no additional meaning.
    articleBody: toExcerpt(article.content || article.content_markdown),
    image: article.image_url,
    datePublished: article.published_at,
    dateModified: article.updated_at || article.published_at,
    author: {
      "@type": isPersonAuthor ? "Person" : "Organization",
      name: authorName,
    },
    publisher: {
      "@type": "Organization",
      name: "Mukoko News",
      logo: {
        "@type": "ImageObject",
        url: `${BASE_URL}/mukoko-icon-dark.png`,
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": url,
    },
    isAccessibleForFree: true,
    inLanguage: "en",
    keywords: article.keywords?.map((k) => k.name).join(", ") || undefined,
    articleSection: article.category_id || article.category || undefined,
    wordCount: article.word_count || undefined,
  };

  // safeJsonLdStringify escapes <, >, & to Unicode to prevent XSS
  const safeJson = safeJsonLdStringify(schema);

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJson }}
    />
  );
}

export function BreadcrumbJsonLd({ items }: { items: Array<{ name: string; href?: string }> }) {
  const schema: BreadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.href ? getFullUrl(item.href) : undefined,
    })),
  };

  // safeJsonLdStringify escapes <, >, & to Unicode to prevent XSS
  const safeJson = safeJsonLdStringify(schema);

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJson }}
    />
  );
}

export function OrganizationJsonLd() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "NewsMediaOrganization",
    name: "Mukoko News",
    legalName: "Mukoko News by Nyuchi Technology",
    description:
      `Pan-African digital news aggregation platform, ${COVERAGE_FRAGMENT}.`,
    url: BASE_URL,
    logo: {
      "@type": "ImageObject",
      url: `${BASE_URL}/mukoko-icon-dark.png`,
      width: 512,
      height: 512,
    },
    sameAs: [
      "https://x.com/mukokoafrica",
      "https://www.instagram.com/mukokoafrica",
      "https://www.facebook.com/mukokoafrica",
    ],
    foundingDate: "2024",
    founder: {
      "@type": "Organization",
      name: "Nyuchi",
      url: "https://nyuchi.com",
    },
    parentOrganization: {
      "@type": "Organization",
      name: "Nyuchi Technology",
      url: "https://nyuchi.com",
    },
    areaServed: {
      "@type": "Place",
      name: "Africa",
    },
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      url: `${BASE_URL}/help`,
      availableLanguage: "English",
    },
    actionableFeedbackPolicy: `${BASE_URL}/help`,
    ethicsPolicy: `${BASE_URL}/terms`,
    diversityPolicy: `${BASE_URL}/terms`,
  };

  // safeJsonLdStringify escapes <, >, & to Unicode to prevent XSS
  const safeJson = safeJsonLdStringify(schema);

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJson }}
    />
  );
}

/**
 * ItemList JSON-LD for a section of articles (e.g., Top Stories, Latest)
 * Uses safeJsonLdStringify to escape <, >, & and prevent XSS attacks.
 * @see https://schema.org/ItemList
 */
export function ItemListJsonLd({
  articles,
  name,
  description,
}: {
  articles: Article[];
  name?: string;
  description?: string;
}) {
  if (!articles || articles.length === 0) return null;

  const schema: ItemListSchema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    description,
    numberOfItems: articles.length,
    itemListElement: articles.map((article, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "NewsArticle",
        "@id": getArticleUrl(article.id),
        headline: article.title,
        description: article.description,
        image: article.image_url,
        datePublished: article.published_at,
        author: article.source
          ? {
              "@type": "Organization",
              name: article.source,
            }
          : undefined,
        publisher: {
          "@type": "Organization",
          name: "Mukoko News",
        },
      },
    })),
  };

  // safeJsonLdStringify escapes <, >, & to Unicode to prevent XSS
  const safeJson = safeJsonLdStringify(schema);

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJson }}
    />
  );
}

/**
 * CollectionPage JSON-LD for the main feed page.
 * Uses safeJsonLdStringify to escape <, >, & and prevent XSS attacks.
 * @see https://schema.org/CollectionPage
 */
export function CollectionPageJsonLd({
  name,
  description,
  url,
  articles,
}: {
  name: string;
  description: string;
  url: string;
  articles?: Article[];
}) {
  const schema: CollectionPageSchema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    description,
    url,
    isPartOf: {
      "@type": "WebSite",
      name: "Mukoko News",
      url: BASE_URL,
    },
    mainEntity: articles && articles.length > 0
      ? {
          "@type": "ItemList",
          numberOfItems: articles.length,
          itemListElement: articles.slice(0, 10).map((article, index) => ({
            "@type": "ListItem",
            position: index + 1,
            url: getArticleUrl(article.id),
          })),
        }
      : undefined,
  };

  // safeJsonLdStringify escapes <, >, & to Unicode to prevent XSS
  const safeJson = safeJsonLdStringify(schema);

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJson }}
    />
  );
}

/**
 * WebSite JSON-LD with SearchAction for Google Sitelinks Searchbox.
 * When Google recognizes this schema, it may show a search box directly in search results.
 * @see https://schema.org/WebSite
 * @see https://developers.google.com/search/docs/appearance/sitelinks-searchbox
 */
export function WebSiteJsonLd() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Mukoko News",
    alternateName: "Mukoko",
    url: BASE_URL,
    description:
      `Pan-African digital news aggregation platform. Breaking news, top stories and in-depth coverage — ${COVERAGE_FRAGMENT}.`,
    publisher: {
      "@type": "NewsMediaOrganization",
      name: "Mukoko News",
      url: BASE_URL,
    },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${BASE_URL}/search?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
    inLanguage: "en",
  };

  const safeJson = safeJsonLdStringify(schema);

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJson }}
    />
  );
}

/**
 * WebPage JSON-LD for generic pages.
 * Uses safeJsonLdStringify to escape <, >, & and prevent XSS attacks.
 * @see https://schema.org/WebPage
 */
export function WebPageJsonLd({
  name,
  description,
  url,
}: {
  name: string;
  description: string;
  url: string;
}) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name,
    description,
    url,
    isPartOf: {
      "@type": "WebSite",
      name: "Mukoko News",
      url: BASE_URL,
    },
    publisher: {
      "@type": "Organization",
      name: "Mukoko News",
      logo: {
        "@type": "ImageObject",
        url: `${BASE_URL}/mukoko-icon-dark.png`,
      },
    },
  };

  // safeJsonLdStringify escapes <, >, & to Unicode to prevent XSS
  const safeJson = safeJsonLdStringify(schema);

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJson }}
    />
  );
}

/**
 * SoftwareApplication JSON-LD for the embed widget page.
 * Describes the embeddable news widget as a web application.
 * @see https://schema.org/SoftwareApplication
 */
export function SoftwareApplicationJsonLd() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Mukoko News Embed Widget",
    description:
      "Embeddable news cards for top stories, featured content, and location-based African news. Free widget for any website — no API key required.",
    url: `${BASE_URL}/embed`,
    applicationCategory: "WebApplication",
    operatingSystem: "Any",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    author: {
      "@type": "Organization",
      name: "Mukoko News",
      url: BASE_URL,
    },
    featureList:
      `5 layouts (cards, compact, hero, ticker, list), 4 feed types, ${RELEASED_COUNTRY_COUNT} African countries live (${COUNTRY_SCOPE_TOTAL} in scope), dark/light theme, responsive design`,
    softwareVersion: "1.0",
    isAccessibleForFree: true,
  };

  const safeJson = safeJsonLdStringify(schema);

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJson }}
    />
  );
}
