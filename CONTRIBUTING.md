# Contributing to Mukoko News

Thank you for considering a contribution to Mukoko News! This guide covers the **Next.js frontend** in `nyuchi/mukoko-news`. For the gateway API or data pipeline, see those repos.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Commit Messages](#commit-messages)
- [Testing](#testing)
- [Getting Help](#getting-help)

## Code of Conduct

We are building for the Pan-African community. Treat all contributors with respect, be inclusive, and keep discussions constructive.

Security vulnerabilities must be reported to **security@nyuchi.com**, not via GitHub issues.

## Getting Started

This repo is the Next.js frontend only. It reads data from MongoDB Atlas via Server Actions — there is no local backend to run.

**What you can work on without a MongoDB connection:**

- UI components (`src/components/`)
- Page layouts and routing (`src/app/`)
- Utility functions (`src/lib/utils.ts`, `src/lib/constants.ts`)
- Tests (all 448 tests mock the Server Actions — no live DB needed)
- The embed widget (`public/embed/widget.js`)

**For live data**, you need a `MONGODB_URI` — contact the maintainers.

## Development Setup

### Prerequisites

- Node.js 20+, pnpm 10+

### Steps

```bash
# Clone
git clone https://github.com/nyuchi/mukoko-news.git
cd mukoko-news

# Install dependencies
pnpm install

# Configure environment
cp .env.example .env.local
# Fill in at minimum: MONGODB_URI, WORKOS_CLIENT_ID, WORKOS_COOKIE_PASSWORD

# Start dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Available Commands

```bash
pnpm dev              # Next.js dev server (port 3000)
pnpm build            # Production build
pnpm lint             # ESLint check
pnpm lint:fix         # ESLint auto-fix
pnpm typecheck        # TypeScript check
pnpm test             # Vitest (single run)
pnpm test:watch       # Vitest (watch mode)
pnpm test:coverage    # Vitest with v8 coverage

# Run a single test file
pnpm vitest run src/lib/__tests__/utils.test.ts
# Run tests matching a pattern
pnpm vitest run -t "formatTimeAgo"
```

## Pull Request Process

### Before Submitting

1. `pnpm lint` — fix any ESLint errors
2. `pnpm typecheck` — fix any TypeScript errors
3. `pnpm test` — all 448 tests must pass
4. `pnpm build` — build must succeed
5. Test your change manually in the browser (golden path + edge cases)

### PR Guidelines

- **One thing per PR**: one feature, one bug fix, one refactor
- **Descriptive title** following Conventional Commits format
- **Reference related issues** with `Fixes #123`
- **Add or update tests** for any changed behaviour
- **No AI-generated summaries** in PR descriptions — explain *why* the change matters

### PR Template

```markdown
## What

Brief description of the change.

## Why

Why is this needed? Link to issue if applicable (Fixes #NNN).

## Testing

How did you test this? Screenshots for UI changes.

## Checklist

- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] Tested manually in browser
- [ ] Tests added/updated for new behaviour
```

## Coding Standards

### TypeScript

- Strict mode is enabled — no `any` types
- Define interfaces for all component props and data shapes
- Unused variables must be prefixed with `_`

### React / Next.js

- Functional components only
- Server Components by default; add `'use client'` only when needed (hooks, browser APIs)
- Use `@/lib/actions/feed` Server Actions for data — never fetch from the gateway Worker directly in page components
- One component per file, PascalCase filenames (`ArticleCard.tsx`)
- Pages in kebab-case directories (`article/[slug]/page.tsx`)

### Styling

- Tailwind CSS only — no inline styles
- Use design system tokens: `bg-primary`, `text-foreground`, `bg-surface`, etc.
- 2-space indent, max 100 chars per line
- Radix UI for interactive primitives (accessible by default)

### Security

- **JSON-LD**: always use `safeJsonLdStringify()` — never `JSON.stringify()` in `<script>` tags
- **Image URLs**: validate with `isValidImageUrl()` before rendering user-provided URLs
- **CSS URLs**: use `safeCssUrl()` for any `background-image: url()` values
- **Admin mutations**: route through `src/lib/admin/gateway.ts` with WorkOS tokens — never bypass

### File Structure

```text
src/
├── app/                   # Pages (App Router)
├── components/
│   ├── ui/                # Shared UI components
│   └── layout/            # Header, footer, nav
├── contexts/              # React context providers
└── lib/
    ├── actions/           # Server Actions
    ├── mongodb/           # MongoDB query helpers
    ├── admin/             # Gateway proxy for admin mutations
    ├── auth/              # Auth utilities
    ├── api.ts             # Client-side fetch helper
    ├── constants.ts       # Countries, categories, URL helpers
    └── utils.ts           # Formatting, security helpers
```

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>
```

**Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

**Examples:**

```bash
feat(discover): add country filter to sources section
fix(newsbytes): correct scroll position reset on feed change
docs: update CONTRIBUTING setup instructions
test(embed): add iframe layout rendering tests
chore: update lucide-react to 0.470
```

## Testing

All tests mock Server Actions — no MongoDB connection required.

```bash
pnpm test             # Run all 448 tests
pnpm test:watch       # Watch mode during development
pnpm test:coverage    # Coverage report (thresholds: 60% lines, 50% branches)
```

**Mock pattern** — pages use Server Actions, so mock `@/lib/actions/feed`:

```tsx
vi.mock("@/lib/actions/feed", () => ({
  getArticlesAction: vi.fn(),
  getCategoriesAction: vi.fn(),
  getSourcesAction: vi.fn(),
}));
```

**Never** mock `@/lib/api` for page tests — that's the client-side helper used only by the embed widget and route handlers.

## Getting Help

- **Issues**: [github.com/nyuchi/mukoko-news/issues](https://github.com/nyuchi/mukoko-news/issues)
- **General**: support@nyuchi.com
- **Security**: security@nyuchi.com

---

"Ndiri nekuti tiri" — I am because we are

Built with love by [Nyuchi Technologies](https://nyuchi.com)
