#!/usr/bin/env node

/**
 * Mukoko News MCP Server
 *
 * Model Context Protocol server for Pan-African news.
 * Exposes Mukoko News articles, sources, categories, and search
 * to any MCP-compatible client (Claude, Cursor, etc.)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "@modelcontextprotocol/sdk/zod.js";

const API_BASE =
  process.env.MUKOKO_API_URL ||
  "https://mukoko-news-backend.nyuchi.workers.dev";
const API_SECRET = process.env.MUKOKO_API_SECRET || "";

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
    throw new Error(`API error ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

// Create MCP server
const server = new McpServer({
  name: "mukoko-news",
  version: "1.0.0",
});

// --- Resources ---

server.resource("countries", "mukoko://countries", async (uri) => {
  const data = await fetchAPI("/api/countries");
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
});

server.resource("categories", "mukoko://categories", async (uri) => {
  const data = await fetchAPI("/api/categories");
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
});

server.resource("sources", "mukoko://sources", async (uri) => {
  const data = await fetchAPI("/api/sources");
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
});

server.resource("keywords", "mukoko://keywords", async (uri) => {
  const data = await fetchAPI("/api/keywords");
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
});

// --- Tools ---

server.tool(
  "search_articles",
  "Search Mukoko News articles by keyword, country, and category",
  {
    query: z.string().describe("Search query (keywords)"),
    country: z
      .string()
      .optional()
      .describe("Country code (ZW, KE, NG, ZA, GH, etc.)"),
    category: z
      .string()
      .optional()
      .describe("Category slug (politics, sports, technology, economy, etc.)"),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe("Number of results (1-50, default 10)"),
  },
  async ({ query, country, category, limit }) => {
    const data = await fetchAPI("/api/search", {
      q: query,
      country,
      category,
      limit,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "get_latest_articles",
  "Get the latest news articles from Mukoko News",
  {
    country: z
      .string()
      .optional()
      .describe("Country code (ZW, KE, NG, ZA, GH, etc.)"),
    category: z
      .string()
      .optional()
      .describe("Category slug (politics, sports, technology, economy, etc.)"),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe("Number of articles (1-50, default 10)"),
  },
  async ({ country, category, limit }) => {
    const params = { limit };
    if (country) params.country = country;
    if (category) params.category = category;
    const data = await fetchAPI("/api/feeds", params);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "get_article",
  "Get a specific article by its ID with full content",
  {
    id: z.string().describe("The article ID"),
  },
  async ({ id }) => {
    const data = await fetchAPI(`/api/article/${encodeURIComponent(id)}`);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "get_trending",
  "Get trending stories and topics on Mukoko News",
  {
    country: z
      .string()
      .optional()
      .describe("Country code for country-specific trending"),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe("Number of trending stories"),
  },
  async ({ country, limit }) => {
    const data = await fetchAPI("/api/stories/trending", { country, limit });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "get_news_bytes",
  "Get NewsBytes — short-form news updates for quick reading",
  {
    country: z.string().optional().describe("Country code filter"),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe("Number of bytes (1-30, default 10)"),
  },
  async ({ country, limit }) => {
    const data = await fetchAPI("/api/news-bytes", { country, limit });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "get_related_articles",
  "Get articles related to a specific article (story cluster)",
  {
    articleId: z.string().describe("The article ID to find related articles for"),
  },
  async ({ articleId }) => {
    const data = await fetchAPI(
      `/api/article/${encodeURIComponent(articleId)}/related`
    );
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

server.tool(
  "get_keywords",
  "Get trending keywords and topics being discussed",
  {
    limit: z
      .number()
      .optional()
      .default(20)
      .describe("Number of keywords to return"),
  },
  async ({ limit }) => {
    const data = await fetchAPI("/api/keywords", { limit });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// --- Start server ---

const transport = new StdioServerTransport();
await server.connect(transport);
