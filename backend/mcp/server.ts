/**
 * Mukoko News MCP Server — MongoDB edition.
 *
 * All data comes from MongoDB Atlas (news database) — not D1.
 * Tools are organised around tasks, not API endpoints.
 *
 * Authentication (WorkOS):
 *   - Public tools (briefing, search, analytics) require no auth.
 *   - get_my_feed requires Authorization: Bearer <WorkOS access token>.
 *
 * Transport: Streamable HTTP (POST /api/mcp) — stateless JSON-RPC 2.0.
 */

import type { Db } from 'mongodb'
import { createRemoteJWKSet, jwtVerify } from 'jose'

// ── Types ──────────────────────────────────────────────────────────────────

interface McpRequest {
  jsonrpc: '2.0'
  id: string | number | null
  method: string
  params?: Record<string, unknown>
}

type McpContent =
  | { type: 'text'; text: string }
  | { type: 'resource'; resource: { uri: string; mimeType: string; text: string } }

interface McpToolResult {
  content: McpContent[]
  isError?: boolean
}

interface McpResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string }
}

// ── WorkOS auth ────────────────────────────────────────────────────────────

let _workosJwks: ReturnType<typeof createRemoteJWKSet> | null = null

function getWorkosJwks() {
  if (!_workosJwks) {
    _workosJwks = createRemoteJWKSet(new URL('https://identity.nyuchi.com/.well-known/jwks.json'))
  }
  return _workosJwks
}

async function verifyWorkOSToken(token: string): Promise<{ userId: string; email?: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getWorkosJwks(), {
      algorithms: ['RS256'],
      issuer: 'https://identity.nyuchi.com',
    })
    return { userId: String(payload.sub ?? ''), email: payload.email as string | undefined }
  } catch {
    return null
  }
}

function getBearerToken(req: Request): string {
  const auth = req.headers.get('Authorization') ?? ''
  return auth.startsWith('Bearer ') ? auth.slice(7) : ''
}

// ── Location resolution ────────────────────────────────────────────────────

const VALID_CODES = new Set([
  'ZW', 'ZA', 'KE', 'NG', 'GH', 'ET', 'EG', 'MA', 'TZ', 'UG', 'SN', 'CI', 'CM', 'MZ', 'ZM', 'RW',
])

const COUNTRY_LABELS: Record<string, string> = {
  ZW: 'Zimbabwe', ZA: 'South Africa', KE: 'Kenya', NG: 'Nigeria',
  GH: 'Ghana', ET: 'Ethiopia', EG: 'Egypt', MA: 'Morocco',
  TZ: 'Tanzania', UG: 'Uganda', SN: 'Senegal', CI: "Côte d'Ivoire",
  CM: 'Cameroon', MZ: 'Mozambique', ZM: 'Zambia', RW: 'Rwanda',
}

const REGIONS: Record<string, { codes: string[]; label: string }> = {
  'east africa':     { codes: ['KE', 'TZ', 'UG', 'ET', 'RW'], label: 'East Africa' },
  'east_africa':     { codes: ['KE', 'TZ', 'UG', 'ET', 'RW'], label: 'East Africa' },
  'west africa':     { codes: ['NG', 'GH', 'SN', 'CI', 'CM'], label: 'West Africa' },
  'west_africa':     { codes: ['NG', 'GH', 'SN', 'CI', 'CM'], label: 'West Africa' },
  'southern africa': { codes: ['ZW', 'ZA', 'MZ', 'ZM'],       label: 'Southern Africa' },
  'southern_africa': { codes: ['ZW', 'ZA', 'MZ', 'ZM'],       label: 'Southern Africa' },
  'north africa':    { codes: ['EG', 'MA'],                    label: 'North Africa' },
  'north_africa':    { codes: ['EG', 'MA'],                    label: 'North Africa' },
  'central africa':  { codes: ['CM'],                          label: 'Central Africa' },
  'central_africa':  { codes: ['CM'],                          label: 'Central Africa' },
  africa:            { codes: [...VALID_CODES], label: 'Africa' },
  'pan-african':     { codes: [...VALID_CODES], label: 'Africa' },
  'pan african':     { codes: [...VALID_CODES], label: 'Africa' },
}

const LOCATION_ALIASES: Record<string, string> = {
  zimbabwe: 'ZW', 'south africa': 'ZA', kenya: 'KE', nigeria: 'NG',
  ghana: 'GH', ethiopia: 'ET', egypt: 'EG', morocco: 'MA',
  tanzania: 'TZ', uganda: 'UG', senegal: 'SN', 'ivory coast': 'CI',
  "cote d'ivoire": 'CI', cameroon: 'CM', mozambique: 'MZ', zambia: 'ZM', rwanda: 'RW',
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
}

interface ResolvedLocation {
  type: 'country' | 'region' | 'unknown'
  codes: string[]
  label: string
}

function resolveLocation(input: string): ResolvedLocation {
  const cleaned = input.trim()
  const upper = cleaned.toUpperCase()
  const lower = cleaned.toLowerCase()
  if (VALID_CODES.has(upper)) return { type: 'country', codes: [upper], label: COUNTRY_LABELS[upper] ?? upper }
  const region = REGIONS[lower]
  if (region) return { type: 'region', codes: region.codes, label: region.label }
  const aliasCode = LOCATION_ALIASES[lower]
  if (aliasCode) return { type: 'country', codes: [aliasCode], label: COUNTRY_LABELS[aliasCode] ?? aliasCode }
  for (const [alias, code] of Object.entries(LOCATION_ALIASES)) {
    if (lower.includes(alias) || alias.includes(lower)) {
      return { type: 'country', codes: [code], label: COUNTRY_LABELS[code] ?? code }
    }
  }
  return { type: 'unknown', codes: [], label: cleaned }
}

function flagEmoji(code: string): string {
  return [...code.toUpperCase()].map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('')
}

function locationHeader(loc: ResolvedLocation): string {
  if (loc.type === 'country' && loc.codes.length === 1) return `${flagEmoji(loc.codes[0])} ${loc.label}`
  return `🌍 ${loc.label}`
}

// ── Tool registry ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'get_briefing',
    description:
      'Answer "What\'s happening in [place/topic]?" — top story, recent articles, and trending ' +
      'topics in one call. Accepts country codes (ZW, KE), region names (East Africa, Southern Africa), ' +
      'category topics (politics, business), or omit focus for a pan-African overview.',
    inputSchema: {
      type: 'object',
      properties: {
        focus: { type: 'string', description: 'Country code, region, category, or topic (optional)' },
        limit: { type: 'number', description: 'Max articles, 1–12 (default 8)' },
      },
    },
  },
  {
    name: 'track_story',
    description:
      'Follow the development of a news story over time. Returns articles in chronological order ' +
      'showing how a story evolved. Use since to control the lookback window.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Topic, keyword, event, or person name to track' },
        since: { type: 'string', enum: ['today', 'week', 'month'], description: 'Lookback window (default: week)' },
        country: { type: 'string', description: 'Limit to a country code (optional)' },
        limit: { type: 'number', description: 'Max articles, 1–20 (default 10)' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'get_location_news',
    description:
      'News from a specific place in Africa. Accepts country codes, country names, region names, or city names.',
    inputSchema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'Country code, country name, region, or city' },
        category: { type: 'string', description: 'Category to filter (optional)' },
        limit: { type: 'number', description: 'Max articles, 1–20 (default 10)' },
      },
      required: ['location'],
    },
  },
  {
    name: 'compare_locations',
    description: 'Compare news coverage between 2–4 African countries or regions side by side.',
    inputSchema: {
      type: 'object',
      properties: {
        locations: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 4,
          description: '2–4 country codes, country names, or region names',
        },
        topic: { type: 'string', description: 'Narrow comparison to a topic (optional)' },
        limit: { type: 'number', description: 'Max articles per location, 1–10 (default 5)' },
      },
      required: ['locations'],
    },
  },
  {
    name: 'get_source_view',
    description: 'See how a specific news source is covering a topic.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Publication name (partial match)' },
        topic: { type: 'string', description: 'Topic to filter by (optional)' },
        limit: { type: 'number', description: 'Max articles, 1–20 (default 8)' },
      },
      required: ['source'],
    },
  },
  {
    name: 'find_stories',
    description: 'Search articles by keyword, tag, category, or country.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Keyword or phrase (optional)' },
        tag: { type: 'string', description: 'Tag name (optional)' },
        category: { type: 'string', description: 'Category slug or name (optional)' },
        country: { type: 'string', description: 'Country code (optional)' },
        limit: { type: 'number', description: 'Max results, 1–20 (default 10)' },
      },
    },
  },
  {
    name: 'get_article',
    description: 'Fetch full details of a single article by ID or slug.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Article _id or slug' } },
      required: ['id'],
    },
  },
  {
    name: 'list_categories',
    description: 'List all news categories with article counts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_sources',
    description: 'List active news sources. Optionally filter by country code.',
    inputSchema: {
      type: 'object',
      properties: { country: { type: 'string', description: 'Filter by country code (optional)' } },
    },
  },
  {
    name: 'get_stats',
    description: 'Platform statistics: total articles, active sources, and today\'s output.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_my_feed',
    description:
      'Personalised news feed based on the authenticated user\'s article likes and saves. ' +
      'Requires Authorization: Bearer <WorkOS access token>.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max articles, 1–20 (default 12)' },
      },
    },
  },
  {
    name: 'get_trending_analytics',
    description:
      'Open analytics: trending topics, categories, keywords, and sources for any location or period. ' +
      'Part of Mukoko\'s open data policy.',
    inputSchema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'Country code, region, or city (optional)' },
        period: { type: 'string', enum: ['today', 'week', 'month'], description: 'Time window (default: today)' },
        limit: { type: 'number', description: 'Max results per section, 1–20 (default 10)' },
      },
    },
  },
  {
    name: 'detect_surge',
    description:
      'Detect sudden spikes in news coverage — compares last 24h against 7-day baseline. ' +
      'Surfaces unusual increases like crime up 5× in Bulawayo or a football surge in Ghana.',
    inputSchema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'Country, region, or city (optional — omit for continent-wide)' },
        limit: { type: 'number', description: 'Max surges to return, 1–20 (default 10)' },
      },
    },
  },
  {
    name: 'get_content_analytics',
    description:
      'Open data breakdown of news coverage by category, country, and keyword for a given period.',
    inputSchema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'Country, region, or city (optional)' },
        period: { type: 'string', enum: ['today', 'week', 'month'], description: 'Time window (default: week)' },
      },
    },
  },
] as const

