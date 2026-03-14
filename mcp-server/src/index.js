#!/usr/bin/env node

/**
 * Mukoko News MCP Server
 *
 * Model Context Protocol server for Pan-African news.
 * Exposes Mukoko News API endpoints (see api-schema.yml) to any
 * MCP-compatible client (Claude Desktop, Claude Code, Cursor, etc.)
 *
 * All response models follow Schema.org NewsArticle conventions.
 * See: https://schema.org/NewsArticle
 * OpenAPI spec: api-schema.yml
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "@modelcontextprotocol/sdk/zod.js";

const API_BASE =
  process.env.MUKOKO_API_URL ||
  "https://mukoko-news-backend.nyuchi.workers.dev";
const API_SECRET = process.env.MUKOKO_API_SECRET || "";

/**
 * Fetch from the Mukoko News API.
 * Maps to the endpoints defined in api-schema.yml.
 */
async function fetchAPI(path, params = {}) {
  const url = new URL(path, API_BASE);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const headers = { "Content-Type": "application/json" };
  if (API_SECRET) {
    headers["Authorization"] = `Bearer ${API_SECRET}`;
  }

  const response = await fetch(url.toString(), { headers });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `API ${response.status} ${response.statusText}: ${body.slice(0, 200)}`
    );
  }
  return response.json();
}

/** Format an Article object into a readable text summary. */
function formatArticle(a) {
  const parts = [a.headline];
  if (a.publisher_name) parts.push(`Source: ${a.publisher_name}`);
  if (a.date_published) parts.push(`Published: ${a.date_published}`);
  if (a.article_section_id) parts.push(`Category: ${a.article_section_id}`);
  if (a.about_country_id) parts.push(`Country: ${a.about_country_id}`);
  if (a.description) parts.push(`\n${a.description}`);
  if (a.main_entity_of_page) parts.push(`URL: ${a.main_entity_of_page}`);
  parts.push(`ID: ${a.id}`);
  return parts.join("\n");
}

/** Format a list of articles with readable summaries + raw JSON. */
function formatArticleList(articles, meta = {}) {
  const summary = articles
    .map((a, i) => `${i + 1}. ${formatArticle(a)}`)
    .join("\n\n");
  return [
    { type: "text", text: summary || "No articles found." },
    {
      type: "text",
      text: `\n---\nRaw JSON (${articles.length} articles${meta.total ? ` of ${meta.total}` : ""}):\n${JSON.stringify({ ...meta, articles }, null, 2)}`,
    },
  ];
}

// ─── Create MCP Server ──────────────────────────────────────────────────

const server = new McpServer({
  name: "mukoko-news",
  version: "1.0.0",
});

// ─── Resources (static reference data) ─────────────────────────────────

server.resource(
  "countries",
  "mukoko://countries",
  { description: "All 16 supported African countries (CountriesResponse from api-schema.yml)" },
  async (uri) => {
    const data = await fetchAPI("/api/countries");
    return {
      contents: [
        { uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) },
      ],
    };
  }
);

server.resource(
  "categories",
  "mukoko://categories",
  { description: "News categories with article counts (CategoriesResponse from api-schema.yml)" },
  async (uri) => {
    const data = await fetchAPI("/api/categories");
    return {
      contents: [
        { uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) },
      ],
    };
  }
);

server.resource(
  "sources",
  "mukoko://sources",
  { description: "All news sources with article counts and health status (SourcesResponse from api-schema.yml)" },
  async (uri) => {
    const data = await fetchAPI("/api/sources");
    return {
      contents: [
        { uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) },
      ],
    };
  }
);

server.resource(
  "keywords",
  "mukoko://keywords",
  { description: "Trending keywords/topics (KeywordsResponse from api-schema.yml)" },
  async (uri) => {
    const data = await fetchAPI("/api/keywords");
    return {
      contents: [
        { uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) },
      ],
    };
  }
);

