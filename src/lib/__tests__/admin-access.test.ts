import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Structural assertions about the admin surface.
 *
 * These read the source rather than calling it, because the properties that
 * matter here cannot fail a behavioural test — they fail silently. An admin page
 * with no nav entry still renders perfectly for anyone who types the URL; a
 * client-side flag that quietly became the gate still shows the right thing to
 * every honest caller. Both are only visible in the shape of the code.
 */

const SRC = join(process.cwd(), 'src');
const ADMIN_DIR = join(SRC, 'app', 'admin');

function adminRoutes(): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(ADMIN_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (existsSync(join(ADMIN_DIR, entry.name, 'page.tsx'))) {
      routes.push(`/admin/${entry.name}`);
    }
  }
  return routes;
}

describe('admin navigation', () => {
  it('links every admin page from the admin nav', () => {
    // Analytics, Users and System each shipped with no link from anywhere in the
    // app — reachable only by typing the URL. An admin page nobody can navigate
    // to is not a feature, and System is where the pipeline commands live.
    const layout = readFileSync(join(ADMIN_DIR, 'layout.tsx'), 'utf8');
    const missing = adminRoutes().filter((route) => !layout.includes(`'${route}'`));
    expect(missing, `admin pages with no nav entry: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('the profile admin link is not an access gate', () => {
  const action = readFileSync(join(SRC, 'lib', 'actions', 'admin-access.ts'), 'utf8');

  it('derives the tier from the verified session, not from an argument', () => {
    // A caller-supplied tier would let anyone name their own. The claims come
    // from withAuth(), and the exported action takes no parameters.
    expect(action).toContain('withAuth()');
    expect(action).toMatch(/export async function getMyAdminAccessAction\(\)/);
  });

  it('fails soft to no access', () => {
    // An unproven tier must hide the link, never show one that would 403.
    expect(action).toContain('return DENIED');
    expect(action).toMatch(/canAccessAdmin:\s*false/);
  });

  it('leaves /admin gated server-side, independently of this action', () => {
    // The two checks must stay independent: if the layout ever trusted this
    // action instead of re-deriving the tier, a patched client would become an
    // admin escalation.
    const layout = readFileSync(join(ADMIN_DIR, 'layout.tsx'), 'utf8');
    expect(layout).toContain('withAuth()');
    expect(layout).toContain('resolveTier');
    expect(layout).toContain('canAccessAdmin');
    expect(layout).not.toContain('admin-access');
    expect(layout).not.toContain('getMyAdminAccessAction');
  });
});

describe('the enrichment drain goes through the gateway, not a service secret', () => {
  const gateway = readFileSync(join(SRC, 'lib', 'admin', 'gateway.ts'), 'utf8');

  it('calls the role-gated admin route', () => {
    expect(gateway).toContain("'/api/admin/enrich/backlog'");
  });

  it('never reads a service token in the frontend', () => {
    // The whole point of the gateway route is that the service credential stays
    // on the Worker. Asserting on the bare names would only catch the prose that
    // explains them, so this pins what actually matters: the env READS. The only
    // one this module may perform is the gateway base URL — every credential it
    // needs travels as the caller's own WorkOS bearer token.
    const envReads = [...gateway.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    expect([...new Set(envReads)]).toEqual(['GATEWAY_API_URL']);
  });
});
