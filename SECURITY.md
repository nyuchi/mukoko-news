# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest (`main`) | Yes |
| Older branches | No |

We only maintain the latest version. Always use `main`.

## Reporting a Vulnerability

**Do NOT** open a public GitHub issue for security vulnerabilities.

Email: **security@nyuchi.com**

Include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (optional)

**Response timeline:**

- Acknowledgment within 48 hours
- Initial assessment within 5 business days
- Critical vulnerabilities patched within 7 days
- Credit in the security advisory (unless you prefer anonymity)

## Architecture

This repo is the **Next.js frontend only**. It reads data directly from MongoDB Atlas via Server Actions. There is no Cloudflare Worker or external backend API involved in normal page rendering.

```
Browser → Vercel (Next.js) → MongoDB Atlas
```

Admin mutations are the only exception — they are proxied through the gateway Worker (`src/lib/admin/gateway.ts`) using a WorkOS access token that is verified server-side.

## Security Measures

### Authentication (WorkOS AuthKit)

- Session stored in an encrypted HTTP-only cookie (`WORKOS_COOKIE_PASSWORD`)
- `src/middleware.ts` refreshes the session on every request — no explicit redirect
- `withAuth()` from `@workos-inc/authkit-nextjs` used in Server Components to read the session
- Admin mutations verify the WorkOS access token via the gateway Worker's RBAC

### Content Security

#### JSON-LD XSS Prevention

All structured data uses `safeJsonLdStringify()` (`src/components/ui/json-ld.tsx`), which escapes `<`, `>`, and `&` before injecting into `<script type="application/ld+json">` tags.

```tsx
// Always use:
safeJsonLdStringify(data)
// Never use:
JSON.stringify(data)  // unsafe in script tags
```

Test coverage: `src/components/__tests__/json-ld.test.tsx`

#### Image URL Validation

Use `isValidImageUrl()` (`src/lib/utils.ts`) before rendering any user-provided image URL. Blocks `javascript:`, `data:`, `blob:`, and `vbscript:` protocols.

#### CSS URL Injection Prevention

Use `safeCssUrl()` (`src/lib/utils.ts`) for all `background-image: url()` CSS values. Decodes then re-encodes to prevent double-encoding and injection attacks.

```tsx
style={{ backgroundImage: safeCssUrl(src) }}   // safe
style={{ backgroundImage: `url(${src})` }}      // never do this
```

#### Input Handling

- Article content is fetched from MongoDB and rendered as plain text or sanitized HTML — never dangerously set via `dangerouslySetInnerHTML` without sanitization
- Search query parameters are validated and encoded before use in MongoDB queries

### Data Access

MongoDB Atlas is accessed only from Vercel server-side (Server Actions, Route Handlers). The `MONGODB_URI` is never exposed to the browser. Connection strings are stored as Vercel environment variables.

### Dependencies

- GitHub Dependabot is enabled for automated vulnerability alerts
- `package-lock.json` is committed for reproducible CI builds
- Run `npm audit` before releases to check for known vulnerabilities

### Secrets Management

| Secret | Where Stored |
|---|---|
| `MONGODB_URI` | Vercel environment variables |
| `WORKOS_API_KEY` | Vercel environment variables |
| `WORKOS_COOKIE_PASSWORD` | Vercel environment variables |
| `GATEWAY_API_URL` | Vercel environment variables |

Never commit secrets to version control. `.env.local` is gitignored.

## Security Checklist for Contributors

Before opening a PR that touches data handling or auth:

- [ ] No `MONGODB_URI` or secrets referenced in client components
- [ ] `safeJsonLdStringify()` used for all JSON-LD
- [ ] `isValidImageUrl()` called before rendering user-provided URLs
- [ ] `safeCssUrl()` used for all `background-image: url()` values
- [ ] No `dangerouslySetInnerHTML` without explicit sanitization
- [ ] MongoDB queries use typed parameters — no string interpolation
- [ ] Admin routes protected via `withAuth()` + role check

## Known Limitations

- Rate limiting on public-facing pages is handled at the Vercel edge (not in application code)
- The embed widget (`public/embed/widget.js`) runs in a sandboxed iframe — `allow-same-origin` is intentionally omitted

## Contact

- Security issues: security@nyuchi.com
- General support: support@nyuchi.com
- Website: https://news.mukoko.com

---

**Last Updated**: 2026-06-21
