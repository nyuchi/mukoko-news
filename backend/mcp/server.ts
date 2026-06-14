/**
 * MCP (Model Context Protocol) server for Mukoko News.
 *
 * Tools are organised around tasks — the questions users and LLMs actually
 * ask — rather than API endpoints. Location-aware tools understand country
 * codes, country names, city names, and African regional groupings.
 *
 * Task tools:
 *   get_briefing            — "What's happening in Zimbabwe / East Africa / politics?"
 *   track_story             — "What's the latest on load shedding / the election?"
 *   get_location_news       — "News from Harare / Lagos / Southern Africa"
 *   compare_locations       — "Compare Zimbabwe and South Africa coverage"
 *   get_source_view         — "What is The Herald saying about the economy?"
 *   get_my_feed             — "Show me my personalised news feed"
 *
 * Open data analytics (Mukoko open data policy):
 *   get_trending_analytics  — "What topics are trending in East Africa today?"
 *   detect_surge            — "What's seeing a sudden spike in coverage?"
 *   get_content_analytics   — "Category breakdown for Kenyan news this week"
 *
 * Discovery / content / reference:
 *   find_stories, get_article, list_categories, list_sources, get_stats
 *
 * Transport: Streamable HTTP (POST /mcp) — stateless JSON-RPC 2.0.
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

// ── Location resolution ────────────────────────────────────────────────────

const VALID_CODES = new Set([
  'ZW', 'ZA', 'KE', 'NG', 'GH', 'ET', 'EG', 'MA', 'TZ', 'UG', 'SN', 'CI', 'CM', 'MZ', 'ZM', 'RW',
]);

const COUNTRY_LABELS: Record<string, string> = {
  ZW: 'Zimbabwe', ZA: 'South Africa', KE: 'Kenya', NG: 'Nigeria',
  GH: 'Ghana', ET: 'Ethiopia', EG: 'Egypt', MA: 'Morocco',
  TZ: 'Tanzania', UG: 'Uganda', SN: 'Senegal', CI: "Côte d'Ivoire",
  CM: 'Cameroon', MZ: 'Mozambique', ZM: 'Zambia', RW: 'Rwanda',
};

// Region name → ISO codes (also accept underscored variants)
const REGIONS: Record<string, { codes: string[]; label: string }> = {
  'east africa':    { codes: ['KE', 'TZ', 'UG', 'ET', 'RW'], label: 'East Africa' },
  'east_africa':    { codes: ['KE', 'TZ', 'UG', 'ET', 'RW'], label: 'East Africa' },
  'west africa':    { codes: ['NG', 'GH', 'SN', 'CI', 'CM'], label: 'West Africa' },
  'west_africa':    { codes: ['NG', 'GH', 'SN', 'CI', 'CM'], label: 'West Africa' },
  'southern africa':{ codes: ['ZW', 'ZA', 'MZ', 'ZM'],       label: 'Southern Africa' },
  'southern_africa':{ codes: ['ZW', 'ZA', 'MZ', 'ZM'],       label: 'Southern Africa' },
  'north africa':   { codes: ['EG', 'MA'],                    label: 'North Africa' },
  'north_africa':   { codes: ['EG', 'MA'],                    label: 'North Africa' },
  'central africa': { codes: ['CM'],                          label: 'Central Africa' },
  'central_africa': { codes: ['CM'],                          label: 'Central Africa' },
  'africa':         { codes: [...VALID_CODES],                label: 'Africa' },
  'pan-african':    { codes: [...VALID_CODES],                label: 'Africa' },
  'pan african':    { codes: [...VALID_CODES],                label: 'Africa' },
};

// Country names + major cities → ISO code
const LOCATION_ALIASES: Record<string, string> = {
  // Country names
  zimbabwe: 'ZW', 'south africa': 'ZA', kenya: 'KE', nigeria: 'NG',
  ghana: 'GH', ethiopia: 'ET', egypt: 'EG', morocco: 'MA',
  tanzania: 'TZ', uganda: 'UG', senegal: 'SN', 'ivory coast': 'CI',
  "cote d'ivoire": 'CI', cameroon: 'CM', mozambique: 'MZ', zambia: 'ZM', rwanda: 'RW',
  // Major cities
  harare: 'ZW', bulawayo: 'ZW', mutare: 'ZW', gweru: 'ZW',
  johannesburg: 'ZA', 'cape town': 'ZA', durban: 'ZA', pretoria: 'ZA',
  nairobi: 'KE', mombasa: 'KE', kisumu: 'KE',
  lagos: 'NG', abuja: 'NG', kano: 'NG', ibadan: 'NG', 'port harcourt': 'NG',
  accra: 'GH', kumasi: 'GH',
  'addis ababa': 'ET',
  cairo: 'EG', alexandria: 'EG',
  casablanca: 'MA', rabat: 'MA', marrakech: 'MA',
  'dar es salaam': 'TZ', dodoma: 'TZ',
  kampala: 'UG',
  dakar: 'SN',
  abidjan: 'CI', yamoussoukro: 'CI',
  yaounde: 'CM', douala: 'CM',
  maputo: 'MZ',
  lusaka: 'ZM', ndola: 'ZM',
  kigali: 'RW',
};

interface ResolvedLocation {
  type: 'country' | 'region' | 'unknown';
  codes: string[];
  label: string;
}

function resolveLocation(input: string): ResolvedLocation {
  const cleaned = input.trim();
  const upper = cleaned.toUpperCase();
  const lower = cleaned.toLowerCase();

  if (VALID_CODES.has(upper)) {
    return { type: 'country', codes: [upper], label: COUNTRY_LABELS[upper] ?? upper };
  }
  const region = REGIONS[lower];
  if (region) return { type: 'region', codes: region.codes, label: region.label };

  const aliasCode = LOCATION_ALIASES[lower];
  if (aliasCode) return { type: 'country', codes: [aliasCode], label: COUNTRY_LABELS[aliasCode] ?? aliasCode };

  // Partial match
  for (const [alias, code] of Object.entries(LOCATION_ALIASES)) {
    if (lower.includes(alias) || alias.includes(lower)) {
      return { type: 'country', codes: [code], label: COUNTRY_LABELS[code] ?? code };
    }
  }
  return { type: 'unknown', codes: [], label: cleaned };
}

function flagEmoji(code: string): string {
  return [...code.toUpperCase()].map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('');
}

function locationHeader(loc: ResolvedLocation): string {
  if (loc.type === 'country' && loc.codes.length === 1) return `${flagEmoji(loc.codes[0])} ${loc.label}`;
  return `🌍 ${loc.label}`;
}

// ── Tool definitions ───────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'get_briefing',
    description:
      'Answer "What\'s happening in [place/topic]?" — returns a full briefing: top story, ' +
      'recent articles, and trending topics in one call. Accepts country codes (ZW, KE, NG), ' +
      'region names (East Africa, Southern Africa, West Africa), category topics (politics, ' +
      'business, sports), or omit focus for a pan-African overview.',
    inputSchema: {
      type: 'object',
      properties: {
        focus: {
          type: 'string',
          description: 'Country code, region name, category, or topic (optional — omit for all of Africa)',
        },
        limit: { type: 'number', description: 'Max articles, 1–12 (default 8)' },
      },
    },
  },
  {
    name: 'track_story',
    description:
      'Follow the development of a news story over time. Answer "What\'s the latest on [topic]?" ' +
      'or "What happened with [event] this week?" Returns articles in chronological order so you ' +
      'can see how a story evolved. Use since to control the lookback window.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Topic, keyword, event, or person name to track' },
        since: {
          type: 'string',
          enum: ['today', 'week', 'month'],
          description: 'How far back to look (default: week)',
        },
        country: { type: 'string', description: 'Limit to a country code, e.g. ZW (optional)' },
        limit: { type: 'number', description: 'Max articles, 1–20 (default 10)' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'get_location_news',
    description:
      'Get news from a specific place in Africa. Accepts country codes (ZW, NG, KE), country ' +
      'names (Zimbabwe, Nigeria), region names (East Africa, Southern Africa, West Africa), or ' +
      'city names (Harare, Lagos, Nairobi, Cairo). Returns top articles from that location plus ' +
      'the active news sources covering it.',
    inputSchema: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'Country code, country name, region name, or city name',
        },
        category: { type: 'string', description: 'Category to filter, e.g. politics (optional)' },
        limit: { type: 'number', description: 'Max articles, 1–20 (default 10)' },
      },
      required: ['location'],
    },
  },
  {
    name: 'compare_locations',
    description:
      'Compare news coverage between 2–4 African countries or regions side by side. Answer ' +
      '"How does Zimbabwe compare to South Africa?" or "What\'s different between East and West ' +
      'Africa in the news?" Accepts country codes, country names, or region names. Optionally ' +
      'narrow the comparison to a specific topic.',
    inputSchema: {
      type: 'object',
      properties: {
        locations: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 4,
          description: '2–4 country codes, country names, or region names to compare',
        },
        topic: { type: 'string', description: 'Narrow comparison to a topic or keyword (optional)' },
        limit: { type: 'number', description: 'Max articles per location, 1–10 (default 5)' },
      },
      required: ['locations'],
    },
  },
  {
    name: 'get_source_view',
    description:
      'See how a specific news source is covering a topic. Answer "What does The Herald say ' +
      'about the economy?" or "What is ZimLive reporting on?". Returns the publication\'s recent ' +
      'articles, optionally filtered by topic.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Publication or source name (partial match)' },
        topic: { type: 'string', description: 'Topic or keyword to filter by (optional)' },
        limit: { type: 'number', description: 'Max articles, 1–20 (default 8)' },
      },
      required: ['source'],
    },
  },
  {
    name: 'find_stories',
    description:
      'Search for articles by keyword, topic, author, tag, category, or country. Best for ' +
      'targeted lookups when you know what you\'re looking for. Supports combining filters.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Keyword or phrase to search (optional if author/tag provided)' },
        author: { type: 'string', description: 'Filter by journalist or author name (optional)' },
        tag: { type: 'string', description: 'Filter by tag or keyword label (optional)' },
        category: { type: 'string', description: 'Category slug (optional)' },
        country: { type: 'string', description: 'Country code, e.g. ZW (optional)' },
        limit: { type: 'number', description: 'Max results, 1–20 (default 10)' },
      },
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
    name: 'list_categories',
    description: 'List all news categories available on Mukoko News with article counts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_sources',
    description: 'List active news sources (publications) tracked by Mukoko News. Optionally filter by country code.',
    inputSchema: {
      type: 'object',
      properties: {
        country: { type: 'string', description: 'Filter by country code, e.g. ZW (optional)' },
      },
    },
  },
  {
    name: 'get_stats',
    description: "Get platform statistics: total articles, active sources, categories, and today's output.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_my_feed',
    description:
      'Get a personalised news feed for a user based on the sources, categories, and authors they follow, ' +
      'plus inferred interests from their liked articles. Requires the user\'s internal user_id. Returns ' +
      'the most recent articles matching their interests, ordered by publication date.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: "User's internal ID (users.id from the platform)" },
        limit: { type: 'number', description: 'Max articles, 1–20 (default 12)' },
      },
      required: ['user_id'],
    },
  },
  {
    name: 'get_trending_analytics',
    description:
      'Open analytics — what topics, categories, keywords, and sources are trending right now across ' +
      'Africa or a specific location. Part of Mukoko\'s open data policy: analytics given directly to ' +
      'users so they can identify what news is important and current. Returns ranked keyword frequency, ' +
      'category breakdown, most active sources, and country-level coverage volumes.',
    inputSchema: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'Country code, country name, region, or city (optional — omit for all of Africa)',
        },
        period: {
          type: 'string',
          enum: ['today', 'week', 'month'],
          description: 'Analysis window (default: today)',
        },
        limit: { type: 'number', description: 'Max results per section, 1–20 (default 10)' },
      },
    },
  },
  {
    name: 'detect_surge',
    description:
      'Detect sudden spikes in news coverage for topics, categories, or keywords — comparing the last ' +
      '24 hours against the 7-day daily baseline. Surfaces unusual increases that signal something ' +
      'important is happening: e.g. crime reports up 5× in Bulawayo, a surge of football news in Ghana, ' +
      'an unexpected spike in economic coverage. Optionally scoped to a country or region.',
    inputSchema: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'Limit detection to a country, region, or city (optional — omit for continent-wide)',
        },
        limit: { type: 'number', description: 'Max surges to return, 1–20 (default 10)' },
      },
    },
  },
  {
    name: 'get_content_analytics',
    description:
      'Open data analytics: breakdown of news content by category, country, and keyword for a given ' +
      'period. Helps identify which topics dominate press coverage in each African country or region, ' +
      'and what the media is prioritising vs ignoring. Part of Mukoko\'s open data policy.',
    inputSchema: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'Country code, country name, or region name (optional)',
        },
        period: {
          type: 'string',
          enum: ['today', 'week', 'month'],
          description: 'Analysis window (default: week)',
        },
      },
    },
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

/** Build `IN (?, ?, ...)` clause and extend bindings array in place. */
function inClause(codes: string[], bindings: unknown[]): string {
  bindings.push(...codes);
  return `(${codes.map(() => '?').join(', ')})`;
}

