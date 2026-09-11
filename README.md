<div align="center">

# Mukoko News

**Pan-African news, in one place.**

"Mukoko" means _beehive_ in Shona — where the community gathers and stores knowledge.
Mukoko News aggregates hundreds of African newsrooms into one feed, so a reader in Harare
can follow Lagos, Nairobi and Dakar without opening twenty tabs.

All **54** African Union member states are in scope. How many are _live_ is a number the
app measures rather than asserts — see [Coverage](#coverage).

**Version:** 4.58.0 &nbsp;·&nbsp; **Live:** [news.mukoko.com](https://news.mukoko.com)

[**Read the news →**](https://news.mukoko.com) &nbsp;·&nbsp;
[**Join the Discord →**](https://discord.gg/Ga2XusN6Ty) &nbsp;·&nbsp;
[**Contribute →**](CONTRIBUTING.md)

<br />

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=000)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB_Atlas-7-47A248?logo=mongodb&logoColor=white)](https://www.mongodb.com/atlas)
[![Vitest](https://img.shields.io/badge/Vitest-4-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![Vercel](https://img.shields.io/badge/Vercel-deployed-000000?logo=vercel&logoColor=white)](https://vercel.com/)

[![Discord](https://img.shields.io/badge/Discord-join_the_hive-5865F2?logo=discord&logoColor=white)](https://discord.gg/Ga2XusN6Ty)
[![Live site](https://img.shields.io/badge/live-news.mukoko.com-brightgreen)](https://news.mukoko.com)
[![CI](https://github.com/nyuchi/mukoko-news/actions/workflows/deploy.yml/badge.svg)](https://github.com/nyuchi/mukoko-news/actions/workflows/deploy.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

> **The sibling repos.** This one is the reader-facing web app. The
> [gateway](https://github.com/nyuchi/mukoko-news-gateway) is the public API and MCP server;
> the [pipeline](https://github.com/nyuchi/mukoko-news-pipeline) does the ingestion and
> enrichment. Issues land in whichever repo owns the code.

---

## What is this?

This repository is the **Next.js 15 frontend** for Mukoko News, deployed on Vercel. It is one part of a three-repo platform:

| Repo                                 | Role                                         |
| ------------------------------------ | -------------------------------------------- |
| **`nyuchi/mukoko-news`** (this repo) | Web frontend — Next.js 15, Vercel            |
| `nyuchi/mukoko-news-gateway`         | Public API + MCP server — Cloudflare Workers |
| `nyuchi/mukoko-news-pipeline`        | Data pipeline — Fly.io + Cloudflare          |

The frontend reads news data directly from MongoDB Atlas via Next.js Server Actions.

---

## Features

- **Pan-African coverage** — see [Coverage](#coverage) for what that claim means
- **Discover** — browse by country, category, or source
- **NewsBytes** — TikTok-style vertical swipe feed for quick headlines
- **Search** — full-text search across all articles
- **Dark mode** — respects system preference
- **Embed widgets** — drop a news feed into any site with one `<script>` tag
- **MCP server** — AI assistants can query Pan-African news at `news.mukoko.dev/mcp`
- **Accessible** — Radix UI primitives, WCAG AAA contrast, Schema.org structured data

---

## Coverage

**All 54 African Union member states are in scope. The number that is _live_ is a query, not a constant.**

`getLiveCoverageAction()` counts the countries that actually cleared the publishing bar in
the last 30 days, and `coverageFragment(n)` / `coverageClaim(n)` in `src/lib/constants.ts`
are the only sanctioned wording — every page, meta tag and JSON-LD blurb interpolates one
of them. So a country that starts producing appears on its own, and one that goes quiet
drops off on its own, with no code change and nobody editing a number in a file.

This README deliberately does not print the current figure. A hard-coded count in a
document nothing tests is exactly how the app came to claim "16 African countries" on nine
surfaces that had each drifted apart. `src/lib/__tests__/coverage-claim.test.ts` enforces
the rule for `src/`; here it is enforced by not writing one down.

## Contributing

We welcome contributions to the frontend — UI improvements, new features, bug fixes, accessibility, tests, and documentation are all fair game. **You do not need a database connection to contribute**: the whole suite runs against mocked data, and most UI work can be done with the dev server pointed at the live API.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide, and come say hello in
[**the Discord**](https://discord.gg/Ga2XusN6Ty) — it is the fastest way to get a question
answered or to find out whether someone is already on the issue you picked.

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
- Any of the unit and integration tests — they all mock the data layer
- Documentation and accessibility improvements

### Running tests

```bash
pnpm test             # full suite
pnpm test:watch       # watch mode
pnpm test:coverage    # with coverage report
```

---

## Tech stack

| Layer      | Technology                       |
| ---------- | -------------------------------- |
| Framework  | Next.js 15, App Router, React 19 |
| Styling    | Tailwind CSS 4, CSS variables    |
| Components | Radix UI (accessible primitives) |
| Icons      | Lucide React                     |
| Theme      | next-themes                      |
| Auth       | WorkOS AuthKit                   |
| Data       | MongoDB Atlas via Server Actions |
| Tests      | Vitest, React Testing Library    |
| Deploy     | Vercel                           |

### Design system

**[Mzizi](https://mzizi.dev) is the upstream source** for the palette, the background
scale and the type ramp. Be precise about how that binding works, because it is looser
than "read from Mzizi" suggests:

- `src/app/globals.css` holds this app's copy of the values. Nothing is fetched at build
  time or at runtime — there is no Mzizi package dependency and no network call.
- `src/app/__tests__/design-tokens.test.ts` parses that stylesheet and asserts every
  value against a `SNAPSHOT` object literal **inside the test file itself**. There is no
  separate snapshot artefact.
- That snapshot is a copy of what `mzizi_get_tokens` returned on a dated, recorded
  refresh. It is updated **deliberately**, by a human re-querying the MCP in a reviewed
  change — never by relaxing an assertion.

So CI catches `globals.css` drifting away from the frozen copy. It does **not** catch
Mzizi itself moving; that is what the deliberate refresh is for.

Mzizi's full palette is **21 colour families** — seven minerals, seven heritage, seven
experimental. This app uses the **seven minerals**; these four are the ones you meet
first:

| Role          | Light     | Dark      | Mineral                                                |
| ------------- | --------- | --------- | ------------------------------------------------------ |
| `--primary`   | `#4B0082` | `#B388FF` | Tanzanite                                              |
| `--secondary` | `#0047AB` | `#00B0FF` | Cobalt                                                 |
| `--success`   | `#004D40` | `#64FFDA` | Malachite                                              |
| `--surface`   | `#EEEEEC` | `#131211` | _(Mzizi `surface` — a background step, not a mineral)_ |

Fonts: **Noto Serif** (display/headings), **Noto Sans** (UI/body), **JetBrains Mono**
(data and labels) — self-hosted via `next/font`.

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
      "url": "https://news.mukoko.dev/mcp"
    }
  }
}
```

The read tools answer anonymously. The server itself lives in
[`nyuchi/mukoko-news-gateway`](https://github.com/nyuchi/mukoko-news-gateway) and is
deployed to `news.mukoko.dev`, not to this app — `news.mukoko.com` serves no `/mcp`
route.

---

## Project structure

```
src/
├── app/              # Pages (Next.js App Router)
├── components/
│   ├── ui/           # Primitives (Button, Card, Skeleton, ErrorBoundary, …)
│   ├── layout/       # Header, footer, mobile nav
│   └── *.tsx         # Feature components (ArticleCard, HeroCard, ShareModal, …)
├── contexts/         # PreferencesContext, CoverageContext (theme via next-themes)
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

We take security seriously. Report vulnerabilities by email to **<security@nyuchi.com>** — please do not open a public GitHub issue. See [SECURITY.md](SECURITY.md) for details.

---

## Licence

**This repository ships no LICENSE file**, and `package.json` declares no `license`
field. Despite the wording below, no licence is currently granted — a LICENSE file
needs adding before the "open-source contributors" framing is accurate.

© Nyuchi Africa (PVT) Ltd.

---

"Ndiri nekuti tiri" — I am because we are

Built by [Nyuchi Web Services](https://nyuchi.com) and contributors.
