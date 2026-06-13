/**
 * MCP (Model Context Protocol) server for Mukoko News.
 *
 * Exposes the news platform as a set of LLM-callable tools:
 * search, trending, article details, browse by tag/author/source, stats.
 *
 * Transport: Streamable HTTP (POST /mcp) — stateless JSON-RPC 2.0.
 * No auth required; results are the same as the public widget API.
 *
 * Tool responses include inline HTML (MCP Apps) rendered via the Nyuchi /
 * Mzizi design system (mzizi-mcp v0.2.1) alongside plain text for
 * clients that do not support resource content.
 */

type D1DB = D1Database;

// ── MCP protocol types ─────────────────────────────────────────────────────

interface McpRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type McpContent =
  | { type: 'text'; text: string }
  | { type: 'resource'; resource: { uri: string; mimeType: string; text: string } };

interface McpToolResult {
  content: McpContent[];
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
    description: "Get platform-wide statistics: total articles, sources, categories, today's output.",
    inputSchema: { type: 'object', properties: {} },
  },
] as const;

type ToolName = typeof TOOLS[number]['name'];

// ── Query helpers ──────────────────────────────────────────────────────────

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(Math.max(min, n), max) : fallback;
}

function sanitize(value: unknown, maxLen = 200): string {
  return String(value ?? '').slice(0, maxLen).trim();
}

// ── Plain-text formatters ──────────────────────────────────────────────────

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

// ── HTML rendering (Mzizi / Nyuchi brand) ─────────────────────────────────

const SITE = 'https://news.mukoko.com';

// Nyuchi African Minerals palette + Mzizi card design tokens
const CSS = `
:root{--tz:#4B0082;--co:#0047AB;--go:#5D4037;--ma:#2E8B57;--tc:#E07A4D;--cr:#FAF9F5;}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,'Segoe UI',BlinkMacSystemFont,sans-serif;background:var(--cr);padding:16px;font-size:14px;color:#1a1a2e;line-height:1.5;}
a{color:inherit;text-decoration:none;}
.hd{display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid var(--tz);}
.hd h1{font-family:Georgia,'Times New Roman',serif;font-size:18px;font-weight:700;color:var(--tz);flex:1;}
.hd .sub{color:#777;font-size:12px;white-space:nowrap;}
.card{background:#fff;border-radius:14px;padding:16px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,.06);border:1px solid rgba(0,0,0,.07);}
.card:last-of-type{margin-bottom:0;}
.card-top{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}
.bk{display:inline-block;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#fff;}
.bk-cat{background:var(--tz);}
.bk-cc{background:var(--co);}
.bk-src{background:rgba(0,0,0,.35);font-weight:600;}
.dt{color:#aaa;font-size:11px;}
.card-title{font-family:Georgia,'Times New Roman',serif;font-size:15px;font-weight:700;line-height:1.4;margin-bottom:8px;color:#0d0d1a;}
.card-title a:hover{text-decoration:underline;color:var(--co);}
.card-desc{font-size:13px;color:#555;line-height:1.5;margin-bottom:10px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
.card-summary{font-size:12px;color:var(--co);font-style:italic;background:rgba(0,71,171,.05);padding:8px 10px;border-radius:6px;margin-bottom:10px;border-left:3px solid var(--co);}
.card-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;}
.card-src{font-size:11px;color:#888;}
.read-link{color:var(--co);font-size:12px;font-weight:600;}
.read-link:hover{text-decoration:underline;}
.card-stats{font-size:11px;color:#ccc;margin-top:8px;}
.tags{display:flex;flex-wrap:wrap;gap:3px;margin-top:8px;}
.tag{background:rgba(75,0,130,.07);color:var(--tz);padding:1px 6px;border-radius:3px;font-size:10px;}
.num{font-size:22px;font-weight:800;color:var(--tz);opacity:.35;min-width:28px;flex-shrink:0;line-height:1;}
.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;}
.stat-box{background:#fff;border-radius:12px;padding:16px;text-align:center;border:1px solid rgba(0,0,0,.07);}
.stat-n{font-size:28px;font-weight:800;color:var(--tz);letter-spacing:-.02em;}
.stat-l{font-size:11px;color:#888;margin-top:2px;text-transform:uppercase;letter-spacing:.04em;}
.cat-row{display:flex;align-items:center;gap:10px;background:#fff;border-radius:10px;padding:12px 14px;margin-bottom:8px;border:1px solid rgba(0,0,0,.06);}
.cat-em{font-size:20px;width:28px;text-align:center;flex-shrink:0;}
.cat-name{font-weight:600;font-size:14px;}
.cat-cnt{font-size:11px;color:#999;margin-top:1px;}
.cat-desc{font-size:12px;color:#777;margin-top:2px;}
.src-row{display:flex;align-items:center;gap:10px;background:#fff;border-radius:10px;padding:12px 14px;margin-bottom:8px;border:1px solid rgba(0,0,0,.06);}
.src-cc{width:28px;height:28px;border-radius:50%;background:var(--co);color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;}
.src-name{font-weight:600;font-size:13px;}
.src-meta{font-size:11px;color:#999;margin-top:1px;}
.cred{display:inline-flex;align-items:center;gap:2px;margin-top:2px;}
.cred-pip{width:6px;height:6px;border-radius:50%;background:var(--ma);}
.cred-pip.lo{background:#ddd;}
.no{text-align:center;padding:32px 16px;color:#888;font-size:14px;}
.ft{text-align:center;margin-top:14px;padding-top:12px;border-top:1px solid rgba(0,0,0,.06);}
.ft a{color:var(--tz);font-size:12px;font-weight:600;}
`;