const SINCE_MAP: Record<string, string> = {
  today: '-1 days',
  week: '-7 days',
  month: '-30 days',
};

// ── Plain-text formatters ──────────────────────────────────────────────────

function articleToText(row: Record<string, unknown>, index?: number): string {
  const prefix = index != null ? `[${index + 1}] ` : '';
  const lines: string[] = [
    `${prefix}# ${row.title}`,
    `Source: ${row.source} | Category: ${row.category ?? 'general'} | Country: ${row.country_id ?? ''}`,
    `Published: ${row.published_at}`,
  ];
  if (row.author) lines.push(`Author: ${row.author}`);
  if (row.description) lines.push(`\n${row.description}`);
  if (row.ai_summary) lines.push(`\nAI Summary: ${row.ai_summary}`);
  lines.push(`\nURL: ${row.original_url}`);
  if (row.tags) lines.push(`Tags: ${row.tags}`);
  return lines.join('\n');
}

// ── HTML rendering ─────────────────────────────────────────────────────────

const SITE = 'https://news.mukoko.com';

const CSS = `
:root{--tz:#4B0082;--co:#0047AB;--go:#5D4037;--ma:#2E8B57;--tc:#E07A4D;--cr:#FAF9F5;}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,'Segoe UI',BlinkMacSystemFont,sans-serif;background:var(--cr);padding:16px;font-size:14px;color:#1a1a2e;line-height:1.5;}
a{color:inherit;text-decoration:none;}
/* Standard card */
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
.tags{display:flex;flex-wrap:wrap;gap:3px;margin-top:8px;}
.tag{background:rgba(75,0,130,.07);color:var(--tz);padding:1px 6px;border-radius:3px;font-size:10px;}
.num{font-size:22px;font-weight:800;color:var(--tz);opacity:.35;min-width:28px;flex-shrink:0;line-height:1;}
/* Stats */
.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;}
.stat-box{background:#fff;border-radius:12px;padding:16px;text-align:center;border:1px solid rgba(0,0,0,.07);}
.stat-n{font-size:28px;font-weight:800;color:var(--tz);letter-spacing:-.02em;}
.stat-l{font-size:11px;color:#888;margin-top:2px;text-transform:uppercase;letter-spacing:.04em;}
/* Categories & sources */
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
/* Page header */
.hd{display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid var(--tz);}
.hd h1{font-family:Georgia,'Times New Roman',serif;font-size:18px;font-weight:700;color:var(--tz);flex:1;}
.hd .sub{color:#777;font-size:12px;white-space:nowrap;}
.no{text-align:center;padding:32px 16px;color:#888;font-size:14px;}
.ft{text-align:center;margin-top:14px;padding-top:12px;border-top:1px solid rgba(0,0,0,.06);}
.ft a{color:var(--tz);font-size:12px;font-weight:600;}
/* Location banner */
.loc-banner{background:linear-gradient(135deg,var(--tz),var(--co));border-radius:12px;padding:14px 16px;margin-bottom:14px;color:#fff;display:flex;align-items:center;gap:12px;}
.loc-flag{font-size:30px;line-height:1;}
.loc-name{font-size:17px;font-weight:700;font-family:Georgia,serif;}
.loc-sub{font-size:11px;opacity:.75;margin-top:2px;}
/* Section labels */
.sect{margin-top:14px;margin-bottom:6px;display:flex;align-items:center;gap:8px;}
.sect-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#aaa;}
.sect-rule{flex:1;height:1px;background:rgba(0,0,0,.07);}
/* Mini cards (used in briefing latest section) */
.mini{background:#fff;border-radius:10px;padding:11px 13px;margin-bottom:6px;border:1px solid rgba(0,0,0,.06);display:flex;gap:10px;align-items:flex-start;}
.mini-idx{font-size:13px;font-weight:800;color:var(--tz);opacity:.3;min-width:18px;flex-shrink:0;padding-top:1px;}
.mini-body{flex:1;min-width:0;}
.mini-title{font-weight:600;font-size:13px;line-height:1.35;color:#0d0d1a;}
.mini-title a:hover{color:var(--co);}
.mini-meta{font-size:10px;color:#bbb;margin-top:3px;}
/* Trending pills */
.pills{display:flex;flex-wrap:wrap;gap:5px;margin-top:4px;}
.pill{display:inline-block;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600;background:rgba(75,0,130,.08);color:var(--tz);cursor:default;}
/* Timeline (track_story) */
.timeline{margin-top:6px;}
.tl-entry{display:flex;gap:12px;margin-bottom:12px;}
.tl-dot{display:flex;flex-direction:column;align-items:center;flex-shrink:0;}
.tl-circle{width:10px;height:10px;border-radius:50%;background:var(--co);margin-top:4px;flex-shrink:0;}
.tl-line{width:2px;background:rgba(0,71,171,.15);flex:1;margin-top:3px;}
.tl-entry:last-child .tl-line{display:none;}
.tl-card{flex:1;background:#fff;border-radius:10px;padding:12px 13px;border:1px solid rgba(0,0,0,.06);}
.tl-date{font-size:10px;color:#999;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:5px;}
.tl-title{font-weight:700;font-size:13px;line-height:1.4;color:#0d0d1a;margin-bottom:4px;}
.tl-title a:hover{color:var(--co);}
.tl-src{font-size:10px;color:#bbb;}
/* Compare locations */
.cmp-col{margin-bottom:18px;}
.cmp-hd{border-radius:10px 10px 0 0;padding:10px 14px;background:var(--tz);color:#fff;display:flex;align-items:center;gap:8px;}
.cmp-flag{font-size:20px;}
.cmp-name{font-weight:700;font-size:13px;}
.cmp-body{border:1px solid rgba(0,0,0,.08);border-top:none;border-radius:0 0 10px 10px;overflow:hidden;}
.cmp-row{padding:10px 13px;border-bottom:1px solid rgba(0,0,0,.05);background:#fff;}
.cmp-row:last-child{border-bottom:none;}
.cmp-row-title{font-size:12px;font-weight:600;line-height:1.35;color:#0d0d1a;}
.cmp-row-title a:hover{color:var(--co);}
.cmp-row-meta{font-size:10px;color:#bbb;margin-top:2px;}
.cmp-empty{padding:14px;text-align:center;color:#ccc;font-size:12px;background:#fff;}
/* Analytics — trend bars */
.trend-list{margin-top:4px;}
.trend-row{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid rgba(0,0,0,.04);}
.trend-row:last-child{border-bottom:none;}
.trend-label{font-size:12px;font-weight:600;color:#1a1a2e;min-width:110px;max-width:150px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.trend-bar-wrap{flex:1;height:8px;background:rgba(0,0,0,.05);border-radius:4px;overflow:hidden;}
.trend-bar{height:100%;border-radius:4px;background:var(--tz);}
.trend-cnt{font-size:11px;font-weight:700;color:#555;min-width:48px;text-align:right;flex-shrink:0;}
/* Surge detection */
.surge-list{margin-top:4px;}
.surge-row{background:#fff;border-radius:10px;padding:12px 13px;margin-bottom:8px;border:1px solid rgba(0,0,0,.06);}
.surge-head{display:flex;align-items:center;gap:6px;margin-bottom:6px;}
.surge-label{font-weight:700;font-size:13px;flex:1;color:#0d0d1a;}
.surge-x{font-size:14px;font-weight:800;color:#8b1a00;}
.surge-bar{background:linear-gradient(90deg,#8b1a00,#b5451b);}
.surge-meta{font-size:11px;color:#888;margin-top:5px;}
`;