type ToolName = typeof TOOLS[number]['name']

// ── Helpers ────────────────────────────────────────────────────────────────

function clamp(v: unknown, min: number, max: number, def: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(Math.max(min, n), max) : def
}

function sanitize(v: unknown, maxLen = 200): string {
  return String(v ?? '').slice(0, maxLen).trim()
}

const APPROVED = ['approved', 'published']
const SINCE_MS: Record<string, number> = {
  today: 1 * 24 * 60 * 60 * 1000,
  week:  7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
}

function sinceDate(period: string, fallback: 'today' | 'week' | 'month' = 'week'): Date {
  return new Date(Date.now() - (SINCE_MS[period] ?? SINCE_MS[fallback]))
}

/** Resolve country code list → feedSource _ids for location-scoped queries. */
async function feedSourceIds(db: Db, countryCodes: string[]): Promise<string[]> {
  if (!countryCodes.length) return []
  const docs = await db.collection('feedSources')
    .find({ countryCode: { $in: countryCodes } }, { projection: { _id: 1 } })
    .toArray()
  return docs.map(d => String(d._id))
}

// ── Shared aggregation pipeline pieces ────────────────────────────────────

const SRC_LOOKUP = {
  $lookup: {
    from: 'feedSources',
    localField: 'feedSourceId',
    foreignField: '_id',
    as: '_src',
    pipeline: [{ $project: { name: 1, countryCode: 1 } }],
  },
}

const TAG_LOOKUP = {
  $lookup: {
    from: 'tags',
    localField: 'tagIds',
    foreignField: '_id',
    as: '_tags',
    pipeline: [{ $project: { name: 1 } }],
  },
}

const PROJECT_ARTICLE = {
  $project: {
    _id: 0,
    id: '$_id',
    title: '$headline',
    description: 1,
    source: { $arrayElemAt: ['$_src.name', 0] },
    source_id: '$feedSourceId',
    category: '$articleSection',
    country_id: { $arrayElemAt: ['$_src.countryCode', 0] },
    published_at: '$datePublished',
    original_url: '$externalUrl',
    slug: 1,
    tags: { $map: { input: '$_tags', as: 't', in: '$$t.name' } },
    image_url: { $arrayElemAt: ['$image.url', 0] },
    trending_score: '$bundu.ubuntuScoreSnapshot',
  },
}

type ArticleRow = {
  id: string; title: string; description?: string; source?: string;
  source_id?: string; category?: string; country_id?: string;
  published_at?: Date; original_url: string; slug: string;
  tags?: string[]; image_url?: string; trending_score?: number;
}

async function queryArticles(db: Db, match: object, limit: number, sort: object = { datePublished: -1 }): Promise<ArticleRow[]> {
  return db.collection('articles').aggregate<ArticleRow>([
    { $match: { status: { $in: APPROVED }, ...match } },
    { $sort: sort },
    { $limit: limit },
    SRC_LOOKUP,
    TAG_LOOKUP,
    PROJECT_ARTICLE,
  ]).toArray()
}

// ── Plain-text formatters ──────────────────────────────────────────────────

