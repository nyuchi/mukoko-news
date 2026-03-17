# Security Policy

## Supported Versions

We release security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |
| < Latest| :x:                |

**Note**: Mukoko News is currently in active development. We recommend always using the latest version from the `main` branch.

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

**Do NOT** open a public GitHub issue for security vulnerabilities.

Instead, please email security reports to:

**security@nyuchi.com**

Include in your report:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### What to Expect

- **Acknowledgment**: We'll acknowledge receipt within 48 hours
- **Investigation**: We'll investigate and provide an initial assessment within 5 business days
- **Updates**: We'll keep you informed of progress
- **Fix Timeline**: Critical vulnerabilities will be patched within 7 days
- **Credit**: We'll credit you in the security advisory (unless you prefer to remain anonymous)

## Security Measures

### API Authentication

All API endpoints (`https://mukoko-news-api.fly.dev`) are protected with bearer token authentication:

#### 1. API_SECRET (Frontend-to-Backend)

- **Purpose**: Authenticates Vercel frontend to Fly.io FastAPI backend
- **Type**: Static bearer token
- **Storage**: Fly.io secrets, Vercel environment variables
- **Rotation**: Should be rotated every 90 days

**Security Best Practices**:

- Never commit API_SECRET to version control
- Use different secrets for development and production
- Store in `.env.local` for local development (gitignored)
- Set via `fly secrets set API_SECRET=your-secret` for production
- Rotate immediately if compromised

#### 2. OIDC JWT Tokens (User Authentication)

- **Provider**: id.mukoko.com (OpenID Connect)
- **Validation**: JWT signature verification, expiry checks
- **Priority**: User tokens take precedence over API_SECRET
- **Storage**: Never stored in localStorage (memory only)

**Security Best Practices**:

- Tokens expire automatically (check JWT `exp` claim)
- Use secure, httpOnly cookies where possible
- Implement token refresh flow
- Validate issuer and audience claims

### Role-Based Access Control (RBAC)

- **Active Roles**: `admin` only
- **Admin Routes**: `/api/admin/*` (separate admin authentication)
- **Protected Routes**: `/api/*` (require API_SECRET or JWT)
- **Public Routes**: `/api/health` (monitoring only)

**Security Best Practices**:

- Admin sessions use separate authentication
- Admin credentials never exposed to client
- Role checks enforced at middleware level
- Disabled roles: moderator, support, author, user (not implemented)

### Database Security

- **Platform**: Postgres (Supabase) with pgvector extension
- **Access**: Restricted to Fly.io backend via direct connection (asyncpg)
- **Migrations**: Version-controlled in `fly-worker/migrations/` and `database/migrations/`
- **Sensitive Data**: User emails, auth tokens (OIDC)
- **Document Store**: CouchDB for article body storage (internal Fly.io network)
- **Analytics**: Apache Doris for search indexing (internal Fly.io network)

**Security Best Practices**:

- Never expose database connection strings
- All queries use parameterized statements (SQL injection protection)
- Sensitive data encrypted at rest by Supabase
- Regular backups via Supabase dashboard
- Embedding vectors (pgvector) contain no PII

### Content Security

#### RSS Feed Collection

- **Rate Limiting**: 5-minute cooldown between collections
- **Validation**: RSS feed URL validation before fetching
- **Sanitization**: HTML content sanitized before storage
- **Source Verification**: Only whitelisted RSS sources

#### User-Generated Content

- **Input Validation**: All user inputs sanitized
- **XSS Prevention**: React auto-escapes by default, plus manual sanitization
- **SQL Injection**: Parameterized queries only
- **CSRF**: Not applicable (API-only, no session cookies)

#### JSON-LD Structured Data

- **XSS Prevention**: All JSON-LD content uses Unicode escaping
- **Escaped Characters**: `<` → `\u003c`, `>` → `\u003e`, `&` → `\u0026`
- **Implementation**: `safeJsonLdStringify()` in `src/components/ui/json-ld.tsx`
- **Test Coverage**: Dedicated XSS prevention tests in `src/components/__tests__/json-ld.test.tsx`

#### Image URL Validation

- **Protocol Whitelist**: Only `http://`, `https://`, and `/` (relative) URLs allowed
- **Blocked Protocols**: `javascript:`, `data:`, `blob:`, `vbscript:` URLs rejected
- **Implementation**: `isValidImageUrl()` in `src/lib/utils.ts`
- **Usage**: Applied to Avatar, NewsBytes, and article image components

#### CSS URL Injection Prevention

- **Standards-compliant Escaping**: All CSS `url()` values use `encodeURI()` via `safeCssUrl()` utility
- **Defense in Depth**: Applied even when URLs are already validated by `isValidImageUrl()`
- **Implementation**: `safeCssUrl()` in `src/lib/utils.ts`
- **Components**: Avatar (`src/components/ui/avatar.tsx`), NewsBytes (`src/app/newsbytes/page.tsx`)

### Deployment Security

#### Backend (Fly.io FastAPI)

- **Secrets Management**: `fly secrets set` (never in fly.toml or source code)
- **Environment Isolation**: Separate dev/production environments
- **HTTPS Only**: All traffic encrypted (Fly.io enforces via `force_https = true`)
- **Region**: JNB (Johannesburg, South Africa) — data stays in Africa
- **AI Services**: Cloudflare Workers AI for embeddings (API token auth, no data stored)

#### Mobile Web (Vercel)

- **Environment Variables**: Set via Vercel dashboard
- **HTTPS Only**: Vercel enforces HTTPS
- **Build Security**: Dependencies scanned during deployment
- **Headers**: Security headers configured in vercel.json

### Dependencies

- **Regular Updates**: Dependencies reviewed monthly
- **Vulnerability Scanning**: GitHub Dependabot enabled
- **Lock Files**: package-lock.json committed for reproducible builds
- **Peer Dependencies**: Mobile uses `--legacy-peer-deps` (React Native requirement)

## Known Security Considerations

### Current Limitations

1. **API_SECRET is static**: Consider implementing rotating secrets in the future
2. **No rate limiting on user endpoints**: May be added in future releases
3. **Admin authentication**: Uses separate session auth (documented in [API_SECRET_SETUP.md](API_SECRET_SETUP.md))

### Future Improvements

- [ ] Implement API rate limiting per client
- [ ] Add request signing for API_SECRET
- [ ] Implement secret rotation automation
- [ ] Add 2FA for admin accounts
- [ ] Implement audit logging for admin actions

## Compliance

- **Data Protection**: User data stored in Supabase Postgres (configurable region)
- **Privacy**: See PRIVACY.md for data handling policies
- **Terms**: See TERMS.md for service terms

## Security Checklist for Developers

Before deploying changes:

- [ ] Run TypeScript type checks: `npm run typecheck`
- [ ] Run tests: `npm run test`
- [ ] Check for dependency vulnerabilities: `npm audit`
- [ ] Verify environment variables are set correctly
- [ ] Never commit secrets to version control
- [ ] Test authentication flows
- [ ] Review RBAC permissions
- [ ] Validate user inputs

## Security Updates

Security updates will be announced via:

- GitHub Security Advisories
- Email to security@nyuchi.com subscribers
- Release notes in CHANGELOG.md

## Contact

- **Security Issues**: security@nyuchi.com
- **General Support**: support@nyuchi.com
- **Website**: https://mukoko.com

---

**Last Updated**: 2026-01-24

Built with security in mind by [Nyuchi Technologies](https://brand.nyuchi.com)
