# Mukoko News

**Pan-African news, in one place.**

"Mukoko" means "Beehive" in Shona — where community gathers and stores knowledge. Mukoko News aggregates news from 100+ sources across all 54 African Union member states, surfacing the stories that matter to the continent.

[![Live site](https://img.shields.io/badge/live-news.mukoko.com-brightgreen)](https://news.mukoko.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

---

## What is this?

This repository is the **Next.js 15 frontend** for Mukoko News, deployed on Vercel. It is one part of a three-repo platform:

| Repo | Role |
|---|---|
| **`nyuchi/mukoko-news`** (this repo) | Web frontend — Next.js 15, Vercel |
| `nyuchi/mukoko-news-gateway` | Public API + MCP server — Cloudflare Workers |
| `nyuchi/mukoko-news-pipeline` | Data pipeline — Fly.io + Cloudflare |

The frontend reads news data directly from MongoDB Atlas via Next.js Server Actions.

---

## Features

- **Pan-African coverage** — 54 countries, 100+ sources, updated continuously
- **Discover** — browse by country, category, or source
- **NewsBytes** — TikTok-style vertical swipe feed for quick headlines
- **Search** — full-text search across all articles
- **Dark mode** — respects system preference
- **Embed widgets** — drop a news feed into any site with one `<script>` tag
- **MCP server** — AI assistants can query Pan-African news at `news.mukoko.com/mcp`
- **Accessible** — Radix UI primitives, WCAG AAA contrast, Schema.org structured data

---

## Contributing

We welcome contributions to the frontend — UI improvements, new features, bug fixes, accessibility, tests, and documentation are all fair game. **You do not need a database connection to contribute**: all 448 tests run against mocked data, and most UI work can be done with the dev server pointed at the live API.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

### Quick start for contributors

```bash
# Prerequisites: Node.js 20+, pnpm 10+
git clone https://github.com/nyuchi/mukoko-news.git
cd mukoko-news
pnpm install

# Run the test suite — no credentials needed
pnpm test

# Start the dev server (reads from the live API by default)
cp .env.example .env.local
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### What you can work on without credentials

- All React components in `src/components/`
- Page layouts and routing in `src/app/`
- The embed widget script in `public/embed/`
- Any of the 448 unit and integration tests — they all mock the data layer
- Documentation and accessibility improvements

### Running tests

```bash
pnpm test             # full suite
pnpm test:watch       # watch mode
pnpm test:coverage    # with coverage report
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15, App Router, React 19 |
| Styling | Tailwind CSS 4, CSS variables |
| Components | Radix UI (accessible primitives) |
| Icons | Lucide React |
| Theme | next-themes |
| Auth | WorkOS AuthKit |
| Data | MongoDB Atlas via Server Actions |
| Tests | Vitest, React Testing Library |
| Deploy | Vercel |

### Design system

Nyuchi Brand v6 — African Minerals palette:

| Token | Colour | Name |
|---|---|---|
| Primary | `#4B0082` | Tanzanite |
| Secondary | `#0047AB` | Cobalt |
| Accent | `#5D4037` | Gold |
| Surface | `#FAF9F5` | Warm Cream |

Fonts: Noto Serif (headings) + Plus Jakarta Sans (body).

---

## Embed widget

Add a Mukoko News feed to any website:

```html
<script src="https://news.mukoko.com/embed/widget.js"
        data-layout="cards"
        data-feed="latest"
        data-country="ZW">
</script>
```

**Layouts**: `cards` · `compact` · `hero` · `ticker` · `list`  
**Feeds**: `top` · `featured` · `latest` · `location`  
**Country**: any ISO 3166-1 alpha-2 code (e.g. `ZW`, `KE`, `ZA`, `NG`)

---

## MCP server

AI assistants and agents can query Pan-African news via the [Model Context Protocol](https://modelcontextprotocol.io):

```json
{
  "mcpServers": {
    "mukoko-news": {
      "type": "http",
      "url": "https://news.mukoko.com/mcp"
    }
  }
}
```

No authentication required. The MCP server lives in [`nyuchi/mukoko-news-gateway`](https://github.com/nyuchi/mukoko-news-gateway).

---

## Project structure

```
src/
├── app/              # Pages (Next.js App Router)
├── components/
│   ├── ui/           # Shared components (ArticleCard, Skeleton, ErrorBoundary, …)
│   └── layout/       # Header, footer, mobile nav
├── contexts/         # PreferencesContext, ThemeContext
└── lib/
    ├── actions/      # Server Actions — all database reads go through here
    ├── mongodb/      # MongoDB query helpers
    ├── constants.ts  # Countries, categories, URL utilities
    └── utils.ts      # Formatting + security helpers
public/
└── embed/            # Self-contained widget script
```

---

## Security

We take security seriously. Report vulnerabilities by email to **security@nyuchi.com** — please do not open a public GitHub issue. See [SECURITY.md](SECURITY.md) for details.

---

## License

MIT — see [LICENSE](LICENSE).

---

"Ndiri nekuti tiri" — I am because we are

Built by [Nyuchi Technologies](https://nyuchi.com) and open-source contributors.
