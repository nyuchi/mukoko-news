# Contributing to Mukoko News

First off, thank you for considering contributing to Mukoko News! It's people like you who make Mukoko News a great tool for the Pan-African community.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Testing](#testing)
- [Documentation](#documentation)

## Code of Conduct

By participating in this project, you agree to uphold our values of respect, inclusivity, and collaboration. We are building for the Pan-African community, and we expect all contributors to treat each other with dignity and respect.

### Our Standards

- **Be Respectful**: Respect differing viewpoints and experiences
- **Be Inclusive**: Welcome newcomers and help them get started
- **Be Collaborative**: Work together and share knowledge
- **Be Professional**: Keep discussions focused and constructive

## How Can I Contribute?

### Reporting Bugs

Before creating a bug report, please check the [existing issues](https://github.com/nyuchitech/mukoko-news/issues) to avoid duplicates.

When reporting a bug:

1. Use the bug report template
2. Include detailed steps to reproduce
3. Provide environment information (OS, browser, device)
4. Include error logs if applicable
5. Add screenshots if relevant

**Note**: Security vulnerabilities should be reported to security@nyuchi.com, NOT via GitHub issues.

### Suggesting Features

We welcome feature suggestions! Before creating a feature request:

1. Check existing feature requests
2. Use the feature request template
3. Explain the problem you're trying to solve
4. Describe your proposed solution
5. Consider how it fits Mukoko News's mission

### Contributing Code

We love code contributions! Here's how to get started:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run tests and linting
5. Commit with conventional commits
6. Push and create a Pull Request

## Development Setup

### Prerequisites

- Node.js 20+
- npm
- Cloudflare account (for backend development)

### Frontend Setup

```bash
# Clone the repository
git clone https://github.com/nyuchitech/mukoko-news.git
cd mukoko-news

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your values

# Start development server
npm run dev

# Build for production
npm run build

# Run tests
npm run test
```

### Backend Setup

```bash
# Navigate to backend directory
cd backend

# Install dependencies
npm install

# Apply database schema locally
npm run db:local

# Start development server
npm run dev

# Run tests
npm run test
```

### Environment Variables

Create `.env.local` in the root directory:

```env
# API URL
NEXT_PUBLIC_API_URL=https://mukoko-news-api.fly.dev

# API Secret (for server-side requests)
API_SECRET="your_api_secret_here"
```

## Pull Request Process

### Before Submitting

1. **Update Documentation**: Update README.md, CHANGELOG.md, or other docs if needed
2. **Run Tests**: Ensure all tests pass (`npm run test`)
3. **Run Linting**: Fix any linting errors (`npm run lint:fix`)
4. **Type Check**: Ensure TypeScript types are correct (`npm run typecheck`)
5. **Test Manually**: Test your changes in the app

### PR Guidelines

1. **One Feature Per PR**: Keep PRs focused on a single feature or bug fix
2. **Descriptive Title**: Use a clear, descriptive title
3. **Detailed Description**: Explain what, why, and how
4. **Link Issues**: Reference related issues (e.g., "Fixes #123")
5. **Add Screenshots**: For UI changes, include before/after screenshots
6. **Update Tests**: Add or update tests for your changes

### PR Template

```markdown
## Description

Brief description of what this PR does

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

## Related Issues

Fixes #(issue number)

## Testing

Describe how you tested your changes

## Screenshots (if applicable)

Add screenshots here

## Checklist

- [ ] My code follows the project's coding standards
- [ ] I have run `npm run lint` and fixed any issues
- [ ] I have run `npm run typecheck` and fixed any type errors
- [ ] I have run `npm run test` and all tests pass
- [ ] I have updated the documentation
- [ ] I have added tests for my changes
- [ ] I have tested on desktop and mobile browsers
```

## Coding Standards

### General Guidelines

- **Keep it Simple**: Avoid over-engineering
- **Write Readable Code**: Use descriptive variable and function names
- **Comment Wisely**: Explain why, not what
- **Follow Existing Patterns**: Match the existing codebase style

### TypeScript

- **Use TypeScript**: All backend code must use TypeScript
- **Strict Mode**: Enable TypeScript strict mode
- **Type Everything**: Avoid `any` types when possible
- **Use Interfaces**: Define interfaces for complex objects

### React / Next.js

- **Functional Components**: Use functional components with hooks
- **TypeScript**: Define TypeScript interfaces for props
- **Component Organization**: One component per file
- **Naming**: Use PascalCase for components, camelCase for functions
- **Client Components**: Add "use client" directive when using hooks or browser APIs

### Backend

- **Services Pattern**: Use services for business logic
- **Middleware**: Create middleware for cross-cutting concerns
- **Error Handling**: Always handle errors gracefully
- **Database**: Use parameterized queries to prevent SQL injection

### Styling

- **ESLint**: Follow ESLint configuration (flat config, ESLint 9)
- **Prettier**: Code will be auto-formatted (if configured)
- **Indentation**: 2 spaces (not tabs)
- **Line Length**: Max 100 characters
- **Semicolons**: Required

### File Organization

```
mukoko-news/
├── src/               # Next.js frontend
│   ├── app/           # App Router pages
│   ├── components/    # React components
│   │   ├── ui/        # Reusable UI components
│   │   └── layout/    # Layout components (header, footer, bottom-nav)
│   ├── contexts/      # React contexts
│   └── lib/           # Utilities, API client, constants
├── backend/           # Cloudflare Workers API
│   ├── services/      # Business logic services
│   ├── middleware/    # Route middleware
│   └── index.ts       # API entry point
└── database/          # D1 schema and migrations
    ├── schema.sql     # Complete schema
    └── migrations/    # Migration files
```

## Commit Message Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/).

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **style**: Code style changes (formatting, no logic change)
- **refactor**: Code refactoring
- **test**: Adding or updating tests
- **chore**: Maintenance tasks, dependency updates

### Examples

```bash
# Feature
feat(mobile): Add pull-to-refresh for RSS collection

# Bug fix
fix(api): Correct category_id field in trending categories query

# Documentation
docs: Update README with new API endpoints

# Breaking change
feat(auth)!: Migrate to OIDC authentication

BREAKING CHANGE: Old session-based auth is no longer supported
```

## Testing

### Frontend Tests

```bash
# Run all tests
npm run test

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage
```

**Test Files**:
- `src/lib/__tests__/` - Utility and constant tests
- `src/components/__tests__/` - Component tests (including JSON-LD security)

### Backend Tests

```bash
cd backend

# Run all tests
npm run test

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage
```

**Requirements**:

- Write tests for new features
- Update tests for bug fixes
- Maintain or improve code coverage
- Tests should pass before merging

### Manual Testing

For UI changes, please test on:

- **Desktop**: Chrome, Safari, Firefox
- **Mobile**: Chrome (Android), Safari (iOS)
- **Dark Mode**: Test both light and dark themes

## Documentation

### Code Documentation

- **JSDoc**: Use JSDoc for functions and classes
- **Inline Comments**: Explain complex logic
- **README**: Update README for new features
- **CHANGELOG**: Add entry to CHANGELOG.md

### Example JSDoc

```typescript
/**
 * Fetch articles from RSS sources
 * @param {number} limit - Maximum number of articles to fetch
 * @param {string[]} categories - Categories to filter by
 * @returns {Promise<Article[]>} Array of articles
 */
async function fetchArticles(limit: number, categories: string[]): Promise<Article[]> {
  // Implementation
}
```

### Documentation Files

When making significant changes, update:

- **README.md** - Project overview and quick start
- **CLAUDE.md** - AI assistant instructions
- **CHANGELOG.md** - Version history
- **API_SECRET_SETUP.md** - Authentication setup
- **api-schema.yml** - OpenAPI specification

## Getting Help

- **Documentation**: Check [README.md](README.md) and [CLAUDE.md](CLAUDE.md)
- **Issues**: Search [existing issues](https://github.com/nyuchitech/mukoko-news/issues)
- **Email**: support@nyuchi.com for general questions
- **Security**: security@nyuchi.com for security issues

## Recognition

All contributors will be recognized in our contributors list. Thank you for helping build Mukoko News!

---

"Ndiri nekuti tiri" — I am because we are

Built with ❤️ by [Nyuchi Technologies](https://brand.nyuchi.com)
