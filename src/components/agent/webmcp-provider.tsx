'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getArticlesAction, searchArticlesAction } from '@/lib/actions/feed'
import { getArticleUrl } from '@/lib/constants'

// WebMCP — exposes Mukoko News' key actions to in-browser AI agents via the
// experimental `navigator.modelContext.provideContext()` API. Tools call the
// same Server Actions the UI uses (no secrets reach the client), so an agent in
// the page can search and read news directly.
// Spec: https://webmachinelearning.github.io/webmcp/

interface WebMcpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }> }>
}

interface ModelContext {
  provideContext?: (ctx: { tools: WebMcpTool[] }) => void
}

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] }
}

const TOOLS: WebMcpTool[] = [
  {
    name: 'search_mukoko_news',
    description:
      'Search Mukoko News — Pan-African news across Zimbabwe and 15 other African countries. Returns matching headlines with links.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms, e.g. "Zimbabwe elections".' },
        limit: { type: 'number', description: 'Max results (default 10).' },
      },
      required: ['query'],
    },
    execute: async (args) => {
      const query = String(args.query ?? '').trim()
      if (!query) return text('Provide a search query.')
      const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25)
      const articles = await searchArticlesAction(query, limit)
      if (!articles.length) return text(`No results for "${query}".`)
      const lines = articles.map(
        (a) => `- ${a.title}${a.source ? ` (${a.source})` : ''} — ${getArticleUrl(a.id)}`
      )
      return text(`${articles.length} result(s) for "${query}":\n${lines.join('\n')}`)
    },
  },
  {
    name: 'get_latest_headlines',
    description: 'Get the latest Mukoko News headlines across all African sources, newest first.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max headlines (default 10).' },
      },
    },
    execute: async (args) => {
      const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25)
      const { articles } = await getArticlesAction({ sort: 'latest', limit })
      if (!articles.length) return text('No headlines available right now.')
      const lines = articles.map(
        (a) => `- ${a.title}${a.source ? ` (${a.source})` : ''} — ${getArticleUrl(a.id)}`
      )
      return text(`Latest headlines:\n${lines.join('\n')}`)
    },
  },
  {
    name: 'open_article',
    description: 'Open a Mukoko News article by its id in the current tab.',
    inputSchema: {
      type: 'object',
      properties: { articleId: { type: 'string', description: 'The article id.' } },
      required: ['articleId'],
    },
    // Wired to the router at registration time (see below).
    execute: async () => text('Navigation handler not initialised.'),
  },
]

export function WebMcpProvider() {
  const router = useRouter()

  useEffect(() => {
    const mc = (navigator as Navigator & { modelContext?: ModelContext }).modelContext
    if (!mc?.provideContext) return // browser doesn't support WebMCP — no-op

    // Bind open_article to the client router (navigation must happen in-page).
    const tools = TOOLS.map((t) =>
      t.name === 'open_article'
        ? {
            ...t,
            execute: async (args: Record<string, unknown>) => {
              const id = String(args.articleId ?? '').trim()
              if (!id) return text('Provide an articleId.')
              router.push(`/article/${encodeURIComponent(id)}`)
              return text(`Opening article ${id}.`)
            },
          }
        : t
    )

    try {
      mc.provideContext({ tools })
    } catch (err) {
      console.error('[webmcp] provideContext failed', err)
    }
  }, [router])

  return null
}