function fmtDate(d: unknown): string {
  if (!d) return ''
  try { return new Date(String(d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }
  catch { return String(d).slice(0, 10) }
}

function articleToText(r: ArticleRow, idx?: number): string {
  const prefix = idx != null ? `[${idx + 1}] ` : ''
  const lines = [
    `${prefix}# ${r.title}`,
    `Source: ${r.source ?? r.source_id} | Category: ${r.category ?? 'general'} | Country: ${r.country_id ?? ''}`,
    `Published: ${fmtDate(r.published_at)}`,
  ]
  if (r.description) lines.push(`\n${r.description}`)
  lines.push(`\nURL: ${r.original_url}`)
  if (r.tags?.length) lines.push(`Tags: ${r.tags.join(', ')}`)
  return lines.join('\n')
}

// ── HTML rendering ─────────────────────────────────────────────────────────

const SITE = 'https://news.mukoko.com'

const CSS = `
:root{--tz:#4B0082;--co:#0047AB;--go:#5D4037;--ma:#2E8B57;--tc:#E07A4D;--cr:#FAF9F5;}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,'Segoe UI',BlinkMacSystemFont,sans-serif;background:var(--cr);padding:16px;font-size:14px;color:#1a1a2e;line-height:1.5;}
a{color:inherit;text-decoration:none;}
.card{background:#fff;border-radius:14px;padding:16px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,.06);border:1px solid rgba(0,0,0,.07);}
.card-top{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}
.bk{display:inline-block;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#fff;}
.bk-cat{background:var(--tz);}.bk-cc{background:var(--co);}.bk-src{background:rgba(0,0,0,.35);font-weight:600;}
.dt{color:#aaa;font-size:11px;}
.card-title{font-family:Georgia,'Times New Roman',serif;font-size:15px;font-weight:700;line-height:1.4;margin-bottom:8px;color:#0d0d1a;}
.card-title a:hover{text-decoration:underline;color:var(--co);}
.card-desc{font-size:13px;color:#555;line-height:1.5;margin-bottom:10px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
.card-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;}
.card-src{font-size:11px;color:#888;}
.read-link{color:var(--co);font-size:12px;font-weight:600;}
.tags{display:flex;flex-wrap:wrap;gap:3px;margin-top:8px;}
.tag{background:rgba(75,0,130,.07);color:var(--tz);padding:1px 6px;border-radius:3px;font-size:10px;}
.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;}
.stat-box{background:#fff;border-radius:12px;padding:16px;text-align:center;border:1px solid rgba(0,0,0,.07);}
.stat-n{font-size:28px;font-weight:800;color:var(--tz);letter-spacing:-.02em;}
.stat-l{font-size:11px;color:#888;margin-top:2px;text-transform:uppercase;letter-spacing:.04em;}
.cat-row,.src-row{display:flex;align-items:center;gap:10px;background:#fff;border-radius:10px;padding:12px 14px;margin-bottom:8px;border:1px solid rgba(0,0,0,.06);}
.cat-em{font-size:20px;width:28px;text-align:center;flex-shrink:0;}
.cat-name{font-weight:600;font-size:14px;}.cat-cnt{font-size:11px;color:#999;margin-top:1px;}
.src-cc{width:28px;height:28px;border-radius:50%;background:var(--co);color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;}
.src-name{font-weight:600;font-size:13px;}.src-meta{font-size:11px;color:#999;margin-top:1px;}
.hd{display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid var(--tz);}
.hd h1{font-family:Georgia,'Times New Roman',serif;font-size:18px;font-weight:700;color:var(--tz);flex:1;}
.hd .sub{color:#777;font-size:12px;white-space:nowrap;}
.no{text-align:center;padding:32px 16px;color:#888;font-size:14px;}
.ft{text-align:center;margin-top:14px;padding-top:12px;border-top:1px solid rgba(0,0,0,.06);}
.ft a{color:var(--tz);font-size:12px;font-weight:600;}
.loc-banner{background:linear-gradient(135deg,var(--tz),var(--co));border-radius:12px;padding:14px 16px;margin-bottom:14px;color:#fff;display:flex;align-items:center;gap:12px;}
.loc-flag{font-size:30px;line-height:1;}.loc-name{font-size:17px;font-weight:700;font-family:Georgia,serif;}.loc-sub{font-size:11px;opacity:.75;margin-top:2px;}
.sect{margin-top:14px;margin-bottom:6px;display:flex;align-items:center;gap:8px;}
.sect-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#aaa;}
.sect-rule{flex:1;height:1px;background:rgba(0,0,0,.07);}
.mini{background:#fff;border-radius:10px;padding:11px 13px;margin-bottom:6px;border:1px solid rgba(0,0,0,.06);display:flex;gap:10px;align-items:flex-start;}
.mini-idx{font-size:13px;font-weight:800;color:var(--tz);opacity:.3;min-width:18px;flex-shrink:0;padding-top:1px;}
.mini-body{flex:1;min-width:0;}.mini-title{font-weight:600;font-size:13px;line-height:1.35;color:#0d0d1a;}
.mini-title a:hover{color:var(--co);}.mini-meta{font-size:10px;color:#bbb;margin-top:3px;}
.pills{display:flex;flex-wrap:wrap;gap:5px;margin-top:4px;}
.pill{display:inline-block;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600;background:rgba(75,0,130,.08);color:var(--tz);cursor:default;}
.timeline{margin-top:6px;}
.tl-entry{display:flex;gap:12px;margin-bottom:12px;}
.tl-dot{display:flex;flex-direction:column;align-items:center;flex-shrink:0;}
.tl-circle{width:10px;height:10px;border-radius:50%;background:var(--co);margin-top:4px;flex-shrink:0;}
.tl-line{width:2px;background:rgba(0,71,171,.15);flex:1;margin-top:3px;}
.tl-entry:last-child .tl-line{display:none;}
.tl-card{flex:1;background:#fff;border-radius:10px;padding:12px 13px;border:1px solid rgba(0,0,0,.06);}
.tl-date{font-size:10px;color:#999;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:5px;}
.tl-title{font-weight:700;font-size:13px;line-height:1.4;color:#0d0d1a;margin-bottom:4px;}
.tl-title a:hover{color:var(--co);}.tl-src{font-size:10px;color:#bbb;}
.cmp-col{margin-bottom:18px;}
.cmp-hd{border-radius:10px 10px 0 0;padding:10px 14px;background:var(--tz);color:#fff;display:flex;align-items:center;gap:8px;}
.cmp-flag{font-size:20px;}.cmp-name{font-weight:700;font-size:13px;}
.cmp-body{border:1px solid rgba(0,0,0,.08);border-top:none;border-radius:0 0 10px 10px;overflow:hidden;}
.cmp-row{padding:10px 13px;border-bottom:1px solid rgba(0,0,0,.05);background:#fff;}
.cmp-row:last-child{border-bottom:none;}
.cmp-row-title{font-size:12px;font-weight:600;line-height:1.35;color:#0d0d1a;}
.cmp-row-title a:hover{color:var(--co);}.cmp-row-meta{font-size:10px;color:#bbb;margin-top:2px;}
.cmp-empty{padding:14px;text-align:center;color:#ccc;font-size:12px;background:#fff;}
.trend-list{margin-top:4px;}
.trend-row{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid rgba(0,0,0,.04);}
.trend-row:last-child{border-bottom:none;}
.trend-label{font-size:12px;font-weight:600;color:#1a1a2e;min-width:110px;max-width:150px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.trend-bar-wrap{flex:1;height:8px;background:rgba(0,0,0,.05);border-radius:4px;overflow:hidden;}
.trend-bar{height:100%;border-radius:4px;background:var(--tz);}
.trend-cnt{font-size:11px;font-weight:700;color:#555;min-width:48px;text-align:right;flex-shrink:0;}
.surge-list{margin-top:4px;}
.surge-row{background:#fff;border-radius:10px;padding:12px 13px;margin-bottom:8px;border:1px solid rgba(0,0,0,.06);}
.surge-head{display:flex;align-items:center;gap:6px;margin-bottom:6px;}
.surge-label{font-weight:700;font-size:13px;flex:1;color:#0d0d1a;}
.surge-x{font-size:14px;font-weight:800;color:#8b1a00;}
.surge-bar{background:linear-gradient(90deg,#8b1a00,#b5451b);}
.surge-meta{font-size:11px;color:#888;margin-top:5px;}
`

function he(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function safeHref(u: unknown): string {
  const s = String(u ?? '').trim()
  try {
    const p = new URL(s)
    if (p.protocol === 'http:' || p.protocol === 'https:') return he(p.toString())
  } catch { /* non-URL */ }
  return '#'
}

function page(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https:"><title>${he(title)} — Mukoko News</title><style>${CSS}</style></head><body>${body}</body></html>`
}

function articleCard(r: ArticleRow): string {
  const href = safeHref(r.original_url)
  const catBadge = r.category ? `<span class="bk bk-cat">${he(r.category)}</span>` : ''
  const ccBadge = r.country_id ? `<span class="bk bk-cc">${he(r.country_id)}</span>` : ''
  const srcBadge = r.source ? `<span class="bk bk-src">${he(r.source)}</span>` : ''
  const desc = r.description ? `<p class="card-desc">${he(r.description)}</p>` : ''
  const tagHtml = r.tags?.length ? `<div class="tags">${r.tags.slice(0, 4).map(t => `<span class="tag">${he(t)}</span>`).join('')}</div>` : ''
  return `<div class="card">
<div class="card-top">${catBadge}${ccBadge}${srcBadge}<span class="dt">${fmtDate(r.published_at)}</span></div>
<div class="card-title"><a href="${href}" target="_blank" rel="noopener">${he(r.title)}</a></div>
${desc}<div class="card-foot"><span class="card-src">${he(r.source ?? '')}</span><a class="read-link" href="${href}" target="_blank" rel="noopener">Read →</a></div>${tagHtml}
</div>`
}

function miniCard(r: ArticleRow, idx: number): string {
  const href = safeHref(r.original_url)
  return `<div class="mini">
<div class="mini-idx">${idx + 1}</div>
<div class="mini-body">
<div class="mini-title"><a href="${href}" target="_blank" rel="noopener">${he(r.title)}</a></div>
<div class="mini-meta">${r.source ? he(r.source) + ' · ' : ''}${fmtDate(r.published_at)}</div>
</div></div>`
}

function sect(label: string): string {
  return `<div class="sect"><span class="sect-label">${he(label)}</span><div class="sect-rule"></div></div>`
}

function ok(text: string, html?: string): McpToolResult {
  const content: McpContent[] = [{ type: 'text', text }]
  if (html) content.push({ type: 'resource', resource: { uri: 'ui://mukoko-news/result', mimeType: 'text/html', text: html } })
  return { content }
}

function err(message: string): McpToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
}

// ── Tool implementations ───────────────────────────────────────────────────

async function toolGetBriefing(db: Db, args: Record<string, unknown>): Promise<McpToolResult> {
  const focus = sanitize(args.focus, 100)
  const limit = clamp(args.limit, 1, 12, 8)

  const match: Record<string, unknown> = {}
  let heading = 'Africa Today'

  if (focus) {
    const loc = resolveLocation(focus)
    if (loc.codes.length) {
      const ids = await feedSourceIds(db, loc.codes)
      if (ids.length) match.feedSourceId = { $in: ids }
      heading = `${locationHeader(loc)} Briefing`
    } else {
      match.articleSection = new RegExp(focus.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      heading = `${focus.charAt(0).toUpperCase() + focus.slice(1)} Briefing`
    }
  }

  const results = await queryArticles(db, match, limit)
  if (!results.length) return ok(`No recent articles found for: "${focus || 'Africa'}"`)

  const tagFreq = new Map<string, number>()
  for (const r of results) {
    for (const t of (r.tags ?? [])) tagFreq.set(t, (tagFreq.get(t) ?? 0) + 1)
  }
  const topTags = [...tagFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t)

  const textParts = [`## ${heading}\n`, `**Top Story:**\n${articleToText(results[0])}`]
  if (results.length > 1) {
    textParts.push('\n**Latest:**')
    results.slice(1).forEach((r, i) => textParts.push(`[${i + 2}] ${r.title}\n   ${r.source} · ${fmtDate(r.published_at)}`))
  }
  if (topTags.length) textParts.push(`\n**Trending:** ${topTags.join(', ')}`)

  const locBanner = focus ? (() => {
    const loc = resolveLocation(focus)
    const flag = loc.codes.length === 1 ? flagEmoji(loc.codes[0]) : '🌍'
    return `<div class="loc-banner"><div class="loc-flag">${flag}</div><div><div class="loc-name">${he(heading)}</div><div class="loc-sub">${results.length} articles${topTags.length ? ` · Trending: ${topTags.slice(0, 3).join(', ')}` : ''}</div></div></div>`
  })() : ''

  const pillsHtml = topTags.length
    ? `${sect('Trending Topics')}<div class="pills">${topTags.map(t => `<span class="pill">${he(t)}</span>`).join('')}</div>`
    : ''

  const html = page(heading,
    (locBanner || `<div class="hd"><h1>🐝 ${he(heading)}</h1></div>`) +
    sect('Top Story') + articleCard(results[0]) +
    (results.length > 1 ? sect('Latest') + results.slice(1).map((r, i) => miniCard(r, i + 1)).join('') : '') +
    pillsHtml +
    `<div class="ft"><a href="${SITE}">Mukoko News — Pan-African Coverage</a></div>`
  )
  return ok(textParts.join('\n'), html)
}

async function toolTrackStory(db: Db, args: Record<string, unknown>): Promise<McpToolResult> {
  const topic = sanitize(args.topic, 200)
  if (!topic) return err('"topic" is required')
  const since = sanitize(args.since, 20)
  const country = sanitize(args.country, 5).toUpperCase()
  const limit = clamp(args.limit, 1, 20, 10)
  const re = new RegExp(topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')

  const match: Record<string, unknown> = {
    datePublished: { $gte: sinceDate(since) },
    $or: [{ headline: re }, { description: re }],
  }
  if (country && VALID_CODES.has(country)) {
    const ids = await feedSourceIds(db, [country])
    if (ids.length) match.feedSourceId = { $in: ids }
  }

  const results = await queryArticles(db, match, limit, { datePublished: 1 })
  if (!results.length) return ok(`No articles found for "${topic}" in the last ${since || 'week'}.`)

  const sinceLabel = since === 'today' ? 'today' : since === 'month' ? 'this month' : 'this week'
  const heading = `Story: ${topic}`
  const textLines = [`## ${heading} — ${sinceLabel}\n${results.length} article(s)\n`]
  results.forEach(r => textLines.push(`${fmtDate(r.published_at)} — ${r.source}\n  ${r.title}\n  ${r.original_url}\n`))

  const timelineItems = results.map((r, i) => {
    const href = safeHref(r.original_url)
    const isLast = i === results.length - 1
    return `<div class="tl-entry">
<div class="tl-dot"><div class="tl-circle"></div>${isLast ? '' : '<div class="tl-line"></div>'}</div>
<div class="tl-card">
<div class="tl-date">${fmtDate(r.published_at)}</div>
<div class="tl-title"><a href="${href}" target="_blank" rel="noopener">${he(r.title)}</a></div>
<div class="tl-src">${he(r.source ?? '')}${r.country_id ? ` · ${r.country_id}` : ''}</div>
${r.description ? `<p style="font-size:12px;color:#666;margin-top:6px;line-height:1.4;">${he(r.description.slice(0, 180))}</p>` : ''}
</div></div>`
  }).join('')

  const html = page(heading,
    `<div class="loc-banner" style="background:linear-gradient(135deg,var(--go),var(--tc))">` +
    `<div class="loc-flag">📰</div><div><div class="loc-name">${he(heading)}</div>` +
    `<div class="loc-sub">${results.length} article${results.length !== 1 ? 's' : ''} · ${sinceLabel}</div></div></div>` +
    sect('Timeline') + `<div class="timeline">${timelineItems}</div>` +
    `<div class="ft"><a href="${SITE}">Mukoko News</a></div>`
  )
  return ok(textLines.join('\n'), html)
}

async function toolGetLocationNews(db: Db, args: Record<string, unknown>): Promise<McpToolResult> {
  const locationInput = sanitize(args.location, 100)
  if (!locationInput) return err('"location" is required')
  const loc = resolveLocation(locationInput)
  if (!loc.codes.length) return err(`Could not resolve location: "${locationInput}". Try a country code (ZW, KE), country name, region name, or city name.`)

  const category = sanitize(args.category, 50)
  const limit = clamp(args.limit, 1, 20, 10)

  const srcIds = await feedSourceIds(db, loc.codes)
  const match: Record<string, unknown> = {}
  if (srcIds.length) match.feedSourceId = { $in: srcIds }
  if (category) match.articleSection = new RegExp(category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')

  const [results, sources] = await Promise.all([
    queryArticles(db, match, limit),
    db.collection('feedSources').find(
      { countryCode: { $in: loc.codes }, isActive: true },
      { projection: { name: 1, countryCode: 1, trustScore: 1 } }
    ).limit(8).toArray(),
  ])

  if (!results.length) return ok(`No articles found for location: "${locationInput}"`)

  const heading = locationHeader(loc)
  const sub = category ? ` · ${category}` : ''
  const textLines = [`## ${heading}${sub}\n${results.length} article(s)\n`]
  results.forEach((r, i) => textLines.push(`${articleToText(r, i)}\n`))
  if (sources.length) {
    textLines.push('\nActive sources:')
    sources.forEach(s => textLines.push(`• ${s.name} (${s.countryCode})`))
  }

  const flag = loc.codes.length === 1 ? flagEmoji(loc.codes[0]) : '🌍'
  const banner = `<div class="loc-banner"><div class="loc-flag">${flag}</div>` +
    `<div><div class="loc-name">${he(heading)}${sub ? he(sub) : ''}</div>` +
    `<div class="loc-sub">${results.length} articles${sources.length ? ` · ${sources.length} sources` : ''}</div></div></div>`
  const srcRows = sources.map(s => `<div class="src-row">
<div class="src-cc">${he(String(s.countryCode ?? '??'))}</div>
<div><div class="src-name">${he(s.name)}</div><div class="src-meta">${he(s.countryCode)}</div></div>
</div>`).join('')

  const html = page(heading,
    banner +
    sect('Latest Articles') + results.map((r, i) => miniCard(r, i)).join('') +
    (srcRows ? sect('News Sources') + srcRows : '') +
    `<div class="ft"><a href="${SITE}">Mukoko News</a></div>`
  )
  return ok(textLines.join('\n'), html)
}

async function toolCompareLocations(db: Db, args: Record<string, unknown>): Promise<McpToolResult> {
  const rawLocs = Array.isArray(args.locations) ? (args.locations as unknown[]) : []
  if (rawLocs.length < 2) return err('"locations" must be an array of 2–4 items')
  const locations = rawLocs.slice(0, 4).map(l => resolveLocation(String(l)))
  const invalid = locations.filter(l => !l.codes.length)
  if (invalid.length) return err(`Could not resolve: ${invalid.map(l => `"${l.label}"`).join(', ')}`)

  const topic = sanitize(args.topic, 200)
  const limit = clamp(args.limit, 1, 10, 5)

  const sections = await Promise.all(locations.map(async loc => {
    const srcIds = await feedSourceIds(db, loc.codes)
    const match: Record<string, unknown> = {}
    if (srcIds.length) match.feedSourceId = { $in: srcIds }
    if (topic) {
      const re = new RegExp(topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      match.$or = [{ headline: re }, { description: re }]
    }
    return { loc, articles: await queryArticles(db, match, limit) }
  }))

  const heading = `Compare: ${locations.map(l => l.label).join(' vs ')}`
  const sub = topic ? ` on "${topic}"` : ''
  const textLines = [`## ${heading}${sub}\n`]
  for (const { loc, articles } of sections) {
    textLines.push(`### ${locationHeader(loc)}`)
    articles.length ? articles.forEach((r, i) => textLines.push(`  [${i + 1}] ${r.title} (${r.source})`)) : textLines.push('  No articles found')
    textLines.push('')
  }

  const compareCols = sections.map(({ loc, articles }) => {
    const header = loc.codes.length === 1
      ? `<div class="cmp-flag">${flagEmoji(loc.codes[0])}</div><div class="cmp-name">${he(loc.label)}</div>`
      : `<div class="cmp-flag">🌍</div><div class="cmp-name">${he(loc.label)}</div>`
    const rows = articles.length
      ? articles.map(r => `<div class="cmp-row"><div class="cmp-row-title"><a href="${safeHref(r.original_url)}" target="_blank" rel="noopener">${he(r.title)}</a></div><div class="cmp-row-meta">${he(r.source ?? '')} · ${fmtDate(r.published_at)}</div></div>`).join('')
      : '<div class="cmp-empty">No articles found</div>'
    return `<div class="cmp-col"><div class="cmp-hd">${header}</div><div class="cmp-body">${rows}</div></div>`
  }).join('')

  const html = page(heading,
    `<div class="hd"><h1>🌍 ${he(heading)}</h1>${sub ? `<span class="sub">${he(sub)}</span>` : ''}</div>` +
    compareCols + `<div class="ft"><a href="${SITE}">Mukoko News</a></div>`
  )
  return ok(textLines.join('\n'), html)
}

async function toolGetSourceView(db: Db, args: Record<string, unknown>): Promise<McpToolResult> {
  const source = sanitize(args.source, 100)
  if (!source) return err('"source" is required')
  const topic = sanitize(args.topic, 200)
  const limit = clamp(args.limit, 1, 20, 8)

  const srcDoc = await db.collection('feedSources').findOne(
    { name: new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
    { projection: { _id: 1, name: 1, countryCode: 1 } }
  )

  const match: Record<string, unknown> = {}
  if (srcDoc) {
    match.feedSourceId = String(srcDoc._id)
  } else {
    return ok(`No source found matching: "${source}"`)
  }
  if (topic) {
    const re = new RegExp(topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    match.$or = [{ headline: re }, { description: re }]
  }

  const results = await queryArticles(db, match, limit)
  if (!results.length) return ok(`No articles found from "${srcDoc.name}"${topic ? ` on "${topic}"` : ''}`)

  const heading = String(srcDoc.name)
  const sub = topic ? `on "${topic}"` : `${results.length} recent articles`
  const textLines = [`## ${heading}${topic ? ` on "${topic}"` : ''}\n`]
  results.forEach((r, i) => textLines.push(`${articleToText(r, i)}\n`))

  const ccFlag = srcDoc.countryCode ? `${flagEmoji(String(srcDoc.countryCode))} ` : ''
  const banner = `<div class="loc-banner"><div class="loc-flag">📰</div>` +
    `<div><div class="loc-name">${ccFlag}${he(heading)}</div><div class="loc-sub">${he(sub)}</div></div></div>`

  const html = page(heading,
    banner + sect('Articles') + results.map((r, i) => miniCard(r, i)).join('') +
    `<div class="ft"><a href="${SITE}">Mukoko News</a></div>`
  )
  return ok(textLines.join('\n'), html)
}

async function toolFindStories(db: Db, args: Record<string, unknown>): Promise<McpToolResult> {
  const q = sanitize(args.q, 200)
  const tag = sanitize(args.tag, 100)
  const category = sanitize(args.category, 50)
  const country = sanitize(args.country, 5).toUpperCase()
  const limit = clamp(args.limit, 1, 20, 10)

  if (!q && !tag && !category && !country) return err('Provide at least one of: q, tag, category, or country')

  const match: Record<string, unknown> = {}
  if (q) {
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    match.$or = [{ headline: re }, { description: re }]
  }
  if (category) match.articleSection = new RegExp(category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  if (country && VALID_CODES.has(country)) {
    const ids = await feedSourceIds(db, [country])
    if (ids.length) match.feedSourceId = { $in: ids }
  }
  if (tag) {
    const tagDoc = await db.collection('tags').findOne(
      { name: new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { projection: { _id: 1 } }
    )
    if (tagDoc) match.tagIds = String(tagDoc._id)
  }

  const results = await queryArticles(db, match, limit)
  const filterParts = [q && `"${q}"`, tag && `#${tag}`, category, country].filter(Boolean).join(' · ')
  if (!results.length) return ok(`No articles found for: ${filterParts}`)

  const text = results.map((r, i) => articleToText(r, i)).join('\n\n---\n\n')
  const html = page(`Search: ${filterParts}`,
    `<div class="hd"><h1>🔍 ${he(filterParts)}</h1><span class="sub">${results.length} result${results.length !== 1 ? 's' : ''}</span></div>` +
    results.map((r, i) => miniCard(r, i)).join('') +
    `<div class="ft"><a href="${SITE}">Mukoko News</a></div>`
  )
  return ok(`Found ${results.length} article(s) for ${filterParts}:\n\n${text}`, html)
}

async function toolGetArticle(db: Db, args: Record<string, unknown>): Promise<McpToolResult> {
  const id = sanitize(args.id, 100)
  if (!id) return err('"id" is required')

  const results = await queryArticles(db, { $or: [{ _id: id }, { slug: id }] }, 1)
  if (!results.length) return err(`Article not found: ${id}`)
  const r = results[0]
  const html = page(r.title,
    `<div class="hd"><h1>📄 ${he(r.title)}</h1></div>` + articleCard(r) +
    `<div class="ft"><a href="${SITE}">Mukoko News</a></div>`
  )
  return ok(articleToText(r), html)
}

async function toolListCategories(db: Db): Promise<McpToolResult> {
  const docs = await db.collection('categories')
    .find({}, { projection: { _id: 1, name: 1, description: 1, categorySlug: 1 } })
    .sort({ sortOrder: 1 })
    .limit(50).toArray()

  if (!docs.length) return ok('No categories found.')
  const text = docs.map(d => `📰 ${d.name} (${d.categorySlug}) ${d.description ? `— ${d.description}` : ''}`).join('\n')
  const rows = docs.map(d => `<div class="cat-row">
<div class="cat-em">📰</div>
<div style="flex:1"><div class="cat-name">${he(d.name)}</div>${d.description ? `<div class="cat-cnt">${he(d.description)}</div>` : ''}</div>
<a href="${SITE}/category/${he(d.categorySlug)}" target="_blank" rel="noopener" style="color:var(--co);font-size:12px;font-weight:600">Browse →</a>
</div>`).join('')

  const html = page('Categories',
    `<div class="hd"><h1>🐝 Categories</h1><span class="sub">${docs.length} topics</span></div>` +
    rows + `<div class="ft"><a href="${SITE}">Mukoko News</a></div>`
  )
  return ok(`Categories on Mukoko News:\n\n${text}`, html)
}

async function toolListSources(db: Db, args: Record<string, unknown>): Promise<McpToolResult> {
  const country = sanitize(args.country, 5).toUpperCase()
  const filter: Record<string, unknown> = { isActive: true }
  if (country && VALID_CODES.has(country)) filter.countryCode = country

  const docs = await db.collection('feedSources')
    .find(filter, { projection: { name: 1, countryCode: 1, feedUrl: 1, trustScore: 1 } })
    .sort({ trustScore: -1 })
    .limit(50).toArray()

  if (!docs.length) return ok('No active sources found.')
  const text = docs.map(d => `• ${d.name} (${d.countryCode})`).join('\n')
  const rows = docs.map(d => `<div class="src-row">
<div class="src-cc">${he(String(d.countryCode ?? '??'))}</div>
<div style="flex:1"><div class="src-name">${he(d.name)}</div><div class="src-meta">${he(d.countryCode)}</div></div>
</div>`).join('')

  const html = page('News Sources',
    `<div class="hd"><h1>🐝 News Sources</h1><span class="sub">${docs.length} publications</span></div>` +
    rows + `<div class="ft"><a href="${SITE}">Mukoko News</a></div>`
  )
  return ok(`Active news sources:\n\n${text}`, html)
}

async function toolGetStats(db: Db): Promise<McpToolResult> {
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0)

  const [totalArticles, todayArticles, totalSources] = await Promise.all([
    db.collection('articles').countDocuments({ status: { $in: APPROVED } }),
    db.collection('articles').countDocuments({ status: { $in: APPROVED }, datePublished: { $gte: todayStart } }),
    db.collection('feedSources').countDocuments({ isActive: true }),
  ])

  const text = `Mukoko News — Platform Statistics\n\nTotal articles: ${totalArticles}\nActive sources: ${totalSources}\nPublished today: ${todayArticles}\n\nCoverage: Zimbabwe and 15 other African countries.`
  const html = page('Platform Stats',
    `<div class="hd"><h1>🐝 Mukoko News</h1><span class="sub">Platform Statistics</span></div>
<div class="stat-grid">
  <div class="stat-box"><div class="stat-n">${totalArticles.toLocaleString()}</div><div class="stat-l">Total Articles</div></div>
  <div class="stat-box"><div class="stat-n">${todayArticles.toLocaleString()}</div><div class="stat-l">Published Today</div></div>
  <div class="stat-box"><div class="stat-n">${totalSources}</div><div class="stat-l">Active Sources</div></div>
  <div class="stat-box"><div class="stat-n">16</div><div class="stat-l">Countries</div></div>
</div>
<div class="ft"><a href="${SITE}">Visit Mukoko News</a></div>`
  )
  return ok(text, html)
}

async function toolGetMyFeed(db: Db, args: Record<string, unknown>, req: Request): Promise<McpToolResult> {
  // Requires WorkOS authentication — extract user from verified JWT
  const token = getBearerToken(req)
  if (!token) {
    return { content: [{ type: 'text', text: 'Error: get_my_feed requires authentication. Include Authorization: Bearer <WorkOS access token>.' }], isError: true }
  }
  const identity = await verifyWorkOSToken(token)
  if (!identity) {
    return { content: [{ type: 'text', text: 'Error: Invalid or expired token. Please re-authenticate with WorkOS.' }], isError: true }
  }

  const limit = clamp(args.limit, 1, 20, 12)
  const userId = identity.userId

  // Look up user activity in MongoDB engagement collections
  const [likes, saves] = await Promise.all([
    db.collection('articleLikes').find({ personId: userId }, { projection: { articleId: 1 } }).limit(50).toArray(),
    db.collection('articleSaves').find({ personId: userId }, { projection: { articleId: 1 } }).limit(20).toArray(),
  ])

  const likedIds = likes.map(l => String(l.articleId)).filter(Boolean)
  const savedIds = saves.map(s => String(s.articleId)).filter(Boolean)

  if (!likedIds.length && !savedIds.length) {
    return ok('No activity found for your account yet. Like or save some articles to get a personalised feed.')
  }

  // Infer interests from liked/saved articles
  const sampleIds = [...likedIds, ...savedIds].slice(0, 30)
  const sampleArticles = await db.collection('articles')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .find({ _id: { $in: sampleIds } } as any,
          { projection: { articleSection: 1, feedSourceId: 1, tagIds: 1 } })
    .toArray()

  const sectionFreq = new Map<string, number>()
  const sourceFreq = new Map<string, number>()
  for (const a of sampleArticles) {
    if (a.articleSection) sectionFreq.set(a.articleSection, (sectionFreq.get(a.articleSection) ?? 0) + 1)
    if (a.feedSourceId) sourceFreq.set(a.feedSourceId, (sourceFreq.get(a.feedSourceId) ?? 0) + 1)
  }

  const topSections = [...sectionFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => s)
  const topSources = [...sourceFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s]) => s)

  const match: Record<string, unknown> = {
    _id: { $nin: likedIds },
    $or: [] as object[],
  }
  if (topSections.length) (match.$or as object[]).push({ articleSection: { $in: topSections } })
  if (topSources.length) (match.$or as object[]).push({ feedSourceId: { $in: topSources } })
  if (!(match.$or as object[]).length) delete match.$or

  const results = await queryArticles(db, match, limit)
  if (!results.length) return ok('No new articles found matching your interests. Check back later.')

  const contextLabel = [
    topSections.length ? `${topSections.slice(0, 2).join(', ')}` : null,
    topSources.length ? `${topSources.length} followed sources` : null,
  ].filter(Boolean).join(' · ')

  const textLines = [`## My Feed\n${contextLabel} · ${results.length} article(s)\n`]
  results.forEach((r, i) => textLines.push(`${articleToText(r, i)}\n`))

  const banner = `<div class="loc-banner" style="background:linear-gradient(135deg,#1a1a2e,var(--tz))">` +
    `<div class="loc-flag">🐝</div><div><div class="loc-name">My Feed</div>` +
    `<div class="loc-sub">${he(contextLabel)} · ${results.length} articles</div></div></div>`

  const html = page('My Feed',
    banner + sect('Your Personalised Feed') + results.map((r, i) => miniCard(r, i)).join('') +
    `<div class="ft"><a href="${SITE}">Mukoko News — Pan-African Coverage</a></div>`
  )
  return ok(textLines.join('\n'), html)
}

async function toolGetTrendingAnalytics(db: Db, args: Record<string, unknown>): Promise<McpToolResult> {
  const locationInput = sanitize(args.location, 100)
  const period = sanitize(args.period, 20)
  const since = sinceDate(period, 'today')
  const limit = clamp(args.limit, 1, 20, 10)

  const loc = locationInput ? resolveLocation(locationInput) : null
  if (locationInput && !loc?.codes.length) return err(`Could not resolve location: "${locationInput}"`)

  const srcIds = loc?.codes.length ? await feedSourceIds(db, loc.codes) : []
  const baseMatch: Record<string, unknown> = { status: { $in: APPROVED }, datePublished: { $gte: since } }
  if (srcIds.length) baseMatch.feedSourceId = { $in: srcIds }

  const [tagResults, catResults, srcResults, totalResult, countryResults] = await Promise.all([
    // Top tags (unwind tagIds → group → lookup name)
    db.collection('articles').aggregate([
      { $match: baseMatch },
      { $unwind: '$tagIds' },
      { $group: { _id: '$tagIds', cnt: { $sum: 1 } } },
      { $sort: { cnt: -1 } },
      { $limit: limit },
      { $lookup: { from: 'tags', localField: '_id', foreignField: '_id', as: '_tag', pipeline: [{ $project: { name: 1 } }] } },
      { $unwind: { path: '$_tag', preserveNullAndEmpty: true } },
      { $project: { _id: 0, keyword: { $ifNull: ['$_tag.name', '$_id'] }, cnt: 1 } },
    ]).toArray() as Promise<Array<{ keyword: string; cnt: number }>>,
    // By category
    db.collection('articles').aggregate([
      { $match: { ...baseMatch, articleSection: { $ne: null } } },
      { $group: { _id: '$articleSection', cnt: { $sum: 1 } } },
      { $sort: { cnt: -1 } },
      { $limit: 8 },
    ]).toArray() as Promise<Array<{ _id: string; cnt: number }>>,
    // By source name
    db.collection('articles').aggregate([
      { $match: baseMatch },
      { $group: { _id: '$feedSourceId', cnt: { $sum: 1 } } },
      { $sort: { cnt: -1 } },
      { $limit: 8 },
      { $lookup: { from: 'feedSources', localField: '_id', foreignField: '_id', as: '_src', pipeline: [{ $project: { name: 1 } }] } },
      { $unwind: { path: '$_src', preserveNullAndEmpty: true } },
      { $project: { _id: 0, source: { $ifNull: ['$_src.name', '$_id'] }, cnt: 1 } },
    ]).toArray() as Promise<Array<{ source: string; cnt: number }>>,
    // Total count
    db.collection('articles').countDocuments(baseMatch),
    // By country (only if no location filter)
    srcIds.length ? Promise.resolve([] as Array<{ _id: string; cnt: number }>) :
    db.collection('articles').aggregate([
      { $match: baseMatch },
      { $lookup: { from: 'feedSources', localField: 'feedSourceId', foreignField: '_id', as: '_src', pipeline: [{ $project: { countryCode: 1 } }] } },
      { $unwind: { path: '$_src', preserveNullAndEmpty: true } },
      { $group: { _id: '$_src.countryCode', cnt: { $sum: 1 } } },
      { $sort: { cnt: -1 } },
      { $limit: 16 },
    ]).toArray() as Promise<Array<{ _id: string; cnt: number }>>,
  ])

  const total = totalResult
  const periodLabel = period === 'today' ? 'today' : period === 'month' ? 'this month' : 'this week'
  const heading = loc ? `${locationHeader(loc)} Trends` : 'Africa Trends'

  if (!total) return ok(`No articles found for ${loc?.label ?? 'Africa'} ${periodLabel}.`)

  const textLines = [`## ${heading} — ${periodLabel} (${total.toLocaleString()} articles)\n`]
  if (tagResults.length) {
    textLines.push('**Top Keywords:**')
    tagResults.forEach((k, i) => textLines.push(`  ${i + 1}. ${k.keyword} (${k.cnt})`))
    textLines.push('')
  }
  if (catResults.length) {
    textLines.push('**By Category:**')
    catResults.forEach(c => textLines.push(`  • ${c._id}: ${c.cnt} (${Math.round(c.cnt / total * 100)}%)`))
    textLines.push('')
  }
  if (countryResults.length) {
    textLines.push('**By Country:**')
    countryResults.forEach(c => textLines.push(`  ${flagEmoji(c._id ?? '')} ${COUNTRY_LABELS[c._id] ?? c._id}: ${c.cnt}`))
  }

  const flag = loc?.codes.length === 1 ? flagEmoji(loc.codes[0]) : '📊'
  const banner = `<div class="loc-banner"><div class="loc-flag">${flag}</div>` +
    `<div><div class="loc-name">${he(heading)}</div><div class="loc-sub">${he(periodLabel)} · ${total.toLocaleString()} articles</div></div></div>`

  const maxKw = tagResults[0]?.cnt ?? 1
  const kwHtml = tagResults.map(k =>
    `<div class="trend-row"><div class="trend-label">${he(k.keyword)}</div>` +
    `<div class="trend-bar-wrap"><div class="trend-bar" style="width:${Math.round(k.cnt / maxKw * 100)}%"></div></div>` +
    `<div class="trend-cnt">${k.cnt}</div></div>`
  ).join('')

  const maxCat = catResults[0]?.cnt ?? 1
  const catHtml = catResults.map(c => {
    const pct = Math.round(c.cnt / total * 100)
    return `<div class="trend-row"><div class="trend-label">${he(c._id)}</div>` +
      `<div class="trend-bar-wrap"><div class="trend-bar" style="width:${Math.round(c.cnt / maxCat * 100)}%;background:var(--co)"></div></div>` +
      `<div class="trend-cnt">${c.cnt} <span style="color:#bbb;font-size:9px">${pct}%</span></div></div>`
  }).join('')

  const srcHtml = srcResults.map(s =>
    `<div class="mini"><div class="mini-idx">📰</div><div class="mini-body">` +
    `<div class="mini-title">${he(s.source)}</div><div class="mini-meta">${s.cnt} article${s.cnt !== 1 ? 's' : ''} ${periodLabel}</div></div></div>`
  ).join('')

  const maxCountry = countryResults[0]?.cnt ?? 1
  const countryHtml = countryResults.map(c =>
    `<div class="trend-row"><div class="trend-label">${flagEmoji(c._id ?? '')} ${he(COUNTRY_LABELS[c._id] ?? c._id)}</div>` +
    `<div class="trend-bar-wrap"><div class="trend-bar" style="width:${Math.round(c.cnt / maxCountry * 100)}%;background:var(--ma)"></div></div>` +
    `<div class="trend-cnt">${c.cnt}</div></div>`
  ).join('')

  const html = page(heading,
    banner +
    (kwHtml ? sect('Trending Keywords') + `<div class="trend-list">${kwHtml}</div>` : '') +
    (catHtml ? sect('By Category') + `<div class="trend-list">${catHtml}</div>` : '') +
    (srcHtml ? sect('Most Active Sources') + srcHtml : '') +
    (countryHtml ? sect('By Country') + `<div class="trend-list">${countryHtml}</div>` : '') +
    `<div class="ft"><a href="${SITE}">Mukoko News — Open Data Analytics</a></div>`
  )
  return ok(textLines.join('\n'), html)
}

async function toolDetectSurge(db: Db, args: Record<string, unknown>): Promise<McpToolResult> {
  const locationInput = sanitize(args.location, 100)
  const limit = clamp(args.limit, 1, 20, 10)

  const loc = locationInput ? resolveLocation(locationInput) : null
  if (locationInput && !loc?.codes.length) return err(`Could not resolve location: "${locationInput}"`)

  const srcIds = loc?.codes.length ? await feedSourceIds(db, loc.codes) : []
  const recent24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const baseline8d = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)

  const baseFilter: Record<string, unknown> = { status: { $in: APPROVED } }
  if (srcIds.length) baseFilter.feedSourceId = { $in: srcIds }

  const tagPipeline = (dateMatch: object) => [
    { $match: { ...baseFilter, datePublished: dateMatch } },
    { $unwind: '$tagIds' },
    { $group: { _id: '$tagIds', cnt: { $sum: 1 } } },
  ]

  const [recentTagsRaw, baselineTagsRaw, recentCats, baselineCats] = await Promise.all([
    db.collection('articles').aggregate([...tagPipeline({ $gte: recent24h }), { $match: { cnt: { $gte: 2 } } }]).toArray() as Promise<Array<{ _id: string; cnt: number }>>,
    db.collection('articles').aggregate(tagPipeline({ $gte: baseline8d, $lt: recent24h })).toArray() as Promise<Array<{ _id: string; cnt: number }>>,
    db.collection('articles').aggregate([
      { $match: { ...baseFilter, datePublished: { $gte: recent24h }, articleSection: { $ne: null } } },
      { $group: { _id: '$articleSection', cnt: { $sum: 1 } } },
      { $match: { cnt: { $gte: 2 } } },
    ]).toArray() as Promise<Array<{ _id: string; cnt: number }>>,
    db.collection('articles').aggregate([
      { $match: { ...baseFilter, datePublished: { $gte: baseline8d, $lt: recent24h }, articleSection: { $ne: null } } },
      { $group: { _id: '$articleSection', dailyAvg: { $avg: { $const: 1 } }, cnt: { $sum: 1 } } },
    ]).toArray() as Promise<Array<{ _id: string; cnt: number }>>,
  ])

  // Resolve tag names for the recent tags
  const tagIds = recentTagsRaw.map(r => r._id)
  const tagDocs = tagIds.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await db.collection('tags').find({ _id: { $in: tagIds } } as any, { projection: { _id: 1, name: 1 } }).toArray()
    : []
  const tagNameMap = new Map(tagDocs.map(d => [String(d._id), String(d.name)]))

  const kwBase = new Map(baselineTagsRaw.map(r => [r._id, r.cnt / 7]))
  const catBase = new Map(baselineCats.map(r => [r._id, r.cnt / 7]))

  type SurgeItem = { label: string; type: 'keyword' | 'category'; recent: number; avg: number; ratio: number }
  const surges: SurgeItem[] = []

  for (const r of recentTagsRaw) {
    const avg = kwBase.get(r._id) ?? 0
    const ratio = avg > 0 ? r.cnt / avg : Math.min(r.cnt * 2, 20)
    if (ratio >= 2) surges.push({ label: tagNameMap.get(r._id) ?? r._id, type: 'keyword', recent: r.cnt, avg: Math.round(avg * 10) / 10, ratio: Math.round(ratio * 10) / 10 })
  }
  for (const r of recentCats) {
    const avg = catBase.get(r._id) ?? 0
    const ratio = avg > 0 ? r.cnt / avg : Math.min(r.cnt * 2, 20)
    if (ratio >= 2) surges.push({ label: r._id, type: 'category', recent: r.cnt, avg: Math.round(avg * 10) / 10, ratio: Math.round(ratio * 10) / 10 })
  }

  surges.sort((a, b) => b.ratio - a.ratio)
  const top = surges.slice(0, limit)
  const locationLabel = loc?.label ?? 'Africa'
  const heading = `Surge Detection — ${locationLabel}`

  if (!top.length) return ok(`No significant coverage surges detected in ${locationLabel} in the last 24 hours.`)

  const textLines = [`## ${heading}\n${top.length} surge${top.length !== 1 ? 's' : ''} detected in the last 24 hours:\n`]
  for (const s of top) {
    const detail = s.avg > 0
      ? `${s.ratio}× above baseline (${s.recent} today vs ${s.avg}/day avg)`
      : `${s.recent} articles today (new topic)`
    textLines.push(`🔺 ${s.label} [${s.type}] — ${detail}`)
  }

  const maxRatio = top[0]?.ratio ?? 1
  const surgeRows = top.map(s => {
    const badge = s.type === 'keyword'
      ? `<span class="bk bk-cat" style="font-size:9px">keyword</span>`
      : `<span class="bk bk-cc" style="font-size:9px">category</span>`
    const detail = s.avg > 0
      ? `${s.ratio}× above baseline · ${s.recent} today vs ${s.avg}/day`
      : `${s.recent} articles today · new topic`
    return `<div class="surge-row">
<div class="surge-head">${badge}<span class="surge-label">${he(s.label)}</span><span class="surge-x">${he(String(s.ratio))}×</span></div>
<div class="trend-bar-wrap"><div class="trend-bar surge-bar" style="width:${Math.round(Math.min(s.ratio / maxRatio, 1) * 100)}%"></div></div>
<div class="surge-meta">${he(detail)}</div>
</div>`
  }).join('')

  const flag = loc?.codes.length === 1 ? flagEmoji(loc.codes[0]) : '🔺'
  const html = page(heading,
    `<div class="loc-banner" style="background:linear-gradient(135deg,#8b1a00,#b5451b)">` +
    `<div class="loc-flag">${flag}</div>` +
    `<div><div class="loc-name">${he(heading)}</div>` +
    `<div class="loc-sub">${top.length} surge${top.length !== 1 ? 's' : ''} vs 7-day baseline · last 24 hours</div></div></div>` +
    sect('Coverage Surges') + `<div class="surge-list">${surgeRows}</div>` +
    `<p style="margin-top:12px;font-size:11px;color:#999;text-align:center">A surge is 2× or more vs the 7-day daily average.</p>` +
    `<div class="ft"><a href="${SITE}">Mukoko News — Open Data Analytics</a></div>`
  )
  return ok(textLines.join('\n'), html)
}

async function toolGetContentAnalytics(db: Db, args: Record<string, unknown>): Promise<McpToolResult> {
  const locationInput = sanitize(args.location, 100)
  const period = sanitize(args.period, 20)
  const since = sinceDate(period, 'week')

  const loc = locationInput ? resolveLocation(locationInput) : null
  if (locationInput && !loc?.codes.length) return err(`Could not resolve location: "${locationInput}"`)

  const srcIds = loc?.codes.length ? await feedSourceIds(db, loc.codes) : []
  const baseMatch: Record<string, unknown> = { status: { $in: APPROVED }, datePublished: { $gte: since } }
  if (srcIds.length) baseMatch.feedSourceId = { $in: srcIds }

  const [catResults, tagResults, countryResults, total] = await Promise.all([
    db.collection('articles').aggregate([
      { $match: { ...baseMatch, articleSection: { $ne: null } } },
      { $group: { _id: '$articleSection', cnt: { $sum: 1 } } },
      { $sort: { cnt: -1 } }, { $limit: 12 },
    ]).toArray() as Promise<Array<{ _id: string; cnt: number }>>,
    db.collection('articles').aggregate([
      { $match: baseMatch },
      { $unwind: '$tagIds' },
      { $group: { _id: '$tagIds', cnt: { $sum: 1 } } },
      { $sort: { cnt: -1 } }, { $limit: 15 },
      { $lookup: { from: 'tags', localField: '_id', foreignField: '_id', as: '_tag', pipeline: [{ $project: { name: 1 } }] } },
      { $unwind: { path: '$_tag', preserveNullAndEmpty: true } },
      { $project: { _id: 0, keyword: { $ifNull: ['$_tag.name', '$_id'] }, cnt: 1 } },
    ]).toArray() as Promise<Array<{ keyword: string; cnt: number }>>,
    srcIds.length ? Promise.resolve([] as Array<{ _id: string; cnt: number }>) :
    db.collection('articles').aggregate([
      { $match: baseMatch },
      { $lookup: { from: 'feedSources', localField: 'feedSourceId', foreignField: '_id', as: '_src', pipeline: [{ $project: { countryCode: 1 } }] } },
      { $unwind: { path: '$_src', preserveNullAndEmpty: true } },
      { $group: { _id: '$_src.countryCode', cnt: { $sum: 1 } } },
      { $sort: { cnt: -1 } }, { $limit: 16 },
    ]).toArray() as Promise<Array<{ _id: string; cnt: number }>>,
    db.collection('articles').countDocuments(baseMatch),
  ])

  const periodLabel = period === 'today' ? 'today' : period === 'month' ? 'this month' : 'this week'
  const heading = loc ? `${locationHeader(loc)} Content Analytics` : 'Africa Content Analytics'

  if (!total) return ok(`No articles found for ${loc?.label ?? 'Africa'} ${periodLabel}.`)

  const textLines = [`## ${heading} — ${periodLabel}\n${total.toLocaleString()} articles analysed\n`]
  if (catResults.length) {
    textLines.push('**By Category:**')
    catResults.forEach(c => textLines.push(`  • ${c._id}: ${c.cnt} (${Math.round(c.cnt / total * 100)}%)`))
    textLines.push('')
  }
  if (countryResults.length > 1) {
    textLines.push('**By Country:**')
    countryResults.forEach(c => textLines.push(`  ${flagEmoji(c._id ?? '')} ${COUNTRY_LABELS[c._id] ?? c._id}: ${c.cnt}`))
    textLines.push('')
  }
  if (tagResults.length) textLines.push('**Top Keywords:** ' + tagResults.slice(0, 12).map(k => k.keyword).join(', '))

  const flag = loc?.codes.length === 1 ? flagEmoji(loc.codes[0]) : '📊'
  const banner = `<div class="loc-banner"><div class="loc-flag">${flag}</div>` +
    `<div><div class="loc-name">${he(heading)}</div><div class="loc-sub">${total.toLocaleString()} articles · ${periodLabel}</div></div></div>`

  const maxCat = catResults[0]?.cnt ?? 1
  const catHtml = catResults.map(c => {
    const pct = Math.round(c.cnt / total * 100)
    return `<div class="trend-row"><div class="trend-label">${he(c._id)}</div>` +
      `<div class="trend-bar-wrap"><div class="trend-bar" style="width:${Math.round(c.cnt / maxCat * 100)}%;background:var(--co)"></div></div>` +
      `<div class="trend-cnt">${c.cnt} <span style="color:#bbb;font-size:9px">${pct}%</span></div></div>`
  }).join('')

  const maxCountry = countryResults[0]?.cnt ?? 1
  const countryHtml = countryResults.length > 1 ? countryResults.map(c => {
    const pct = Math.round(c.cnt / total * 100)
    return `<div class="trend-row"><div class="trend-label">${flagEmoji(c._id ?? '')} ${he(COUNTRY_LABELS[c._id] ?? c._id)}</div>` +
      `<div class="trend-bar-wrap"><div class="trend-bar" style="width:${Math.round(c.cnt / maxCountry * 100)}%;background:var(--ma)"></div></div>` +
      `<div class="trend-cnt">${c.cnt} <span style="color:#bbb;font-size:9px">${pct}%</span></div></div>`
  }).join('') : ''

  const pillsHtml = tagResults.length
    ? `<div class="pills">${tagResults.map(k => `<span class="pill">${he(k.keyword)}</span>`).join('')}</div>`
    : ''

  const html = page(heading,
    banner +
    (catHtml ? sect('By Category') + `<div class="trend-list">${catHtml}</div>` : '') +
    (countryHtml ? sect('By Country') + `<div class="trend-list">${countryHtml}</div>` : '') +
    (pillsHtml ? sect('Top Keywords') + pillsHtml : '') +
    `<div class="ft"><a href="${SITE}">Mukoko News — Open Data Analytics</a></div>`
  )
  return ok(textLines.join('\n'), html)
}

// ── Dispatch ───────────────────────────────────────────────────────────────

async function callTool(db: Db, name: string, args: Record<string, unknown>, req: Request): Promise<McpToolResult> {
  switch (name as ToolName) {
    case 'get_briefing':           return toolGetBriefing(db, args)
    case 'track_story':            return toolTrackStory(db, args)
    case 'get_location_news':      return toolGetLocationNews(db, args)
    case 'compare_locations':      return toolCompareLocations(db, args)
    case 'get_source_view':        return toolGetSourceView(db, args)
    case 'find_stories':           return toolFindStories(db, args)
    case 'get_article':            return toolGetArticle(db, args)
    case 'list_categories':        return toolListCategories(db)
    case 'list_sources':           return toolListSources(db, args)
    case 'get_stats':              return toolGetStats(db)
    case 'get_my_feed':            return toolGetMyFeed(db, args, req)
    case 'get_trending_analytics': return toolGetTrendingAnalytics(db, args)
    case 'detect_surge':           return toolDetectSurge(db, args)
    case 'get_content_analytics':  return toolGetContentAnalytics(db, args)
    default:                       return err(`Unknown tool: ${name}`)
  }
}

// ── Main handler ───────────────────────────────────────────────────────────

function jsonRpc(id: string | number | null | undefined, result?: unknown, error?: { code: number; message: string }): Response {
  const body: McpResponse = { jsonrpc: '2.0', id: id ?? null }
  if (error) body.error = error
  else body.result = result
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

export async function handleMcp(req: Request, db: Db): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
      },
    })
  }
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  let body: McpRequest
  try { body = await req.json() as McpRequest }
  catch { return jsonRpc(null, undefined, { code: -32700, message: 'Parse error' }) }

  const { jsonrpc, id, method, params } = body
  if (jsonrpc !== '2.0') return jsonRpc(id ?? null, undefined, { code: -32600, message: 'Invalid Request' })

  try {
    switch (method) {
      case 'initialize':
        return jsonRpc(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'mukoko-news', version: '3.0.0' },
          instructions:
            'You are connected to Mukoko News, a Pan-African news platform covering Zimbabwe and 15 ' +
            'other African countries. All data comes from MongoDB Atlas. Tools are task-oriented: ' +
            'get_briefing for "what\'s happening in X", track_story for developing stories, ' +
            'get_location_news for place-specific news, compare_locations for side-by-side country ' +
            'comparison, get_source_view for a publication\'s perspective. ' +
            'Open data analytics: get_trending_analytics (trending topics), detect_surge (sudden ' +
            'coverage spikes vs 7-day baseline), get_content_analytics (category/country breakdown). ' +
            'Personalised: get_my_feed requires a WorkOS bearer token. ' +
            'All tools understand country codes (ZW, KE, NG), country names, region names ' +
            '(East Africa, Southern Africa, West Africa, North Africa), and major city names.',
        })
      case 'notifications/initialized':
        return new Response(null, { status: 204 })
      case 'ping':
        return jsonRpc(id, {})
      case 'tools/list':
        return jsonRpc(id, { tools: TOOLS })
      case 'tools/call': {
        const name = String((params as Record<string, unknown>)?.name ?? '')
        const args = ((params as Record<string, unknown>)?.arguments ?? {}) as Record<string, unknown>
        return jsonRpc(id, await callTool(db, name, args, req))
      }
      default:
        return jsonRpc(id, undefined, { code: -32601, message: `Method not found: ${method}` })
    }
  } catch (e: unknown) {
    console.error('[MCP]', e)
    return jsonRpc(id, undefined, { code: -32603, message: 'Internal error' })
  }
}
