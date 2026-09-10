import type { Article } from "@/lib/api";
import { BASE_URL, getFullUrl, getArticleUrl } from "@/lib/constants";

interface NewsArticleSchema {
  "@context": "https://schema.org";
  "@type": "NewsArticle";
  headline: string;
  description?: string;
  articleBody?: string;
  image?: string | { "@type": "ImageObject"; url: string; width?: number; height?: number };
  datePublished: string;
  dateModified?: string;
  author: {
    "@type": "Person" | "Organization";
    name: string;
    url?: string;
  };
  /**
   * The ORIGINATING NEWSROOM — CNN, The Herald — not Mukoko.
   *
   * Optional, and `logo` with it. Both were required, which is what forced the
   * component to hardcode `name: "Mukoko News"` and Mukoko's own icon onto every
   * article: an aggregator declaring itself the publisher of someone else's
   * reporting, with someone else's byline underneath it.
   *
   * `logo` is now optional because schema.org does not require it and because
   * the honest alternative was worse — Mukoko's icon attached to CNN's publisher
   * record is a stronger false claim than no logo at all. Only a logo the
   * newsroom's OWN record carries is emitted; today no organisation record on
   * the cluster has one, so in practice this is omitted.
   *
   * The whole property is optional because a publisher that cannot be resolved
   * must be omitted, not guessed. See `resolvePublisher` below.
   */
  publisher?: {
    "@type": "Organization";
    name: string;
    url?: string;
    logo?: {
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
      /** The originating newsroom, or omitted. Never Mukoko — see below. */
      publisher?: {
        "@type": "Organization";
        name: string;
        url?: string;
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

/**
 * The publisher of an article is the newsroom that published it.
 *
 * Owner decision: "publisher is ie.. cnn news, source should be the same thing",
 * and "a publisher is also an entity". So this resolves through the platform's
 * entity model — `articles.mediaOrganizationId` → `news.newsMediaOrganizations`,
 * which links on to `entity.entities` via `entityId` — rather than through a
 * display string.
 *
 * Three tiers, in order, and the last one is the point:
 *
 *  1. `article.publisher` — the resolved organisation. Stable across the several
 *     feed-source records one masthead can hold (measured on the live cluster:
 *     35 organisations own feed sources whose names disagree, covering 24% of
 *     the corpus), so "Daily Monitor Uganda" is emitted once rather than as
 *     "Monitor", "Daily Monitor" and "Daily Monitor v2" on neighbouring pieces.
 *  2. `article.source` — the feed-source name. Less stable, but it is still the
 *     newsroom, and naming the right organisation imprecisely beats naming the
 *     wrong one exactly.
 *  3. `undefined` — omit the property. schema.org permits that; asserting a
 *     publisher we cannot establish does not become true for being well-formed.
 *     This is the same rule the pipeline's country backfill follows, in its own
 *     words: it "never invents a country", because a null is a known gap and a
 *     wrong value is a silent error every consumer then reports as fact.
 *
 * What is NOT here: "Mukoko News". Mukoko aggregates this reporting; it did not
 * publish it, and the `NewsMediaOrganization` schema on every page already says
 * who Mukoko is.
 */
function resolvePublisher(article: Article):
  | { "@type": "Organization"; name: string; url?: string; logo?: { "@type": "ImageObject"; url: string } }
  | undefined {
  const org = article.publisher;
  if (org?.name) {
    return {
      "@type": "Organization",
      name: org.name,
      url: org.url,
      // The newsroom's own logo or none. Mukoko's icon on someone else's
      // publisher record would be a worse claim than an absent one.
      logo: org.logo ? { "@type": "ImageObject", url: org.logo } : undefined,
    };
  }
  const fallback = article.source?.trim();
  return fallback ? { "@type": "Organization", name: fallback } : undefined;
}

export function ArticleJsonLd({ article, url }: { article: Article; url: string }) {
  const publisher = resolvePublisher(article);
  // Determine author type: a real byline is a Person; with no byline the
  // newsroom itself is the author. Fall back to the RESOLVED publisher name
  // rather than the feed-source name, so an un-bylined piece does not emit
  // author "Daily Monitor v2" alongside publisher "Daily Monitor Uganda" — two
  // names for one newsroom in one document.
  const orgName = publisher?.name || article.source;
  const authorName = article.author || orgName;
  const isPersonAuthor = Boolean(article.author && article.author !== orgName);

  const schema: NewsArticleSchema = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: article.title,
    description: article.description,
    articleBody: article.content || article.description,
    image: article.image_url,
    datePublished: article.published_at,
    dateModified: article.updated_at || article.published_at,
    author: {
      "@type": isPersonAuthor ? "Person" : "Organization",
      name: authorName,
    },
    publisher,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": url,
    },
    isAccessibleForFree: true,
    // The corpus is not monolingual — it carries francophone newsrooms
    // (rfi.fr, france24) among others, and the source document records its own
    // language. Hard-coding "en" told answer engines a French article was
    // English, which is worse than saying nothing.
    inLanguage: article.language || "en",
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
      "Pan-African digital news aggregation platform covering Zimbabwe, South Africa, Kenya, Nigeria, and 12 more African countries.",
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
        // Same correction as the article page, deliberately WITHOUT a catalogue
        // read. A list item is a pointer — its `@id` is the article URL, where
        // the authoritative NewsArticle lives — so it resolves through whatever
        // the list read already carries and falls back to the feed-source name.
        // Paying a publisher lookup per home-feed render to make a pointer's
        // publisher marginally more consistent is not a trade this app's readers
        // (metered African mobile data, and a feed that is the hottest path in
        // the product) should pay for. What matters is that it no longer claims
        // Mukoko published someone else's reporting.
        publisher: resolvePublisher(article),
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
      "Pan-African digital news aggregation platform. Breaking news, top stories, and in-depth coverage from 16 African countries.",
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
    // Mukoko's OWN pages (help, terms, …) — Mukoko really is the publisher
    // here, unlike a NewsArticle, which belongs to the newsroom that wrote it.
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
      "5 layouts (cards, compact, hero, ticker, list), 4 feed types, 16 African countries, dark/light theme, responsive design",
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
