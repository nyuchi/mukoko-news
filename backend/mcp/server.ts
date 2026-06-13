/**
 * MCP (Model Context Protocol) server for Mukoko News.
 *
 * Exposes the news platform as a set of LLM-callable tools:
 * search, trending, article details, browse by tag/author/source, stats.
 *
 * Transport: Streamable HTTP (POST /mcp) — stateless JSON-RPC 2.0.
 * No auth required; results are the same as the public widget API.
 */

type D1DB = D1Database;

// ── MCP protocol types ─────────────────────────────────────────────────────

interface McpRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

interface McpResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

// ── Tool definitions ───────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'search_news',
    description:
      'Search Mukoko News articles by keyword query. Optionally filter by category or country code (ISO 3166-1 alpha-2, e.g. ZW, ZA, KE).',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Search query (max 200 chars)' },
        category: { type: 'string', description: 'Category slug to filter (optional)' },
        country: { type: 'string', description: 'Country code to filter, e.g. ZW (optional)' },
        limit: { type: 'number', description: 'Max results, 1–20 (default 10)' },
      },
      required: ['q'],
    },
  },
  {
    name: 'get_article',
    description: 'Fetch full details of a single article by its numeric ID or URL slug.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Article numeric ID or slug' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_trending',
    description:
      'Get the most-viewed or most-liked articles on Mukoko News. Optionally filter by category or country.',
    inputSchema: {
      type: 'object',
      properties: {
        sort: {
          type: 'string',
          enum: ['views', 'likes', 'trending_score', 'recent'],
          description: 'Sort field (default: trending_score)',
        },
        category: { type: 'string', description: 'Category slug (optional)' },
        country: { type: 'string', description: 'Country code (optional)' },
        limit: { type: 'number', description: 'Max results, 1–20 (default 10)' },
      },
    },
  },
  {
    name: 'get_similar_stories',
    description:
      'Find articles similar to a given article, matched by shared keywords and category.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Article numeric ID or slug to find neighbours for' },
        limit: { type: 'number', description: 'Max results, 1–10 (default 5)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'browse_by_tag',
    description: 'Get articles tagged with a specific keyword.',
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Keyword or tag name' },
        limit: { type: 'number', description: 'Max results, 1–20 (default 10)' },
        offset: { type: 'number', description: 'Pagination offset (default 0)' },
      },
      required: ['tag'],
    },
  },
  {
    name: 'browse_by_author',
    description: 'Get articles written by a specific journalist or author.',
    inputSchema: {
      type: 'object',
      properties: {
        author: { type: 'string', description: 'Author name (partial match supported)' },
        limit: { type: 'number', description: 'Max results, 1–20 (default 10)' },
        offset: { type: 'number', description: 'Pagination offset (default 0)' },
      },
      required: ['author'],
    },
  },
  {
    name: 'browse_by_source',
    description: 'Get articles from a specific news source or publication.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source/publication name (partial match)' },
        limit: { type: 'number', description: 'Max results, 1–20 (default 10)' },
        offset: { type: 'number', description: 'Pagination offset (default 0)' },
      },
      required: ['source'],
    },
  },
  {
    name: 'list_categories',
    description: 'List all news categories available on Mukoko News.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_sources',
    description: 'List active news sources (publications) tracked by Mukoko News.',
    inputSchema: {
      type: 'object',
      properties: {
        country: { type: 'string', description: 'Filter by country code (optional)' },
      },
    },
  },
  {
    name: 'get_stats',
    description: 'Get platform-wide statistics: total articles, sources, categories, today\'s output.',
    inputSchema: { type: 'object', properties: {} },
  },
] as const;

type ToolName = typeof TOOLS[number]['name'];

// ── Helpers ────────────────────────────────────────────────────────────────

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(Math.max(min, n), max) : fallback;
}

function sanitize(value: unknown, maxLen = 200): string {
  return String(value ?? '').slice(0, maxLen).trim();
}

function articleToText(row: Record<string, unknown>): string {
  const lines: string[] = [
    `# ${row.title}`,
    `Source: ${row.source} | Category: ${row.category ?? 'general'} | Country: ${row.country_id ?? 'ZW'}`,
    `Published: ${row.published_at}`,
  ];
  if (row.author) lines.push(`Author: ${row.author}`);
  if (row.description) lines.push(`\n${row.description}`);
  if (row.ai_summary) lines.push(`\nSummary: ${row.ai_summary}`);
  lines.push(`\nURL: ${row.original_url}`);
  if (row.tags) lines.push(`Tags: ${row.tags}`);
  lines.push(`Views: ${row.view_count ?? 0} | Likes: ${row.like_count ?? 0}`);
  return lines.join('\n');
}