function he(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(d: unknown): string {
  if (!d) return '';
  try {
    return new Date(String(d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return String(d).slice(0, 10); }
}

function credPips(score: unknown): string {
  const n = Math.round(Number(score ?? 0) * 5);
  return Array.from({ length: 5 }, (_, i) =>
    `<span class="cred-pip${i >= n ? ' lo' : ''}"></span>`
  ).join('');
}

function articleCard(r: Record<string, unknown>): string {
  const href = r.original_url ? he(r.original_url) : `${SITE}/article/${he(r.id)}`;
  const category = r.category ? `<span class="bk bk-cat">${he(r.category)}</span>` : '';
  const cc = r.country_id ? `<span class="bk bk-cc">${he(r.country_id)}</span>` : '';
  const src = r.source ? `<span class="bk bk-src">${he(r.source)}</span>` : '';
  const desc = r.description ? `<p class="card-desc">${he(r.description)}</p>` : '';
  const summary = r.ai_summary ? `<p class="card-summary">${he(r.ai_summary)}</p>` : '';
  const author = r.author ? ` · ${he(r.author)}` : '';
  const views = r.view_count ? `👁 ${r.view_count}` : '';
  const likes = r.like_count ? `${views ? ' · ' : ''}❤ ${r.like_count}` : '';
  const tagStr = r.tags ? String(r.tags).split(',').filter(Boolean).slice(0, 4)
    .map(t => `<span class="tag">${he(t.trim())}</span>`).join('') : '';

  return `<div class="card">
<div class="card-top">${category}${cc}${src}<span class="dt">${fmtDate(r.published_at)}</span></div>
<div class="card-title"><a href="${href}" target="_blank" rel="noopener">${he(r.title)}</a></div>
${desc}${summary}<div class="card-foot"><span class="card-src">${he(r.source as string ?? '')}${author}</span><a class="read-link" href="${href}" target="_blank" rel="noopener">Read →</a></div>${views || likes ? `<div class="card-stats">${views}${likes}</div>` : ''}${tagStr ? `<div class="tags">${tagStr}</div>` : ''}
</div>`;
}

function articleCardNumbered(r: Record<string, unknown>, i: number): string {
  const inner = articleCard(r);
  // Wrap content area with a flex row showing rank number
  return inner.replace('<div class="card">', `<div class="card" style="display:flex;gap:12px;align-items:flex-start"><div class="num">${i + 1}</div><div style="flex:1;min-width:0">`).replace(/(<\/div>)$/, '</div></div>');
}

function page(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${he(title)} — Mukoko News</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

function articlesHtml(rows: Record<string, unknown>[], heading: string, sub = ''): string {
  if (!rows.length) {
    return page(heading, `<div class="hd"><h1>🐝 ${he(heading)}</h1></div><div class="no">No results found.</div><div class="ft"><a href="${SITE}">Visit Mukoko News</a></div>`);
  }
  const numbered = rows.length > 1;
  const cards = rows.map((r, i) => numbered ? articleCardNumbered(r, i) : articleCard(r)).join('');
  return page(heading, `<div class="hd"><h1>🐝 ${he(heading)}</h1>${sub ? `<span class="sub">${he(sub)}</span>` : ''}</div>${cards}<div class="ft"><a href="${SITE}">Mukoko News — Pan-African Coverage</a></div>`);
}

// ── Result builders ────────────────────────────────────────────────────────

function ok(text: string, html?: string): McpToolResult {
  const content: McpContent[] = [{ type: 'text', text }];
  if (html) {
    content.push({
      type: 'resource',
      resource: { uri: 'ui://mukoko-news/result', mimeType: 'text/html', text: html },
    });
  }
  return { content };
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

  const sql = `SELECT id, title, description, source, category, country_id, published_at, original_url,
    author, tags, view_count, like_count, ai_summary
    FROM articles WHERE ${where.join(' AND ')} ORDER BY published_at DESC LIMIT ?`;

  const { results } = await db.prepare(sql).bind(...bindings).all<Record<string, unknown>>();
  if (!results.length) return ok(`No articles found for query: "${q}"`);

  const text = results.map((r, i) => `[${i + 1}] ${articleToText(r)}`).join('\n\n---\n\n');
  const html = articlesHtml(results, `Search: "${q}"`, `${results.length} result${results.length !== 1 ? 's' : ''}`);
  return ok(`Found ${results.length} article(s) for "${q}":\n\n${text}`, html);
}

async function toolGetArticle(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const id = sanitize(args.id, 100);
  if (!id) return err('"id" is required');

  const isNumeric = /^\d+$/.test(id);
  const sql = isNumeric
    ? "SELECT * FROM articles WHERE id = ? AND status = 'published' LIMIT 1"
    : "SELECT * FROM articles WHERE slug = ? AND status = 'published' LIMIT 1";

  const row = await db.prepare(sql).bind(isNumeric ? Number(id) : id).first<Record<string, unknown>>();
  if (!row) return err(`Article not found: ${id}`);

  const html = articlesHtml([row], String(row.title ?? 'Article'));
  return ok(articleToText(row), html);
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

  const sql = `SELECT id, title, description, source, category, country_id, published_at, original_url,
    author, tags, view_count, like_count, ai_summary, trending_score
    FROM articles WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT ?`;

  const { results } = await db.prepare(sql).bind(...bindings).all<Record<string, unknown>>();
  if (!results.length) return ok('No trending articles found.');

  const text = results.map((r, i) => `[${i + 1}] ${articleToText(r)}`).join('\n\n---\n\n');
  const label = sortArg === 'views' ? 'Most Viewed' : sortArg === 'likes' ? 'Most Liked' : sortArg === 'recent' ? 'Latest' : 'Trending';
  const html = articlesHtml(results, `${label} on Mukoko News`, `Top ${results.length}`);
  return ok(`Top ${results.length} trending article(s):\n\n${text}`, html);
}

async function toolGetSimilarStories(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const id = sanitize(args.id, 100);
  if (!id) return err('"id" is required');
  const limit = clamp(args.limit, 1, 10, 5);

  const isNumeric = /^\d+$/.test(id);
  const anchor = await db
    .prepare(isNumeric
      ? "SELECT id, title, category, tags, country_id FROM articles WHERE id = ? LIMIT 1"
      : "SELECT id, title, category, tags, country_id FROM articles WHERE slug = ? LIMIT 1"
    )
    .bind(isNumeric ? Number(id) : id)
    .first<Record<string, unknown>>();

  if (!anchor) return err(`Article not found: ${id}`);

  const { results: candidates } = await db.prepare(`
    SELECT id, title, description, source, category, country_id, published_at, original_url,
           author, tags, view_count, like_count, ai_summary
    FROM articles
    WHERE status = 'published' AND id != ? AND category = ?
    ORDER BY published_at DESC LIMIT 40
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
  const html = articlesHtml(top, 'Similar Stories', `Related to: ${String(anchor.title ?? id)}`);
  return ok(`${top.length} similar story/stories:\n\n${text}`, html);
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
      AND (LOWER(a.tags) LIKE LOWER(?) OR EXISTS (
        SELECT 1 FROM article_keywords ak WHERE ak.article_id = a.id AND LOWER(ak.keyword) = LOWER(?)
      ))
    ORDER BY a.published_at DESC LIMIT ? OFFSET ?
  `).bind(`%${tag}%`, tag, limit, offset).all<Record<string, unknown>>();

  if (!results.length) return ok(`No articles found for tag: "${tag}"`);

  const text = results.map((r, i) => `[${i + 1}] ${articleToText(r)}`).join('\n\n---\n\n');
  const html = articlesHtml(results, `Tag: ${tag}`, `${results.length} article${results.length !== 1 ? 's' : ''}`);
  return ok(`${results.length} article(s) tagged "${tag}":\n\n${text}`, html);
}

async function toolBrowseByAuthor(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const author = sanitize(args.author, 100);
  if (!author) return err('"author" is required');
  const limit = clamp(args.limit, 1, 20, 10);
  const offset = clamp(args.offset, 0, 10000, 0);

  const { results } = await db.prepare(`
    SELECT id, title, description, source, category, country_id,
           published_at, original_url, author, tags, view_count, like_count, ai_summary
    FROM articles WHERE status = 'published' AND LOWER(author) LIKE LOWER(?)
    ORDER BY published_at DESC LIMIT ? OFFSET ?
  `).bind(`%${author}%`, limit, offset).all<Record<string, unknown>>();

  if (!results.length) return ok(`No articles found for author: "${author}"`);

  const text = results.map((r, i) => `[${i + 1}] ${articleToText(r)}`).join('\n\n---\n\n');
  const html = articlesHtml(results, `Author: ${author}`, `${results.length} article${results.length !== 1 ? 's' : ''}`);
  return ok(`${results.length} article(s) by "${author}":\n\n${text}`, html);
}

async function toolBrowseBySource(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const source = sanitize(args.source, 100);
  if (!source) return err('"source" is required');
  const limit = clamp(args.limit, 1, 20, 10);
  const offset = clamp(args.offset, 0, 10000, 0);

  const { results } = await db.prepare(`
    SELECT id, title, description, source, category, country_id,
           published_at, original_url, author, tags, view_count, like_count, ai_summary
    FROM articles WHERE status = 'published' AND LOWER(source) LIKE LOWER(?)
    ORDER BY published_at DESC LIMIT ? OFFSET ?
  `).bind(`%${source}%`, limit, offset).all<Record<string, unknown>>();

  if (!results.length) return ok(`No articles found for source: "${source}"`);

  const text = results.map((r, i) => `[${i + 1}] ${articleToText(r)}`).join('\n\n---\n\n');
  const html = articlesHtml(results, source, `${results.length} article${results.length !== 1 ? 's' : ''}`);
  return ok(`${results.length} article(s) from "${source}":\n\n${text}`, html);
}

async function toolListCategories(db: D1DB): Promise<McpToolResult> {
  const { results } = await db.prepare(`
    SELECT c.id, c.name, c.description, c.emoji, COUNT(a.id) AS article_count
    FROM categories c
    LEFT JOIN articles a ON a.category_id = c.id AND a.status = 'published'
    WHERE c.enabled = 1 GROUP BY c.id ORDER BY article_count DESC
  `).all<Record<string, unknown>>();

  if (!results.length) return ok('No categories found.');

  const lines = results.map(r =>
    `${r.emoji ?? '📰'} ${r.name} (${r.id}) — ${r.article_count} articles${r.description ? `\n   ${r.description}` : ''}`
  );

  const rows = results.map(r => `
<div class="cat-row">
  <div class="cat-em">${he(r.emoji ?? '📰')}</div>
  <div style="flex:1;min-width:0">
    <div class="cat-name">${he(r.name)}</div>
    <div class="cat-cnt">${r.article_count} article${Number(r.article_count) !== 1 ? 's' : ''}</div>
    ${r.description ? `<div class="cat-desc">${he(r.description)}</div>` : ''}
  </div>
  <a href="${SITE}/category/${he(r.id)}" target="_blank" rel="noopener" style="color:var(--co);font-size:12px;font-weight:600">Browse →</a>
</div>`).join('');

  const html = page('Categories', `<div class="hd"><h1>🐝 Categories</h1><span class="sub">${results.length} topics</span></div>${rows}<div class="ft"><a href="${SITE}">Mukoko News</a></div>`);
  return ok(`Categories on Mukoko News:\n\n${lines.join('\n\n')}`, html);
}

async function toolListSources(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const country = sanitize(args.country, 5).toUpperCase();
  const where = ['enabled = 1'];
  const bindings: unknown[] = [];

  if (country) { where.push('country_id = ?'); bindings.push(country); }

  const { results } = await db.prepare(`
    SELECT name, country_id, website_url, description, quality_rating, credibility_score
    FROM news_sources WHERE ${where.join(' AND ')} ORDER BY quality_rating DESC LIMIT 50
  `).bind(...bindings).all<Record<string, unknown>>();

  if (!results.length) return ok('No sources found.');

  const lines = results.map(r =>
    `• ${r.name} (${r.country_id}) — credibility ${Number(r.credibility_score ?? 1).toFixed(1)}/1.0${r.website_url ? `\n  ${r.website_url}` : ''}`
  );

  const rows = results.map(r => {
    const initials = String(r.country_id ?? '??');
    return `<div class="src-row">
  <div class="src-cc">${he(initials)}</div>
  <div style="flex:1;min-width:0">
    <div class="src-name">${he(r.name)}${r.website_url ? ` <a href="${he(r.website_url)}" target="_blank" rel="noopener" style="color:var(--co);font-size:11px">↗</a>` : ''}</div>
    <div class="src-meta">${he(r.country_id)}</div>
    <div class="cred">${credPips(r.credibility_score)}</div>
  </div>
</div>`;
  }).join('');

  const html = page('News Sources', `<div class="hd"><h1>🐝 News Sources</h1><span class="sub">${results.length} publications</span></div>${rows}<div class="ft"><a href="${SITE}">Mukoko News</a></div>`);
  return ok(`Active news sources:\n\n${lines.join('\n\n')}`, html);
}

async function toolGetStats(db: D1DB): Promise<McpToolResult> {
  const [totalRow, sourcesRow, categoriesRow, todayRow] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM articles WHERE status = 'published'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM news_sources WHERE enabled = 1").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM categories WHERE enabled = 1").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM articles WHERE status = 'published' AND DATE(published_at) = DATE('now')").first<{ n: number }>(),
  ]);

  const total = totalRow?.n ?? 0;
  const sources = sourcesRow?.n ?? 0;
  const categories = categoriesRow?.n ?? 0;
  const today = todayRow?.n ?? 0;

  const text = `Mukoko News — Platform Statistics\n\nTotal articles: ${total}\nActive sources: ${sources}\nCategories: ${categories}\nPublished today: ${today}`;

  const html = page('Platform Stats', `
<div class="hd"><h1>🐝 Mukoko News</h1><span class="sub">Platform Statistics</span></div>
<div class="stat-grid">
  <div class="stat-box"><div class="stat-n">${total.toLocaleString()}</div><div class="stat-l">Total Articles</div></div>
  <div class="stat-box"><div class="stat-n">${today.toLocaleString()}</div><div class="stat-l">Published Today</div></div>
  <div class="stat-box"><div class="stat-n">${sources}</div><div class="stat-l">Active Sources</div></div>
  <div class="stat-box"><div class="stat-n">${categories}</div><div class="stat-l">Categories</div></div>
</div>
<p style="font-size:12px;color:#999;text-align:center">Pan-African news covering Zimbabwe and 15 other countries.</p>
<div class="ft"><a href="${SITE}">Visit Mukoko News</a></div>`);

  return ok(text, html);
}

// ── Dispatch ───────────────────────────────────────────────────────────────

async function callTool(db: D1DB, name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  switch (name as ToolName) {
    case 'search_news':        return toolSearchNews(db, args);
    case 'get_article':        return toolGetArticle(db, args);
    case 'get_trending':       return toolGetTrending(db, args);
    case 'get_similar_stories':return toolGetSimilarStories(db, args);
    case 'browse_by_tag':      return toolBrowseByTag(db, args);
    case 'browse_by_author':   return toolBrowseByAuthor(db, args);
    case 'browse_by_source':   return toolBrowseBySource(db, args);
    case 'list_categories':    return toolListCategories(db);
    case 'list_sources':       return toolListSources(db, args);
    case 'get_stats':          return toolGetStats(db);
    default: return err(`Unknown tool: ${name}`);
  }
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function handleMcp(req: Request, db: D1DB): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
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
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'mukoko-news', version: '1.0.0' },
          instructions:
            'You are connected to Mukoko News, a Pan-African news aggregation platform covering Zimbabwe and 15 other African countries. Use the available tools to search, browse, and analyse news coverage. Tool responses include inline UI rendered with the Nyuchi design system.',
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