server.resource(
  "openapi-schema",
  "mukoko://openapi",
  { description: "Mukoko News OpenAPI 3.0 schema — the single source of truth for all API models and endpoints" },
  async (uri) => {
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: [
            "Mukoko News API — OpenAPI 3.0 Schema Reference",
            "",
            "Base URL: https://mukoko-news-backend.nyuchi.workers.dev/api",
            "",
            "Core Models (Schema.org NewsArticle):",
            "- Article: id, headline, slug, description, content_snippet, author_name, publisher_name, publisher_id, date_published, image, main_entity_of_page, article_section_id, about_country_id, view_count, like_count, bookmark_count, keywords[]",
            "- ArticleFull: extends Article with article_body, date_modified, word_count, reading_time_minutes, quality_score, engagement_score, in_language",
            "- StoryCluster: id, primaryArticle, relatedArticles[], articleCount",
            "- Category: id, name, slug, description, enabled, article_count",
            "- Country: id, name, code, flag_emoji, enabled",
            "- Source: id, name, url, category, country_id, priority, last_fetched_at, fetch_count, error_count, article_count",
            "- Author: id, name, slug, email, bio, image, article_count",
            "- Keyword: id, name, slug, type, article_count",
            "",
            "Key Endpoints:",
            "- GET /feeds → ArticleListResponse (list articles with pagination)",
            "- GET /feeds/sectioned → SectionedFeedResponse (top stories, your news, by category, latest)",
            "- GET /article/{id} → { article: ArticleFull }",
            "- GET /article/{id}/related → RelatedArticlesResponse",
            "- GET /search?q= → SearchResponse",
            "- GET /stories/trending → TrendingResponse",
            "- GET /news-bytes → ArticleListResponse",
            "- GET /categories → CategoriesResponse",
            "- GET /keywords → KeywordsResponse",
            "- GET /sources → SourcesResponse",
            "- GET /countries → CountriesResponse",
            "- GET /authors → AuthorsResponse",
            "- GET /author/{slug} → AuthorProfileResponse",
            "- GET /health → HealthResponse",
            "- GET /stats → StatsResponse",
            "",
            "Full spec: api-schema.yml in the repository root.",
          ].join("\n"),
        },
      ],
    };
  }
);

// ─── Tools (map to OpenAPI operationIds) ────────────────────────────────

// operationId: searchArticles → GET /search
server.tool(
  "search_articles",
  "Search Mukoko News articles. Returns SearchResponse (see api-schema.yml). Fields follow Schema.org NewsArticle.",
  {
    query: z.string().describe("Search query keywords"),
    country: z
      .string()
      .optional()
      .describe("ISO 3166-1 alpha-2 country code (ZW, KE, NG, ZA, GH, etc.)"),
    category: z
      .string()
      .optional()
      .describe("Category slug (politics, sports, technology, economy, etc.)"),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe("Max results (1-50, default 10)"),
  },
  async ({ query, country, category, limit }) => {
    const data = await fetchAPI("/api/search", {
      q: query,
      country,
      category,
      limit,
    });
    const articles = data.results || [];
    return {
      content: formatArticleList(articles, {
        query: data.query,
        count: data.count,
        searchMethod: data.searchMethod,
      }),
    };
  }
);

// operationId: listArticles → GET /feeds
server.tool(
  "get_latest_articles",
  "Get latest news articles. Returns ArticleListResponse (see api-schema.yml). Fields follow Schema.org NewsArticle.",
  {
    country: z
      .string()
      .optional()
      .describe("ISO 3166-1 alpha-2 country code (ZW, KE, NG, ZA, GH, etc.)"),
    category: z
      .string()
      .optional()
      .describe("Category slug (politics, sports, technology, economy, etc.)"),
    sort: z
      .enum(["latest", "trending", "popular"])
      .optional()
      .default("latest")
      .describe("Sort order"),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe("Max articles (1-50, default 10)"),
  },
  async ({ country, category, sort, limit }) => {
    const params = { limit, sort };
    if (country) params.countries = country;
    if (category) params.category = category;
    const data = await fetchAPI("/api/feeds", params);
    return {
      content: formatArticleList(data.articles || [], {
        total: data.total,
        hasMore: data.hasMore,
      }),
    };
  }
);

// operationId: getArticle → GET /article/{articleId}
server.tool(
  "get_article",
  "Get full article content by ID. Returns ArticleFull (see api-schema.yml). Includes article_body, word_count, reading_time_minutes.",
  {
    articleId: z.string().describe("Article UUID"),
  },
  async ({ articleId }) => {
    const data = await fetchAPI(
      `/api/article/${encodeURIComponent(articleId)}`
    );
    const a = data.article;
    if (!a) {
      return { content: [{ type: "text", text: "Article not found." }] };
    }
    const summary = [
      `# ${a.headline}`,
      "",
      a.publisher_name ? `**${a.publisher_name}**` : null,
      a.date_published ? `Published: ${a.date_published}` : null,
      a.word_count ? `${a.word_count} words · ${a.reading_time_minutes || "?"} min read` : null,
      a.article_section_id ? `Category: ${a.article_section_id}` : null,
      a.about_country_id ? `Country: ${a.about_country_id}` : null,
      "",
      a.article_body || a.description || "(no content)",
      "",
      a.main_entity_of_page ? `Source: ${a.main_entity_of_page}` : null,
      `ID: ${a.id}`,
    ]
      .filter(Boolean)
      .join("\n");
    return {
      content: [
        { type: "text", text: summary },
        { type: "text", text: `\n---\nRaw JSON:\n${JSON.stringify(data, null, 2)}` },
      ],
    };
  }
);