function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

function err(message: string): McpToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

// ── Tool implementations ───────────────────────────────────────────────────

async function toolSearchNews(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const q = sanitize(args.q);
  if (!q) return err('query "q" is required');

  const limit = clamp(args.limit, 1, 20, 10);
  const category = sanitize(args.category, 50);
  const country = sanitize(args.country, 5).toUpperCase();

  const where: string[] = ["status = 'published'", "(title LIKE ? OR description LIKE ? OR content_search LIKE ?)"];
  const bindings: unknown[] = [`%${q}%`, `%${q}%`, `%${q}%`];

  if (category) { where.push('LOWER(category) = LOWER(?)'); bindings.push(category); }
  if (country) { where.push('country_id = ?'); bindings.push(country); }

  bindings.push(limit);

  const sql = `
    SELECT id, title, description, source, category, country_id, published_at, original_url,
           author, tags, view_count, like_count, ai_summary
    FROM articles
    WHERE ${where.join(' AND ')}
    ORDER BY published_at DESC
    LIMIT ?
  `;

  const { results } = await db.prepare(sql).bind(...bindings).all<Record<string, unknown>>();
  if (!results.length) return ok(`No articles found for query: "${q}"`);

  const text = results.map((r, i) => `[${i + 1}] ${articleToText(r)}`).join('\n\n---\n\n');
  return ok(`Found ${results.length} article(s) for "${q}":\n\n${text}`);
}

async function toolGetArticle(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const id = sanitize(args.id, 100);
  if (!id) return err('"id" is required');

  const isNumeric = /^\d+$/.test(id);
  const sql = isNumeric
    ? 'SELECT * FROM articles WHERE id = ? AND status = \'published\' LIMIT 1'
    : 'SELECT * FROM articles WHERE slug = ? AND status = \'published\' LIMIT 1';

  const row = await db.prepare(sql).bind(isNumeric ? Number(id) : id).first<Record<string, unknown>>();
  if (!row) return err(`Article not found: ${id}`);
  return ok(articleToText(row));
}

async function toolGetTrending(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const limit = clamp(args.limit, 1, 20, 10);
  const category = sanitize(args.category, 50);
  const country = sanitize(args.country, 5).toUpperCase();
  const sortArg = sanitize(args.sort, 20);

  const sortMap: Record<string, string> = {
    views: 'view_count DESC',
    likes: 'like_count DESC',
    trending_score: 'trending_score DESC',
    recent: 'published_at DESC',
  };
  const orderBy = sortMap[sortArg] ?? 'trending_score DESC';

  const where: string[] = ["status = 'published'", "published_at >= datetime('now', '-7 days')"];
  const bindings: unknown[] = [];

  if (category) { where.push('LOWER(category) = LOWER(?)'); bindings.push(category); }
  if (country) { where.push('country_id = ?'); bindings.push(country); }

  bindings.push(limit);

  const sql = `
    SELECT id, title, description, source, category, country_id, published_at, original_url,
           author, tags, view_count, like_count, ai_summary, trending_score
    FROM articles
    WHERE ${where.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT ?
  `;

  const { results } = await db.prepare(sql).bind(...bindings).all<Record<string, unknown>>();
  if (!results.length) return ok('No trending articles found.');

  const text = results.map((r, i) => `[${i + 1}] ${articleToText(r)}`).join('\n\n---\n\n');
  return ok(`Top ${results.length} trending article(s):\n\n${text}`);
}

async function toolGetSimilarStories(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const id = sanitize(args.id, 100);
  if (!id) return err('"id" is required');
  const limit = clamp(args.limit, 1, 10, 5);

  const isNumeric = /^\d+$/.test(id);
  const anchor = await db
    .prepare(isNumeric
      ? "SELECT id, category, tags, country_id FROM articles WHERE id = ? LIMIT 1"
      : "SELECT id, category, tags, country_id FROM articles WHERE slug = ? LIMIT 1"
    )
    .bind(isNumeric ? Number(id) : id)
    .first<Record<string, unknown>>();

  if (!anchor) return err(`Article not found: ${id}`);

  // Pull up to 40 candidate articles from the same category, then score by shared tags
  const { results: candidates } = await db.prepare(`
    SELECT id, title, description, source, category, country_id, published_at, original_url,
           author, tags, view_count, like_count, ai_summary
    FROM articles
    WHERE status = 'published'
      AND id != ?
      AND category = ?
    ORDER BY published_at DESC
    LIMIT 40
  `).bind(anchor.id, anchor.category).all<Record<string, unknown>>();

  if (!candidates.length) return ok('No similar stories found.');

  const anchorTags = new Set(String(anchor.tags ?? '').toLowerCase().split(',').map(t => t.trim()).filter(Boolean));

  type Scored = Record<string, unknown> & { _score: number };
  const scored: Scored[] = candidates.map(c => {
    const cTags = String(c.tags ?? '').toLowerCase().split(',').map(t => t.trim()).filter(Boolean);
    const shared = cTags.filter(t => anchorTags.has(t)).length;
    return { ...c, _score: shared };
  });

  scored.sort((a, b) => b._score - a._score || Number(b.published_at) - Number(a.published_at));

  const top = scored.slice(0, limit);
  const text = top.map((r, i) => `[${i + 1}] ${articleToText(r)}`).join('\n\n---\n\n');
  return ok(`${top.length} similar story/stories:\n\n${text}`);
}