function he(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHref(u: unknown, fallback: string): string {
  const s = String(u ?? '').trim();
  try {
    const p = new URL(s);
    if (p.protocol === 'http:' || p.protocol === 'https:') return he(p.toString());
  } catch { /* non-URL */ }
  return he(fallback);
}

function fmtDate(d: unknown): string {
  if (!d) return '';
  try {
    return new Date(String(d)).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return String(d).slice(0, 10); }
}

function credPips(score: unknown): string {
  const n = Math.round(Number(score ?? 0) * 5);
  return Array.from({ length: 5 }, (_, i) =>
    `<span class="cred-pip${i >= n ? ' lo' : ''}"></span>`
  ).join('');
}

function page(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https:"><title>${he(title)} — Mukoko News</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

function articleCard(r: Record<string, unknown>): string {
  const href = safeHref(r.original_url, `${SITE}/article/${encodeURIComponent(String(r.id))}`);
  const category = r.category ? `<span class="bk bk-cat">${he(r.category)}</span>` : '';
  const cc = r.country_id ? `<span class="bk bk-cc">${he(r.country_id)}</span>` : '';
  const src = r.source ? `<span class="bk bk-src">${he(r.source)}</span>` : '';
  const desc = r.description ? `<p class="card-desc">${he(r.description)}</p>` : '';
  const summary = r.ai_summary ? `<p class="card-summary">${he(r.ai_summary)}</p>` : '';
  const author = r.author ? ` · ${he(r.author)}` : '';
  const tagStr = r.tags ? String(r.tags).split(',').filter(Boolean).slice(0, 4)
    .map(t => `<span class="tag">${he(t.trim())}</span>`).join('') : '';
  return `<div class="card">
<div class="card-top">${category}${cc}${src}<span class="dt">${fmtDate(r.published_at)}</span></div>
<div class="card-title"><a href="${href}" target="_blank" rel="noopener">${he(r.title)}</a></div>
${desc}${summary}<div class="card-foot"><span class="card-src">${he(r.source as string ?? '')}${author}</span><a class="read-link" href="${href}" target="_blank" rel="noopener">Read →</a></div>${tagStr ? `<div class="tags">${tagStr}</div>` : ''}
</div>`;
}

function miniCard(r: Record<string, unknown>, idx: number): string {
  const href = safeHref(r.original_url, `${SITE}/article/${encodeURIComponent(String(r.id))}`);
  const src = r.source ? `${he(r.source)} · ` : '';
  return `<div class="mini">
<div class="mini-idx">${idx + 1}</div>
<div class="mini-body">
<div class="mini-title"><a href="${href}" target="_blank" rel="noopener">${he(r.title)}</a></div>
<div class="mini-meta">${src}${fmtDate(r.published_at)}</div>
</div></div>`;
}

function timelineCard(r: Record<string, unknown>, isLast: boolean): string {
  const href = safeHref(r.original_url, `${SITE}/article/${encodeURIComponent(String(r.id))}`);
  return `<div class="tl-entry">
<div class="tl-dot"><div class="tl-circle"></div>${isLast ? '' : '<div class="tl-line"></div>'}</div>
<div class="tl-card">
<div class="tl-date">${fmtDate(r.published_at)}</div>
<div class="tl-title"><a href="${href}" target="_blank" rel="noopener">${he(r.title)}</a></div>
<div class="tl-src">${he(r.source ?? '')}${r.country_id ? ` · ${he(r.country_id)}` : ''}</div>
${r.description ? `<p style="font-size:12px;color:#666;margin-top:6px;line-height:1.4;">${he(String(r.description).slice(0, 180))}</p>` : ''}
</div></div>`;
}

function compareSection(loc: ResolvedLocation, articles: Record<string, unknown>[]): string {
  const header = loc.type === 'country' && loc.codes.length === 1
    ? `<div class="cmp-flag">${flagEmoji(loc.codes[0])}</div><div class="cmp-name">${he(loc.label)}</div>`
    : `<div class="cmp-flag">🌍</div><div class="cmp-name">${he(loc.label)}</div>`;
  const rows = articles.length
    ? articles.map(r => {
        const href = safeHref(r.original_url, `${SITE}/article/${encodeURIComponent(String(r.id))}`);
        return `<div class="cmp-row">
<div class="cmp-row-title"><a href="${href}" target="_blank" rel="noopener">${he(r.title)}</a></div>
<div class="cmp-row-meta">${he(r.source ?? '')} · ${fmtDate(r.published_at)}</div>
</div>`;
      }).join('')
    : '<div class="cmp-empty">No articles found</div>';
  return `<div class="cmp-col"><div class="cmp-hd">${header}</div><div class="cmp-body">${rows}</div></div>`;
}

function sect(label: string): string {
  return `<div class="sect"><span class="sect-label">${he(label)}</span><div class="sect-rule"></div></div>`;
}

// ── Result builders ────────────────────────────────────────────────────────

function ok(text: string, html?: string): McpToolResult {
  const content: McpContent[] = [{ type: 'text', text }];
  if (html) {
    content.push({ type: 'resource', resource: { uri: 'ui://mukoko-news/result', mimeType: 'text/html', text: html } });
  }
  return { content };
}

function err(message: string): McpToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

// ── Tool implementations ───────────────────────────────────────────────────

async function toolGetBriefing(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const focus = sanitize(args.focus, 100);
  const limit = clamp(args.limit, 1, 12, 8);

  const where: string[] = ["status = 'published'"];
  const bindings: unknown[] = [];
  let heading = 'Africa Today';
  let isCategoryFocus = false;

  if (focus) {
    const loc = resolveLocation(focus);
    if (loc.codes.length) {
      where.push(`country_id IN ${inClause(loc.codes, bindings)}`);
      heading = `${locationHeader(loc)} Briefing`;
    } else {
      // Treat as category/topic
      where.push('LOWER(category) = LOWER(?)');
      bindings.push(focus);
      heading = `${focus.charAt(0).toUpperCase() + focus.slice(1)} Briefing`;
      isCategoryFocus = true;
    }
  }

  bindings.push(limit);
  const { results } = await db.prepare(
    `SELECT id, title, description, source, category, country_id, published_at,
     original_url, author, tags, view_count, like_count, ai_summary, trending_score
     FROM articles WHERE ${where.join(' AND ')} ORDER BY published_at DESC LIMIT ?`
  ).bind(...bindings).all<Record<string, unknown>>();

  if (!results.length) return ok(`No recent articles found for: "${focus || 'Africa'}"`);

  // Trending tags from results
  const tagFreq = new Map<string, number>();
  for (const r of results) {
    if (r.tags) {
      for (const t of String(r.tags).split(',').map(s => s.trim()).filter(Boolean)) {
        tagFreq.set(t, (tagFreq.get(t) ?? 0) + 1);
      }
    }
  }
  const topTags = [...tagFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);

  // Text output
  const textParts = [`## ${heading}\n`];
  textParts.push(`**Top Story:**\n${articleToText(results[0])}`);
  if (results.length > 1) {
    textParts.push('\n**Latest:**');
    results.slice(1).forEach((r, i) => textParts.push(`\n[${i + 2}] ${r.title}\n   ${r.source} · ${r.published_at}`));
  }
  if (topTags.length) textParts.push(`\n**Trending:** ${topTags.join(', ')}`);

  // HTML output
  let locBanner = '';
  if (focus) {
    const loc = resolveLocation(focus);
    const flag = loc.codes.length === 1 ? flagEmoji(loc.codes[0]) : '🌍';
    locBanner = `<div class="loc-banner"><div class="loc-flag">${flag}</div><div><div class="loc-name">${he(heading)}</div><div class="loc-sub">${results.length} articles${topTags.length ? ` · Trending: ${topTags.slice(0, 3).join(', ')}` : ''}</div></div></div>`;
  }

  const topCard = articleCard(results[0]);
  const latestMinis = results.slice(1).map((r, i) => miniCard(r, i + 1)).join('');
  const trendingPills = topTags.length
    ? `${sect('Trending Topics')}<div class="pills">${topTags.map(t => `<span class="pill">${he(t)}</span>`).join('')}</div>`
    : '';

  const html = page(heading,
    `${locBanner || `<div class="hd"><h1>🐝 ${he(heading)}</h1></div>`}` +
    sect('Top Story') + topCard +
    (latestMinis ? sect('Latest') + latestMinis : '') +
    trendingPills +
    `<div class="ft"><a href="${SITE}">Mukoko News — Pan-African Coverage</a></div>`
  );

  return ok(textParts.join('\n'), html);
}

async function toolTrackStory(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const topic = sanitize(args.topic, 200);
  if (!topic) return err('"topic" is required');

  const since = sanitize(args.since, 20);
  const sinceInterval = SINCE_MAP[since] ?? '-7 days';
  const country = sanitize(args.country, 5).toUpperCase();
  const limit = clamp(args.limit, 1, 20, 10);

  const where: string[] = [
    "status = 'published'",
    `published_at >= datetime('now', '${sinceInterval}')`,
    "(title LIKE ? OR description LIKE ? OR content_search LIKE ? OR LOWER(tags) LIKE LOWER(?))",
  ];
  const bindings: unknown[] = [`%${topic}%`, `%${topic}%`, `%${topic}%`, `%${topic}%`];

  if (country) { where.push('country_id = ?'); bindings.push(country); }
  bindings.push(limit);

  const { results } = await db.prepare(
    `SELECT id, title, description, source, category, country_id, published_at,
     original_url, author, tags, view_count, like_count, ai_summary
     FROM articles WHERE ${where.join(' AND ')} ORDER BY published_at ASC LIMIT ?`
  ).bind(...bindings).all<Record<string, unknown>>();

  if (!results.length) return ok(`No articles found for "${topic}" in the last ${since || 'week'}. Try a broader topic or extend the time window.`);

  const heading = `Story: ${topic}`;
  const sinceLabel = since === 'today' ? 'today' : since === 'month' ? 'this month' : 'this week';

  const textLines = [`## ${heading} — ${sinceLabel}\n${results.length} article(s)\n`];
  results.forEach((r, i) => {
    textLines.push(`${fmtDate(r.published_at)} — ${r.source}\n  ${r.title}\n  ${r.original_url}\n`);
    if (i === results.length - 1) textLines.push(`→ Latest: ${r.title}`);
  });

  const timelineItems = results.map((r, i) => timelineCard(r, i === results.length - 1)).join('');
  const html = page(heading,
    `<div class="loc-banner" style="background:linear-gradient(135deg,var(--go),var(--tc))">` +
    `<div class="loc-flag">📰</div><div><div class="loc-name">${he(heading)}</div>` +
    `<div class="loc-sub">${results.length} article${results.length !== 1 ? 's' : ''} · ${sinceLabel}</div></div></div>` +
    sect('Timeline') +
    `<div class="timeline">${timelineItems}</div>` +
    `<div class="ft"><a href="${SITE}">Mukoko News — Pan-African Coverage</a></div>`
  );

  return ok(textLines.join('\n'), html);
}

async function toolGetLocationNews(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const locationInput = sanitize(args.location, 100);
  if (!locationInput) return err('"location" is required');

  const loc = resolveLocation(locationInput);
  if (!loc.codes.length) {
    return err(
      `Could not resolve location: "${locationInput}". ` +
      'Try a country code (ZW, KE, NG), country name (Zimbabwe, Nigeria), ' +
      'region name (East Africa, Southern Africa), or city name (Harare, Nairobi, Lagos).'
    );
  }

  const category = sanitize(args.category, 50);
  const limit = clamp(args.limit, 1, 20, 10);

  const where: string[] = ['status = \'published\'', `country_id IN ${inClause(loc.codes, [])}`];
  const bindings: unknown[] = [...loc.codes];

  if (category) { where.push('LOWER(category) = LOWER(?)'); bindings.push(category); }
  bindings.push(limit);

  const [{ results }, { results: sources }] = await Promise.all([
    db.prepare(
      `SELECT id, title, description, source, category, country_id, published_at,
       original_url, author, tags, view_count, like_count, ai_summary
       FROM articles WHERE ${where.join(' AND ')} ORDER BY published_at DESC LIMIT ?`
    ).bind(...bindings).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT name, country_id, website_url, credibility_score
       FROM news_sources WHERE enabled = 1 AND country_id IN ${inClause(loc.codes, [])}
       ORDER BY quality_rating DESC LIMIT 8`
    ).bind(...loc.codes).all<Record<string, unknown>>(),
  ]);

  if (!results.length) return ok(`No articles found for location: "${locationInput}"`);

  const heading = locationHeader(loc);
  const sub = category ? ` · ${category}` : '';

  const textLines = [`## ${heading}${sub}\n${results.length} recent article(s)\n`];
  results.forEach((r, i) => textLines.push(`${articleToText(r, i)}\n`));
  if (sources.length) {
    textLines.push('\nActive sources:');
    sources.forEach(s => textLines.push(`• ${s.name} (${s.country_id})`));
  }

  const flag = loc.type === 'country' && loc.codes.length === 1 ? flagEmoji(loc.codes[0]) : '🌍';
  const banner = `<div class="loc-banner"><div class="loc-flag">${flag}</div>` +
    `<div><div class="loc-name">${he(heading)}${sub ? he(sub) : ''}</div>` +
    `<div class="loc-sub">${results.length} articles${sources.length ? ` · ${sources.length} sources` : ''}</div></div></div>`;

  const cards = results.map((r, i) => miniCard(r, i)).join('');
  const srcRows = sources.map(s => `<div class="src-row">
<div class="src-cc">${he(String(s.country_id ?? '??'))}</div>
<div><div class="src-name">${he(s.name)}${s.website_url ? ` <a href="${safeHref(s.website_url, '#')}" target="_blank" rel="noopener" style="color:var(--co);font-size:11px">↗</a>` : ''}</div>
<div class="cred">${credPips(s.credibility_score)}</div></div></div>`).join('');

  const html = page(heading,
    banner +
    sect('Latest Articles') + cards +
    (srcRows ? sect('News Sources') + srcRows : '') +
    `<div class="ft"><a href="${SITE}">Mukoko News — Pan-African Coverage</a></div>`
  );

  return ok(textLines.join('\n'), html);
}

async function toolCompareLocations(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const rawLocations = Array.isArray(args.locations) ? (args.locations as unknown[]) : [];
  if (rawLocations.length < 2) return err('"locations" must be an array of 2–4 country codes or region names');

  const locations = rawLocations.slice(0, 4).map(l => resolveLocation(String(l)));
  const invalid = locations.filter(l => !l.codes.length);
  if (invalid.length) {
    return err(`Could not resolve: ${invalid.map(l => `"${l.label}"`).join(', ')}. Use country codes (ZW, KE) or region names (East Africa, Southern Africa).`);
  }

  const topic = sanitize(args.topic, 200);
  const limit = clamp(args.limit, 1, 10, 5);

  const sections = await Promise.all(locations.map(async loc => {
    const bindings: unknown[] = [...loc.codes];
    const where: string[] = ['status = \'published\'', `country_id IN ${inClause(loc.codes, [])}`];
    if (topic) {
      where.push('(title LIKE ? OR description LIKE ? OR content_search LIKE ?)');
      bindings.push(`%${topic}%`, `%${topic}%`, `%${topic}%`);
    }
    bindings.push(limit);

    const { results } = await db.prepare(
      `SELECT id, title, description, source, category, country_id, published_at,
       original_url, author, tags
       FROM articles WHERE ${where.join(' AND ')} ORDER BY published_at DESC LIMIT ?`
    ).bind(...bindings).all<Record<string, unknown>>();

    return { loc, articles: results };
  }));

  const heading = `Compare: ${locations.map(l => l.label).join(' vs ')}`;
  const sub = topic ? ` on "${topic}"` : '';

  const textLines = [`## ${heading}${sub}\n`];
  for (const { loc, articles } of sections) {
    textLines.push(`### ${locationHeader(loc)}`);
    if (articles.length) {
      articles.forEach((r, i) => textLines.push(`  [${i + 1}] ${r.title} (${r.source})`));
    } else {
      textLines.push('  No articles found');
    }
    textLines.push('');
  }

  const compareCols = sections.map(({ loc, articles }) => compareSection(loc, articles)).join('');
  const html = page(heading,
    `<div class="hd"><h1>🌍 ${he(heading)}</h1>${sub ? `<span class="sub">${he(sub)}</span>` : ''}</div>` +
    compareCols +
    `<div class="ft"><a href="${SITE}">Mukoko News — Pan-African Coverage</a></div>`
  );

  return ok(textLines.join('\n'), html);
}

async function toolGetSourceView(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const source = sanitize(args.source, 100);
  if (!source) return err('"source" is required');
  const topic = sanitize(args.topic, 200);
  const limit = clamp(args.limit, 1, 20, 8);

  const where: string[] = ["status = 'published'", 'LOWER(source) LIKE LOWER(?)'];
  const bindings: unknown[] = [`%${source}%`];

  if (topic) {
    where.push('(title LIKE ? OR description LIKE ? OR content_search LIKE ?)');
    bindings.push(`%${topic}%`, `%${topic}%`, `%${topic}%`);
  }
  bindings.push(limit);

  const [{ results }, sourceRow] = await Promise.all([
    db.prepare(
      `SELECT id, title, description, source, category, country_id, published_at,
       original_url, author, tags, view_count, like_count, ai_summary
       FROM articles WHERE ${where.join(' AND ')} ORDER BY published_at DESC LIMIT ?`
    ).bind(...bindings).all<Record<string, unknown>>(),
    db.prepare(
      'SELECT name, country_id, website_url, description, credibility_score FROM news_sources WHERE LOWER(name) LIKE LOWER(?) LIMIT 1'
    ).bind(`%${source}%`).first<Record<string, unknown>>(),
  ]);

  if (!results.length) return ok(`No articles found from source: "${source}"${topic ? ` on "${topic}"` : ''}`);

  const sourceName = sourceRow?.name ?? results[0]?.source ?? source;
  const heading = String(sourceName);
  const sub = topic ? `on "${topic}"` : `${results.length} recent articles`;

  const textLines = [`## ${heading}${topic ? ` on "${topic}"` : ''}\n`];
  if (sourceRow?.description) textLines.push(`${sourceRow.description}\n`);
  results.forEach((r, i) => textLines.push(`${articleToText(r, i)}\n`));

  const srcFlag = sourceRow?.country_id ? `${flagEmoji(String(sourceRow.country_id))} ` : '';
  const banner = `<div class="loc-banner"><div class="loc-flag">📰</div>` +
    `<div><div class="loc-name">${srcFlag}${he(heading)}</div>` +
    `<div class="loc-sub">${he(sub)}</div></div></div>`;

  const srcMeta = sourceRow ? `<div class="src-row" style="margin-bottom:14px">
<div class="src-cc">${he(String(sourceRow.country_id ?? '??'))}</div>
<div><div class="src-name">${he(sourceName)}${sourceRow.website_url ? ` <a href="${safeHref(sourceRow.website_url, '#')}" target="_blank" rel="noopener" style="color:var(--co);font-size:11px">↗</a>` : ''}</div>
${sourceRow.description ? `<div class="src-meta">${he(sourceRow.description)}</div>` : ''}
<div class="cred">${credPips(sourceRow.credibility_score)}</div></div></div>` : '';

  const cards = results.map((r, i) => miniCard(r, i)).join('');
  const html = page(heading,
    banner + srcMeta +
    sect('Articles') + cards +
    `<div class="ft"><a href="${SITE}">Mukoko News — Pan-African Coverage</a></div>`
  );

  return ok(textLines.join('\n'), html);
}

async function toolFindStories(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const q = sanitize(args.q, 200);
  const author = sanitize(args.author, 100);
  const tag = sanitize(args.tag, 100);
  const category = sanitize(args.category, 50);
  const country = sanitize(args.country, 5).toUpperCase();
  const limit = clamp(args.limit, 1, 20, 10);

  if (!q && !author && !tag && !category && !country) {
    return err('Provide at least one of: q, author, tag, category, or country');
  }

  const where: string[] = ["status = 'published'"];
  const bindings: unknown[] = [];

  if (q) {
    where.push('(title LIKE ? OR description LIKE ? OR content_search LIKE ?)');
    bindings.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (author) { where.push('LOWER(author) LIKE LOWER(?)'); bindings.push(`%${author}%`); }
  if (tag) {
    where.push('(LOWER(tags) LIKE LOWER(?) OR EXISTS (SELECT 1 FROM article_keywords ak WHERE ak.article_id = articles.id AND LOWER(ak.keyword) = LOWER(?)))');
    bindings.push(`%${tag}%`, tag);
  }
  if (category) { where.push('LOWER(category) = LOWER(?)'); bindings.push(category); }
  if (country) { where.push('country_id = ?'); bindings.push(country); }
  bindings.push(limit);

  const { results } = await db.prepare(
    `SELECT id, title, description, source, category, country_id, published_at,
     original_url, author, tags, view_count, like_count, ai_summary
     FROM articles WHERE ${where.join(' AND ')} ORDER BY published_at DESC LIMIT ?`
  ).bind(...bindings).all<Record<string, unknown>>();

  const filterParts = [q && `"${q}"`, author && `author: ${author}`, tag && `#${tag}`, category, country].filter(Boolean).join(' · ');
  if (!results.length) return ok(`No articles found for: ${filterParts}`);

  const text = results.map((r, i) => articleToText(r, i)).join('\n\n---\n\n');
  const cards = results.map((r, i) => miniCard(r, i)).join('');
  const html = page(`Search: ${filterParts}`,
    `<div class="hd"><h1>🔍 ${he(filterParts)}</h1><span class="sub">${results.length} result${results.length !== 1 ? 's' : ''}</span></div>` +
    cards +
    `<div class="ft"><a href="${SITE}">Mukoko News — Pan-African Coverage</a></div>`
  );

  return ok(`Found ${results.length} article(s) for ${filterParts}:\n\n${text}`, html);
}

async function toolGetArticle(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const id = sanitize(args.id, 100);
  if (!id) return err('"id" is required');

  const isNumeric = /^\d+$/.test(id);
  const row = await db.prepare(
    isNumeric
      ? "SELECT * FROM articles WHERE id = ? AND status = 'published' LIMIT 1"
      : "SELECT * FROM articles WHERE slug = ? AND status = 'published' LIMIT 1"
  ).bind(isNumeric ? Number(id) : id).first<Record<string, unknown>>();

  if (!row) return err(`Article not found: ${id}`);
  const html = page(String(row.title ?? 'Article'),
    `<div class="hd"><h1>📄 ${he(row.title)}</h1></div>` +
    articleCard(row) +
    `<div class="ft"><a href="${SITE}">Mukoko News — Pan-African Coverage</a></div>`
  );
  return ok(articleToText(row), html);
}

async function toolListCategories(db: D1DB): Promise<McpToolResult> {
  const { results } = await db.prepare(
    `SELECT c.id, c.name, c.description, c.emoji, COUNT(a.id) AS article_count
     FROM categories c LEFT JOIN articles a ON a.category_id = c.id AND a.status = 'published'
     WHERE c.enabled = 1 GROUP BY c.id ORDER BY article_count DESC`
  ).all<Record<string, unknown>>();

  if (!results.length) return ok('No categories found.');

  const text = results.map(r =>
    `${r.emoji ?? '📰'} ${r.name} (${r.id}) — ${r.article_count} articles${r.description ? `\n   ${r.description}` : ''}`
  ).join('\n\n');

  const rows = results.map(r => `<div class="cat-row">
<div class="cat-em">${he(r.emoji ?? '📰')}</div>
<div style="flex:1;min-width:0"><div class="cat-name">${he(r.name)}</div>
<div class="cat-cnt">${r.article_count} article${Number(r.article_count) !== 1 ? 's' : ''}</div>
${r.description ? `<div class="cat-desc">${he(r.description)}</div>` : ''}</div>
<a href="${SITE}/category/${he(r.id)}" target="_blank" rel="noopener" style="color:var(--co);font-size:12px;font-weight:600">Browse →</a>
</div>`).join('');

  const html = page('Categories',
    `<div class="hd"><h1>🐝 Categories</h1><span class="sub">${results.length} topics</span></div>` +
    rows + `<div class="ft"><a href="${SITE}">Mukoko News</a></div>`
  );
  return ok(`Categories on Mukoko News:\n\n${text}`, html);
}

async function toolListSources(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const country = sanitize(args.country, 5).toUpperCase();
  const where = ['enabled = 1'];
  const bindings: unknown[] = [];
  if (country) { where.push('country_id = ?'); bindings.push(country); }

  const { results } = await db.prepare(
    `SELECT name, country_id, website_url, description, quality_rating, credibility_score
     FROM news_sources WHERE ${where.join(' AND ')} ORDER BY quality_rating DESC LIMIT 50`
  ).bind(...bindings).all<Record<string, unknown>>();

  if (!results.length) return ok('No sources found.');

  const text = results.map(r =>
    `• ${r.name} (${r.country_id}) — credibility ${Number(r.credibility_score ?? 1).toFixed(1)}/1.0${r.website_url ? `\n  ${r.website_url}` : ''}`
  ).join('\n\n');

  const rows = results.map(r => `<div class="src-row">
<div class="src-cc">${he(String(r.country_id ?? '??'))}</div>
<div style="flex:1;min-width:0"><div class="src-name">${he(r.name)}${r.website_url ? ` <a href="${safeHref(r.website_url, '#')}" target="_blank" rel="noopener" style="color:var(--co);font-size:11px">↗</a>` : ''}</div>
<div class="src-meta">${he(r.country_id)}</div>
<div class="cred">${credPips(r.credibility_score)}</div></div>
</div>`).join('');

  const html = page('News Sources',
    `<div class="hd"><h1>🐝 News Sources</h1><span class="sub">${results.length} publications</span></div>` +
    rows + `<div class="ft"><a href="${SITE}">Mukoko News</a></div>`
  );
  return ok(`Active news sources:\n\n${text}`, html);
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

  const text = `Mukoko News — Platform Statistics\n\nTotal articles: ${total}\nActive sources: ${sources}\nCategories: ${categories}\nPublished today: ${today}\n\nCoverage: Zimbabwe and 15 other African countries.`;
  const html = page('Platform Stats',
    `<div class="hd"><h1>🐝 Mukoko News</h1><span class="sub">Platform Statistics</span></div>
<div class="stat-grid">
  <div class="stat-box"><div class="stat-n">${total.toLocaleString()}</div><div class="stat-l">Total Articles</div></div>
  <div class="stat-box"><div class="stat-n">${today.toLocaleString()}</div><div class="stat-l">Published Today</div></div>
  <div class="stat-box"><div class="stat-n">${sources}</div><div class="stat-l">Active Sources</div></div>
  <div class="stat-box"><div class="stat-n">${categories}</div><div class="stat-l">Categories</div></div>
</div>
<p style="font-size:12px;color:#999;text-align:center">Pan-African coverage across 16 countries.</p>
<div class="ft"><a href="${SITE}">Visit Mukoko News</a></div>`
  );
  return ok(text, html);
}

async function toolGetMyFeed(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const userId = sanitize(args.user_id, 100);
  if (!userId) return err('"user_id" is required');
  const limit = clamp(args.limit, 1, 20, 12);

  const [{ results: follows }, { results: recentLikes }] = await Promise.all([
    db.prepare(
      'SELECT follow_type, follow_id FROM user_follows WHERE user_id = ?'
    ).bind(userId).all<{ follow_type: string; follow_id: string }>(),
    db.prepare(
      "SELECT a.category FROM user_likes ul JOIN articles a ON ul.article_id = a.id WHERE ul.user_id = ? AND a.category IS NOT NULL ORDER BY ul.created_at DESC LIMIT 20"
    ).bind(userId).all<{ category: string }>(),
  ]);

  const followedSources = follows.filter(f => f.follow_type === 'source').map(f => f.follow_id);
  const followedCategories = follows.filter(f => f.follow_type === 'category').map(f => f.follow_id);
  const followedAuthors = follows.filter(f => f.follow_type === 'author').map(f => f.follow_id);
  const likedCategories = new Set(recentLikes.map(r => r.category.toLowerCase()));

  if (!followedSources.length && !followedCategories.length && !followedAuthors.length && !likedCategories.size) {
    return ok(
      'No personalisation data found. Follow sources, categories, or authors on Mukoko News to get a curated feed.'
    );
  }

  const where: string[] = ["status = 'published'"];
  const bindings: unknown[] = [];
  const orClauses: string[] = [];

  if (followedSources.length) orClauses.push(`source_id IN ${inClause(followedSources, bindings)}`);
  if (followedCategories.length) orClauses.push(`category_id IN ${inClause(followedCategories, bindings)}`);
  if (followedAuthors.length) orClauses.push(`LOWER(author) IN ${inClause(followedAuthors.map(a => a.toLowerCase()), bindings)}`);
  if (!orClauses.length && likedCategories.size) {
    orClauses.push(`LOWER(category) IN ${inClause([...likedCategories], bindings)}`);
  }

  if (orClauses.length) where.push(`(${orClauses.join(' OR ')})`);
  bindings.push(limit);

  const { results } = await db.prepare(
    `SELECT id, title, description, source, category, country_id, published_at,
     original_url, author, tags, ai_summary, trending_score
     FROM articles WHERE ${where.join(' AND ')} ORDER BY published_at DESC LIMIT ?`
  ).bind(...bindings).all<Record<string, unknown>>();

  if (!results.length) {
    return ok('No recent articles found matching your followed sources and categories. Try expanding your follows.');
  }

  const contextParts: string[] = [];
  if (followedSources.length) contextParts.push(`${followedSources.length} source${followedSources.length !== 1 ? 's' : ''}`);
  if (followedCategories.length) contextParts.push(`${followedCategories.length} categor${followedCategories.length !== 1 ? 'ies' : 'y'}`);
  if (followedAuthors.length) contextParts.push(`${followedAuthors.length} author${followedAuthors.length !== 1 ? 's' : ''}`);
  const contextLabel = contextParts.length ? `Following: ${contextParts.join(', ')}` : 'Based on your likes';

  const heading = 'My Feed';
  const textLines = [`## ${heading}\n${contextLabel} · ${results.length} article(s)\n`];
  results.forEach((r, i) => textLines.push(`${articleToText(r, i)}\n`));

  const banner = `<div class="loc-banner" style="background:linear-gradient(135deg,#1a1a2e,var(--tz))">` +
    `<div class="loc-flag">🐝</div><div><div class="loc-name">${he(heading)}</div>` +
    `<div class="loc-sub">${he(contextLabel)} · ${results.length} article${results.length !== 1 ? 's' : ''}</div></div></div>`;

  const cards = results.map((r, i) => miniCard(r, i)).join('');
  const html = page(heading,
    banner +
    sect('Your Personalised Feed') + cards +
    `<div class="ft"><a href="${SITE}">Mukoko News — Pan-African Coverage</a></div>`
  );

  return ok(textLines.join('\n'), html);
}

async function toolGetTrendingAnalytics(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const locationInput = sanitize(args.location, 100);
  const period = sanitize(args.period, 20);
  const sinceInterval = SINCE_MAP[period] ?? '-1 days';
  const limit = clamp(args.limit, 1, 20, 10);

  const loc = locationInput ? resolveLocation(locationInput) : null;
  if (locationInput && !loc?.codes.length) {
    return err(`Could not resolve location: "${locationInput}". Use a country code, country name, or region name.`);
  }
  const locCodes = loc?.codes ?? [];
  const locCondA = locCodes.length ? `AND a.country_id IN ${inClause(locCodes, [])}` : '';
  const locCond = locCodes.length ? `AND country_id IN ${inClause(locCodes, [])}` : '';

  const [
    { results: keywords },
    { results: categories },
    { results: sources },
    totalRow,
  ] = await Promise.all([
    db.prepare(
      `SELECT ak.keyword, COUNT(*) AS cnt FROM article_keywords ak JOIN articles a ON ak.article_id = a.id WHERE a.status = 'published' AND a.published_at >= datetime('now', ?) ${locCondA} GROUP BY ak.keyword ORDER BY cnt DESC LIMIT ?`
    ).bind(sinceInterval, ...locCodes, limit).all<{ keyword: string; cnt: number }>(),
    db.prepare(
      `SELECT category, COUNT(*) AS cnt FROM articles WHERE status = 'published' AND published_at >= datetime('now', ?) AND category IS NOT NULL ${locCond} GROUP BY category ORDER BY cnt DESC LIMIT 8`
    ).bind(sinceInterval, ...locCodes).all<{ category: string; cnt: number }>(),
    db.prepare(
      `SELECT source, COUNT(*) AS cnt FROM articles WHERE status = 'published' AND published_at >= datetime('now', ?) ${locCond} GROUP BY source ORDER BY cnt DESC LIMIT 8`
    ).bind(sinceInterval, ...locCodes).all<{ source: string; cnt: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS n FROM articles WHERE status = 'published' AND published_at >= datetime('now', ?) ${locCond}`
    ).bind(sinceInterval, ...locCodes).first<{ n: number }>(),
  ]);

  let countryRows: Array<{ country_id: string; cnt: number }> = [];
  if (!locCodes.length) {
    const { results } = await db.prepare(
      `SELECT country_id, COUNT(*) AS cnt FROM articles WHERE status = 'published' AND published_at >= datetime('now', ?) GROUP BY country_id ORDER BY cnt DESC LIMIT 16`
    ).bind(sinceInterval).all<{ country_id: string; cnt: number }>();
    countryRows = results;
  }

  const total = totalRow?.n ?? 0;
  const periodLabel = period === 'today' ? 'today' : period === 'month' ? 'this month' : 'this week';
  const heading = loc ? `${locationHeader(loc)} Trends` : 'Africa Trends';

  if (!total) return ok(`No articles found for ${loc?.label ?? 'Africa'} ${periodLabel}.`);

  const textLines = [`## ${heading} — ${periodLabel} (${total.toLocaleString()} articles)\n`];
  if (keywords.length) {
    textLines.push('**Top Keywords:**');
    keywords.forEach((k, i) => textLines.push(`  ${i + 1}. ${k.keyword} (${k.cnt})`));
    textLines.push('');
  }
  if (categories.length) {
    textLines.push('**By Category:**');
    categories.forEach(c => textLines.push(`  • ${c.category}: ${c.cnt} articles (${Math.round(c.cnt / total * 100)}%)`));
    textLines.push('');
  }
  if (sources.length) {
    textLines.push('**Most Active Sources:**');
    sources.forEach(s => textLines.push(`  • ${s.source}: ${s.cnt}`));
    textLines.push('');
  }
  if (countryRows.length) {
    textLines.push('**By Country:**');
    countryRows.forEach(c => textLines.push(`  ${flagEmoji(c.country_id)} ${COUNTRY_LABELS[c.country_id] ?? c.country_id}: ${c.cnt}`));
  }

  const flag = loc?.codes.length === 1 ? flagEmoji(loc.codes[0]) : '📊';
  const banner = `<div class="loc-banner"><div class="loc-flag">${flag}</div>` +
    `<div><div class="loc-name">${he(heading)}</div>` +
    `<div class="loc-sub">${he(periodLabel)} · ${total.toLocaleString()} articles</div></div></div>`;

  const maxKw = keywords[0]?.cnt ?? 1;
  const kwHtml = keywords.map(k =>
    `<div class="trend-row"><div class="trend-label">${he(k.keyword)}</div>` +
    `<div class="trend-bar-wrap"><div class="trend-bar" style="width:${Math.round(k.cnt / maxKw * 100)}%"></div></div>` +
    `<div class="trend-cnt">${k.cnt}</div></div>`
  ).join('');

  const maxCat = categories[0]?.cnt ?? 1;
  const catHtml = categories.map(c => {
    const pct = Math.round(c.cnt / total * 100);
    return `<div class="trend-row"><div class="trend-label">${he(c.category)}</div>` +
      `<div class="trend-bar-wrap"><div class="trend-bar" style="width:${Math.round(c.cnt / maxCat * 100)}%;background:var(--co)"></div></div>` +
      `<div class="trend-cnt">${c.cnt} <span style="color:#bbb;font-size:9px">${pct}%</span></div></div>`;
  }).join('');

  const srcHtml = sources.map(s =>
    `<div class="mini"><div class="mini-idx">📰</div><div class="mini-body">` +
    `<div class="mini-title">${he(s.source)}</div>` +
    `<div class="mini-meta">${s.cnt} article${s.cnt !== 1 ? 's' : ''} ${periodLabel}</div></div></div>`
  ).join('');

  const maxCountry = countryRows[0]?.cnt ?? 1;
  const countryHtml = countryRows.map(c =>
    `<div class="trend-row"><div class="trend-label">${flagEmoji(c.country_id)} ${he(COUNTRY_LABELS[c.country_id] ?? c.country_id)}</div>` +
    `<div class="trend-bar-wrap"><div class="trend-bar" style="width:${Math.round(c.cnt / maxCountry * 100)}%;background:var(--ma)"></div></div>` +
    `<div class="trend-cnt">${c.cnt}</div></div>`
  ).join('');

  const html = page(heading,
    banner +
    (kwHtml ? sect('Trending Keywords') + `<div class="trend-list">${kwHtml}</div>` : '') +
    (catHtml ? sect('By Category') + `<div class="trend-list">${catHtml}</div>` : '') +
    (srcHtml ? sect('Most Active Sources') + srcHtml : '') +
    (countryHtml ? sect('By Country') + `<div class="trend-list">${countryHtml}</div>` : '') +
    `<div class="ft"><a href="${SITE}">Mukoko News — Open Data Analytics</a></div>`
  );

  return ok(textLines.join('\n'), html);
}

async function toolDetectSurge(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const locationInput = sanitize(args.location, 100);
  const limit = clamp(args.limit, 1, 20, 10);

  const loc = locationInput ? resolveLocation(locationInput) : null;
  if (locationInput && !loc?.codes.length) {
    return err(`Could not resolve location: "${locationInput}". Use a country code, country name, or region name.`);
  }
  const locCodes = loc?.codes ?? [];
  const locCondA = locCodes.length ? `AND a.country_id IN ${inClause(locCodes, [])}` : '';
  const locCond = locCodes.length ? `AND country_id IN ${inClause(locCodes, [])}` : '';

  // Compare last 24h vs 7-day rolling baseline for keywords and categories
  const [
    { results: recentKw },
    { results: baselineKw },
    { results: recentCat },
    { results: baselineCat },
  ] = await Promise.all([
    db.prepare(
      `SELECT ak.keyword, COUNT(*) AS cnt FROM article_keywords ak JOIN articles a ON ak.article_id = a.id WHERE a.status = 'published' AND a.published_at >= datetime('now', '-1 days') ${locCondA} GROUP BY ak.keyword HAVING cnt >= 2`
    ).bind(...locCodes).all<{ keyword: string; cnt: number }>(),
    db.prepare(
      `SELECT ak.keyword, CAST(COUNT(*) AS REAL) / 7 AS daily_avg FROM article_keywords ak JOIN articles a ON ak.article_id = a.id WHERE a.status = 'published' AND a.published_at >= datetime('now', '-8 days') AND a.published_at < datetime('now', '-1 days') ${locCondA} GROUP BY ak.keyword`
    ).bind(...locCodes).all<{ keyword: string; daily_avg: number }>(),
    db.prepare(
      `SELECT category, COUNT(*) AS cnt FROM articles WHERE status = 'published' AND published_at >= datetime('now', '-1 days') AND category IS NOT NULL ${locCond} GROUP BY category HAVING cnt >= 2`
    ).bind(...locCodes).all<{ category: string; cnt: number }>(),
    db.prepare(
      `SELECT category, CAST(COUNT(*) AS REAL) / 7 AS daily_avg FROM articles WHERE status = 'published' AND published_at >= datetime('now', '-8 days') AND published_at < datetime('now', '-1 days') AND category IS NOT NULL ${locCond} GROUP BY category`
    ).bind(...locCodes).all<{ category: string; daily_avg: number }>(),
  ]);

  const kwBase = new Map(baselineKw.map(r => [r.keyword, r.daily_avg]));
  const catBase = new Map(baselineCat.map(r => [r.category, r.daily_avg]));

  type SurgeItem = { label: string; type: 'keyword' | 'category'; recent: number; avg: number; ratio: number };
  const surges: SurgeItem[] = [];

  for (const r of recentKw) {
    const avg = kwBase.get(r.keyword) ?? 0;
    const ratio = avg > 0 ? r.cnt / avg : Math.min(r.cnt * 2, 20);
    if (ratio >= 2) surges.push({ label: r.keyword, type: 'keyword', recent: r.cnt, avg: Math.round(avg * 10) / 10, ratio: Math.round(ratio * 10) / 10 });
  }
  for (const r of recentCat) {
    const avg = catBase.get(r.category) ?? 0;
    const ratio = avg > 0 ? r.cnt / avg : Math.min(r.cnt * 2, 20);
    if (ratio >= 2) surges.push({ label: r.category, type: 'category', recent: r.cnt, avg: Math.round(avg * 10) / 10, ratio: Math.round(ratio * 10) / 10 });
  }

  surges.sort((a, b) => b.ratio - a.ratio);
  const top = surges.slice(0, limit);
  const locationLabel = loc?.label ?? 'Africa';
  const heading = `Surge Detection — ${locationLabel}`;

  if (!top.length) {
    return ok(`No significant coverage surges detected in ${locationLabel} in the last 24 hours. News patterns appear normal.`);
  }

  const textLines = [`## ${heading}\n${top.length} surge${top.length !== 1 ? 's' : ''} detected in the last 24 hours:\n`];
  for (const s of top) {
    const detail = s.avg > 0
      ? `${s.ratio}× above baseline (${s.recent} articles today vs ${s.avg}/day avg)`
      : `${s.recent} articles today (new topic, no prior baseline)`;
    textLines.push(`🔺 ${s.label} [${s.type}] — ${detail}`);
  }

  const maxRatio = top[0]?.ratio ?? 1;
  const surgeRows = top.map(s => {
    const badge = s.type === 'keyword'
      ? `<span class="bk bk-cat" style="font-size:9px">keyword</span>`
      : `<span class="bk bk-cc" style="font-size:9px">category</span>`;
    const w = Math.round(Math.min(s.ratio / maxRatio, 1) * 100);
    const detail = s.avg > 0
      ? `${s.ratio}× above baseline · ${s.recent} articles today vs ${s.avg}/day average`
      : `${s.recent} articles today · no prior 7-day baseline`;
    return `<div class="surge-row">
<div class="surge-head">${badge}<span class="surge-label">${he(s.label)}</span><span class="surge-x">${he(String(s.ratio))}×</span></div>
<div class="trend-bar-wrap"><div class="trend-bar surge-bar" style="width:${w}%"></div></div>
<div class="surge-meta">${he(detail)}</div>
</div>`;
  }).join('');

  const flag = loc?.codes.length === 1 ? flagEmoji(loc.codes[0]) : '🔺';
  const banner = `<div class="loc-banner" style="background:linear-gradient(135deg,#8b1a00,#b5451b)">` +
    `<div class="loc-flag">${flag}</div>` +
    `<div><div class="loc-name">${he(heading)}</div>` +
    `<div class="loc-sub">${top.length} surge${top.length !== 1 ? 's' : ''} vs 7-day baseline · last 24 hours</div></div></div>`;

  const html = page(heading,
    banner +
    sect('Coverage Surges') +
    `<div class="surge-list">${surgeRows}</div>` +
    `<p style="margin-top:12px;font-size:11px;color:#999;text-align:center">A surge is 2× or more articles in the last 24h vs the 7-day daily average.</p>` +
    `<div class="ft"><a href="${SITE}">Mukoko News — Open Data Analytics</a></div>`
  );

  return ok(textLines.join('\n'), html);
}

async function toolGetContentAnalytics(db: D1DB, args: Record<string, unknown>): Promise<McpToolResult> {
  const locationInput = sanitize(args.location, 100);
  const period = sanitize(args.period, 20);
  const sinceInterval = SINCE_MAP[period] ?? '-7 days';

  const loc = locationInput ? resolveLocation(locationInput) : null;
  if (locationInput && !loc?.codes.length) {
    return err(`Could not resolve location: "${locationInput}". Use a country code, country name, or region name.`);
  }
  const locCodes = loc?.codes ?? [];
  const locCondA = locCodes.length ? `AND a.country_id IN ${inClause(locCodes, [])}` : '';
  const locCond = locCodes.length ? `AND country_id IN ${inClause(locCodes, [])}` : '';

  const [
    { results: categories },
    { results: countries },
    { results: keywords },
    totalRow,
  ] = await Promise.all([
    db.prepare(
      `SELECT category, COUNT(*) AS cnt FROM articles WHERE status = 'published' AND published_at >= datetime('now', ?) AND category IS NOT NULL ${locCond} GROUP BY category ORDER BY cnt DESC LIMIT 12`
    ).bind(sinceInterval, ...locCodes).all<{ category: string; cnt: number }>(),
    db.prepare(
      `SELECT country_id, COUNT(*) AS cnt FROM articles WHERE status = 'published' AND published_at >= datetime('now', ?) ${locCond} GROUP BY country_id ORDER BY cnt DESC LIMIT 16`
    ).bind(sinceInterval, ...locCodes).all<{ country_id: string; cnt: number }>(),
    db.prepare(
      `SELECT ak.keyword, COUNT(*) AS cnt FROM article_keywords ak JOIN articles a ON ak.article_id = a.id WHERE a.status = 'published' AND a.published_at >= datetime('now', ?) ${locCondA} GROUP BY ak.keyword ORDER BY cnt DESC LIMIT 15`
    ).bind(sinceInterval, ...locCodes).all<{ keyword: string; cnt: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS n FROM articles WHERE status = 'published' AND published_at >= datetime('now', ?) ${locCond}`
    ).bind(sinceInterval, ...locCodes).first<{ n: number }>(),
  ]);

  const total = totalRow?.n ?? 0;
  const periodLabel = period === 'today' ? 'today' : period === 'month' ? 'this month' : 'this week';
  const heading = loc ? `${locationHeader(loc)} Content Analytics` : 'Africa Content Analytics';

  if (!total) return ok(`No articles found for ${loc?.label ?? 'Africa'} ${periodLabel}.`);

  const textLines = [`## ${heading} — ${periodLabel}\n${total.toLocaleString()} articles analysed\n`];
  if (categories.length) {
    textLines.push('**By Category:**');
    categories.forEach(c => {
      const pct = Math.round(c.cnt / total * 100);
      textLines.push(`  • ${c.category}: ${c.cnt} (${pct}%)`);
    });
    textLines.push('');
  }
  if (countries.length > 1) {
    textLines.push('**By Country:**');
    countries.forEach(c => textLines.push(`  ${flagEmoji(c.country_id)} ${COUNTRY_LABELS[c.country_id] ?? c.country_id}: ${c.cnt}`));
    textLines.push('');
  }
  if (keywords.length) {
    textLines.push('**Top Keywords:** ' + keywords.slice(0, 12).map(k => k.keyword).join(', '));
  }

  const flag = loc?.codes.length === 1 ? flagEmoji(loc.codes[0]) : '📊';
  const banner = `<div class="loc-banner"><div class="loc-flag">${flag}</div>` +
    `<div><div class="loc-name">${he(heading)}</div>` +
    `<div class="loc-sub">${total.toLocaleString()} articles · ${periodLabel}</div></div></div>`;

  const maxCat = categories[0]?.cnt ?? 1;
  const catHtml = categories.map(c => {
    const pct = Math.round(c.cnt / total * 100);
    return `<div class="trend-row"><div class="trend-label">${he(c.category)}</div>` +
      `<div class="trend-bar-wrap"><div class="trend-bar" style="width:${Math.round(c.cnt / maxCat * 100)}%;background:var(--co)"></div></div>` +
      `<div class="trend-cnt">${c.cnt} <span style="color:#bbb;font-size:9px">${pct}%</span></div></div>`;
  }).join('');

  const maxCountry = countries[0]?.cnt ?? 1;
  const countryHtml = countries.length > 1 ? countries.map(c => {
    const pct = Math.round(c.cnt / total * 100);
    return `<div class="trend-row"><div class="trend-label">${flagEmoji(c.country_id)} ${he(COUNTRY_LABELS[c.country_id] ?? c.country_id)}</div>` +
      `<div class="trend-bar-wrap"><div class="trend-bar" style="width:${Math.round(c.cnt / maxCountry * 100)}%;background:var(--ma)"></div></div>` +
      `<div class="trend-cnt">${c.cnt} <span style="color:#bbb;font-size:9px">${pct}%</span></div></div>`;
  }).join('') : '';

  const pillsHtml = keywords.length
    ? `<div class="pills">${keywords.map(k => `<span class="pill">${he(k.keyword)}</span>`).join('')}</div>`
    : '';

  const html = page(heading,
    banner +
    (catHtml ? sect('By Category') + `<div class="trend-list">${catHtml}</div>` : '') +
    (countryHtml ? sect('By Country') + `<div class="trend-list">${countryHtml}</div>` : '') +
    (pillsHtml ? sect('Top Keywords') + pillsHtml : '') +
    `<div class="ft"><a href="${SITE}">Mukoko News — Open Data Analytics</a></div>`
  );

  return ok(textLines.join('\n'), html);
}

// ── Dispatch ───────────────────────────────────────────────────────────────

async function callTool(db: D1DB, name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  switch (name as ToolName) {
    case 'get_briefing':       return toolGetBriefing(db, args);
    case 'track_story':        return toolTrackStory(db, args);
    case 'get_location_news':  return toolGetLocationNews(db, args);
    case 'compare_locations':  return toolCompareLocations(db, args);
    case 'get_source_view':    return toolGetSourceView(db, args);
    case 'find_stories':       return toolFindStories(db, args);
    case 'get_article':        return toolGetArticle(db, args);
    case 'list_categories':    return toolListCategories(db);
    case 'list_sources':       return toolListSources(db, args);
    case 'get_stats':              return toolGetStats(db);
    case 'get_my_feed':            return toolGetMyFeed(db, args);
    case 'get_trending_analytics': return toolGetTrendingAnalytics(db, args);
    case 'detect_surge':           return toolDetectSurge(db, args);
    case 'get_content_analytics':  return toolGetContentAnalytics(db, args);
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
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let body: McpRequest;
  try {
    body = await req.json() as McpRequest;
  } catch {
    return jsonRpc(null, undefined, { code: -32700, message: 'Parse error' });
  }

  const { jsonrpc, id, method, params } = body;
  if (jsonrpc !== '2.0') return jsonRpc(id ?? null, undefined, { code: -32600, message: 'Invalid Request' });

  try {
    switch (method) {
      case 'initialize':
        return jsonRpc(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'mukoko-news', version: '2.0.0' },
          instructions:
            'You are connected to Mukoko News, a Pan-African news aggregation platform covering ' +
            'Zimbabwe and 15 other African countries. Tools are organised around tasks — use ' +
            'get_briefing for "what\'s happening in X", track_story to follow a developing story, ' +
            'get_location_news for place-specific news, compare_locations to compare countries ' +
            'side by side, and get_source_view to see how a publication is covering a topic. ' +
            'All tools understand country codes (ZW, KE, NG), country names, region names ' +
            '(East Africa, Southern Africa, West Africa), and major city names. ' +
            'For user personalisation use get_my_feed (requires user_id from the platform). ' +
            'For open data analytics use get_trending_analytics (trending topics/keywords), ' +
            'detect_surge (sudden coverage spikes vs 7-day baseline), and get_content_analytics ' +
            '(category and country breakdown) — all part of Mukoko\'s open data policy.',
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
        return jsonRpc(id, await callTool(db, name, args));
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
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