// operationId: getTrendingStories → GET /stories/trending
server.tool(
  "get_trending",
  "Get trending story clusters. Returns TrendingResponse (see api-schema.yml). Each cluster groups articles from multiple sources on the same topic.",
  {
    country: z
      .string()
      .optional()
      .describe("ISO 3166-1 alpha-2 country code for country-specific trending"),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe("Number of trending topics"),
    hours: z
      .number()
      .optional()
      .default(24)
      .describe("Lookback window in hours (1-168, default 24)"),
  },
  async ({ country, limit, hours }) => {
    const data = await fetchAPI("/api/stories/trending", {
      country,
      limit,
      hours,
    });
    const topics = data.trending || [];
    const summary = topics
      .map(
        (t, i) =>
          `${i + 1}. "${t.topic}" — ${t.article_count} articles from ${t.source_count} sources (${t.total_views} views)`
      )
      .join("\n");
    return {
      content: [
        { type: "text", text: summary || "No trending topics found." },
        { type: "text", text: `\n---\nRaw JSON:\n${JSON.stringify(data, null, 2)}` },
      ],
    };
  }
);

// operationId: getNewsBytes → GET /news-bytes
server.tool(
  "get_news_bytes",
  "Get NewsBytes — short-form news. Returns ArticleListResponse (see api-schema.yml).",
  {
    country: z.string().optional().describe("ISO 3166-1 alpha-2 country code"),
    category: z.string().optional().describe("Category slug"),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe("Number of bytes (1-30, default 10)"),
  },
  async ({ country, category, limit }) => {
    const data = await fetchAPI("/api/news-bytes", { country, category, limit });
    return {
      content: formatArticleList(data.articles || [], {
        total: data.total,
        hasMore: data.hasMore,
      }),
    };
  }
);

// operationId: getRelatedArticles → GET /article/{articleId}/related
server.tool(
  "get_related_articles",
  "Get articles related to a given article. Returns RelatedArticlesResponse (see api-schema.yml).",
  {
    articleId: z.string().describe("Article UUID"),
  },
  async ({ articleId }) => {
    const data = await fetchAPI(
      `/api/article/${encodeURIComponent(articleId)}/related`
    );
    const articles = data.related || [];
    return {
      content: formatArticleList(articles, {
        source_article_id: data.source_article_id,
      }),
    };
  }
);

// operationId: listKeywords → GET /keywords
server.tool(
  "get_keywords",
  "Get trending keywords/topics. Returns KeywordsResponse (see api-schema.yml).",
  {
    limit: z
      .number()
      .optional()
      .default(20)
      .describe("Number of keywords (1-100, default 20)"),
  },
  async ({ limit }) => {
    const data = await fetchAPI("/api/keywords", { limit });
    const keywords = data.keywords || [];
    const summary = keywords
      .map(
        (k, i) =>
          `${i + 1}. ${k.name} (${k.article_count} articles)`
      )
      .join("\n");
    return {
      content: [
        { type: "text", text: summary || "No keywords found." },
        { type: "text", text: `\n---\nRaw JSON:\n${JSON.stringify(data, null, 2)}` },
      ],
    };
  }
);

// operationId: listSources → GET /sources
server.tool(
  "list_sources",
  "List all news sources. Returns SourcesResponse (see api-schema.yml). Each source has id, name, url, country_id, article_count.",
  {},
  async () => {
    const data = await fetchAPI("/api/sources");
    const sources = data.sources || [];
    const summary = sources
      .map(
        (s) =>
          `- ${s.name} (${s.country_id || "?"}) — ${s.article_count || 0} articles${s.last_error ? " ⚠️" : ""}`
      )
      .join("\n");
    return {
      content: [
        { type: "text", text: `${sources.length} news sources:\n\n${summary}` },
        { type: "text", text: `\n---\nRaw JSON:\n${JSON.stringify(data, null, 2)}` },
      ],
    };
  }
);

// operationId: getStats → GET /stats
server.tool(
  "get_stats",
  "Get platform statistics. Returns StatsResponse (see api-schema.yml).",
  {},
  async () => {
    const data = await fetchAPI("/api/stats");
    const db = data.database || {};
    const summary = [
      `Total Articles: ${db.total_articles?.toLocaleString() || "?"}`,
      `Active Sources: ${db.active_sources || "?"}`,
      `Categories: ${db.categories || "?"}`,
      `Today's Articles: ${db.today_articles || "?"}`,
      `Timestamp: ${data.timestamp || "?"}`,
    ].join("\n");
    return {
      content: [
        { type: "text", text: summary },
        { type: "text", text: `\n---\nRaw JSON:\n${JSON.stringify(data, null, 2)}` },
      ],
    };
  }
);

// ─── Start server ───────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