async function toolBrowseByTag(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const tag = sanitize(args.tag, 100);
  if (!tag) return err('"tag" is required');
  const limit = clamp(args.limit, 1, 20, 10);
  const offset = clamp(args.offset, 0, 10000, 0);

  const { results } = await db.prepare(`
    SELECT a.id, a.title, a.description, a.source, a.category, a.country_id,
           a.published_at, a.original_url, a.author, a.tags, a.view_count, a.like_count, a.ai_summary
    FROM articles a
    WHERE a.status = 'published'
      AND (
        LOWER(a.tags) LIKE LOWER(?)
        OR EXISTS (
          SELECT 1 FROM article_keywords ak
          WHERE ak.article_id = a.id AND LOWER(ak.keyword) = LOWER(?)
        )
      )
    ORDER BY a.published_at DESC
    LIMIT ? OFFSET ?
  `).bind(`%${tag}%`, tag, limit, offset).all<Record<string, unknown>>();

  if (!results.length) return ok(`No articles found for tag: "${tag}"`);

  const text = results.map((r, i) => `[${i + 1}] ${articleToText(r)}`).join('\n\n---\n\n');
  return ok(`${results.length} article(s) tagged "${tag}":\n\n${text}`);
}

async function toolBrowseByAuthor(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const author = sanitize(args.author, 100);
  if (!author) return err('"author" is required');
  const limit = clamp(args.limit, 1, 20, 10);
  const offset = clamp(args.offset, 0, 10000, 0);

  const { results } = await db.prepare(`
    SELECT id, title, description, source, category, country_id,
           published_at, original_url, author, tags, view_count, like_count, ai_summary
    FROM articles
    WHERE status = 'published'
      AND LOWER(author) LIKE LOWER(?)
    ORDER BY published_at DESC
    LIMIT ? OFFSET ?
  `).bind(`%${author}%`, limit, offset).all<Record<string, unknown>>();

  if (!results.length) return ok(`No articles found for author: "${author}"`);

  const text = results.map((r, i) => `[${i + 1}] ${articleToText(r)}`).join('\n\n---\n\n');
  return ok(`${results.length} article(s) by "${author}":\n\n${text}`);
}

async function toolBrowseBySource(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const source = sanitize(args.source, 100);
  if (!source) return err('"source" is required');
  const limit = clamp(args.limit, 1, 20, 10);
  const offset = clamp(args.offset, 0, 10000, 0);

  const { results } = await db.prepare(`
    SELECT id, title, description, source, category, country_id,
           published_at, original_url, author, tags, view_count, like_count, ai_summary
    FROM articles
    WHERE status = 'published'
      AND LOWER(source) LIKE LOWER(?)
    ORDER BY published_at DESC
    LIMIT ? OFFSET ?
  `).bind(`%${source}%`, limit, offset).all<Record<string, unknown>>();

  if (!results.length) return ok(`No articles found for source: "${source}"`);

  const text = results.map((r, i) => `[${i + 1}] ${articleToText(r)}`).join('\n\n---\n\n');
  return ok(`${results.length} article(s) from "${source}":\n\n${text}`);
}

async function toolListCategories(db: D1DB): Promise<McpToolResult> {
  const { results } = await db.prepare(`
    SELECT c.id, c.name, c.description, c.emoji,
           COUNT(a.id) AS article_count
    FROM categories c
    LEFT JOIN articles a ON a.category_id = c.id AND a.status = 'published'
    WHERE c.enabled = 1
    GROUP BY c.id
    ORDER BY article_count DESC
  `).all<Record<string, unknown>>();

  if (!results.length) return ok('No categories found.');

  const lines = results.map(r =>
    `${r.emoji ?? '📰'} ${r.name} (${r.id}) — ${r.article_count} articles${r.description ? `\n   ${r.description}` : ''}`
  );
  return ok(`Categories on Mukoko News:\n\n${lines.join('\n\n')}`);
}

async function toolListSources(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const country = sanitize(args.country, 5).toUpperCase();
  const where = ["enabled = 1"];
  const bindings: unknown[] = [];

  if (country) { where.push('country_id = ?'); bindings.push(country); }

  const { results } = await db.prepare(`
    SELECT name, country_id, website_url, description, quality_rating, credibility_score
    FROM news_sources
    WHERE ${where.join(' AND ')}
    ORDER BY quality_rating DESC
    LIMIT 50
  `).bind(...bindings).all<Record<string, unknown>>();

  if (!results.length) return ok('No sources found.');

  const lines = results.map(r =>
    `• ${r.name} (${r.country_id}) — credibility ${Number(r.credibility_score ?? 1).toFixed(1)}/1.0${r.website_url ? `\n  ${r.website_url}` : ''}`
  );
  return ok(`Active news sources:\n\n${lines.join('\n\n')}`);
}

async function toolGetStats(db: D1DB): Promise<McpToolResult> {
  const [totalRow, sourcesRow, categoriesRow, todayRow] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM articles WHERE status = 'published'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM news_sources WHERE enabled = 1").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM categories WHERE enabled = 1").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM articles WHERE status = 'published' AND DATE(published_at) = DATE('now')").first<{ n: number }>(),
  ]);

  return ok(
    `Mukoko News — Platform Statistics\n\n` +
    `Total articles: ${totalRow?.n ?? 0}\n` +
    `Active sources: ${sourcesRow?.n ?? 0}\n` +
    `Categories: ${categoriesRow?.n ?? 0}\n` +
    `Published today: ${todayRow?.n ?? 0}`
  );
}

// ── Dispatch ───────────────────────────────────────────────────────────────

async function callTool(db: D1DB, name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  switch (name as ToolName) {
    case 'search_news':       return toolSearchNews(db, args);
    case 'get_article':       return toolGetArticle(db, args);
    case 'get_trending':      return toolGetTrending(db, args);
    case 'get_similar_stories': return toolGetSimilarStories(db, args);
    case 'browse_by_tag':     return toolBrowseByTag(db, args);
    case 'browse_by_author':  return toolBrowseByAuthor(db, args);
    case 'browse_by_source':  return toolBrowseBySource(db, args);
    case 'list_categories':   return toolListCategories(db);
    case 'list_sources':      return toolListSources(db, args);
    case 'get_stats':         return toolGetStats(db);
    default: return err(`Unknown tool: ${name}`);
  }
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function handleMcp(req: Request, db: D1DB): Promise<Response> {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body: McpRequest;
  try {
    body = await req.json() as McpRequest;
  } catch {
    return jsonRpc(null, undefined, { code: -32700, message: 'Parse error' });
  }

  const { jsonrpc, id, method, params } = body;
  if (jsonrpc !== '2.0') {
    return jsonRpc(id ?? null, undefined, { code: -32600, message: 'Invalid Request' });
  }

  try {
    switch (method) {
      case 'initialize':
        return jsonRpc(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'mukoko-news', version: '1.0.0' },
          instructions:
            'You are connected to Mukoko News, a Pan-African news aggregation platform covering Zimbabwe and 15 other African countries. Use the available tools to search, browse, and analyse news coverage.',
        });

      case 'notifications/initialized':
        return new Response(null, { status: 204 });

      case 'ping':
        return jsonRpc(id, {});

      case 'tools/list':
        return jsonRpc(id, { tools: TOOLS });

      case 'tools/call': {
        const name = String((params as Record<string, unknown>)?.name ?? '');
        const args = ((params as Record<string, unknown>)?.arguments ?? {}) as Record<string, unknown>;
        const result = await callTool(db, name, args);
        return jsonRpc(id, result);
      }

      default:
        return jsonRpc(id, undefined, { code: -32601, message: `Method not found: ${method}` });
    }
  } catch (e: unknown) {
    console.error('[MCP]', e);
    return jsonRpc(id, undefined, { code: -32603, message: 'Internal error' });
  }
}

function jsonRpc(
  id: string | number | null | undefined,
  result?: unknown,
  error?: { code: number; message: string },
): Response {
  const body: McpResponse = { jsonrpc: '2.0', id: id ?? null };
  if (error) body.error = error;
  else body.result = result;
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
