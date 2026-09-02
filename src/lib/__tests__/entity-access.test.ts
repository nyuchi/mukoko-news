import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * These tests are the enforcement of one decision: a membership of an
 * organization grants powers over THAT organization and never a platform tier.
 *
 * Most of them are therefore about refusal — what the capability model must not
 * hand out — plus two structural assertions that the two authorization systems
 * stay unwired from each other, which no behavioural test can catch.
 */

const mockWithAuth = vi.fn();
const mockGetPerson = vi.fn();
const mockGetMemberships = vi.fn();

vi.mock('@workos-inc/authkit-nextjs', () => ({
  withAuth: () => mockWithAuth(),
}));
vi.mock('@/lib/mongodb/identity', () => ({
  getPersonByWorkosId: (id: string) => mockGetPerson(id),
}));
vi.mock('@/lib/mongodb/entity', () => ({
  getActiveMemberships: (id: string) => mockGetMemberships(id),
}));

import {
  getMyEntityAccess,
  getEntityAccess,
  hasEntityCapability,
  requireEntityCapability,
  ForbiddenError,
} from '@/lib/auth/entity-access';

function membership(over: Record<string, unknown> = {}) {
  return {
    entityId: 'e1',
    entityName: 'The Herald',
    entityType: 'organization',
    role: 'member',
    title: null,
    entityPermissions: [],
    joinedAt: null,
    ...over,
  };
}

function signedIn() {
  mockWithAuth.mockResolvedValue({ user: { id: 'workos-user-1' } });
  mockGetPerson.mockResolvedValue({ personId: 'person-1' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('capability resolution', () => {
  it('gives a founder management and member control of their own entity', async () => {
    signedIn();
    mockGetMemberships.mockResolvedValue([membership({ role: 'founder' })]);
    const [access] = await getMyEntityAccess();
    expect(access.capabilities).toEqual(['entity:read', 'entity:manage', 'entity:members']);
  });

  it('gives a plain member read only', async () => {
    signedIn();
    mockGetMemberships.mockResolvedValue([membership({ role: 'member' })]);
    const [access] = await getMyEntityAccess();
    expect(access.capabilities).toEqual(['entity:read']);
  });

  it('grants nothing for an unrecognised role — the map is closed', async () => {
    signedIn();
    mockGetMemberships.mockResolvedValue([membership({ role: 'wizard' })]);
    await expect(getMyEntityAccess()).resolves.toEqual([]);
  });

  it('grants nothing when the role is missing entirely', async () => {
    signedIn();
    mockGetMemberships.mockResolvedValue([membership({ role: null })]);
    await expect(getMyEntityAccess()).resolves.toEqual([]);
  });

  it('matches the role case-insensitively', async () => {
    signedIn();
    mockGetMemberships.mockResolvedValue([membership({ role: 'FOUNDER' })]);
    const [access] = await getMyEntityAccess();
    expect(access.capabilities).toContain('entity:manage');
  });

  it('ignores permission slugs entirely — capabilities come from the role', async () => {
    // The live cluster carries `permissions: ["platform:admin"]` on an active
    // membership. Even if the reader's sanitiser were bypassed, the capability
    // model must not read the field at all.
    signedIn();
    mockGetMemberships.mockResolvedValue([
      membership({ role: 'member', entityPermissions: ['platform:admin', 'entity:manage'] }),
    ]);
    const [access] = await getMyEntityAccess();
    expect(access.capabilities).toEqual(['entity:read']);
  });

  it('does not treat a family entity as anything more than an entity', async () => {
    // Several active memberships on the live cluster are of `family` entities.
    // Founding your own household is not staff access — it is founder rights
    // over that household and nothing else.
    signedIn();
    mockGetMemberships.mockResolvedValue([
      membership({ entityId: 'fam-1', entityType: 'family', role: 'founder' }),
    ]);
    const [access] = await getMyEntityAccess();
    expect(access.entityType).toBe('family');
    expect(access.capabilities.every((c) => c.startsWith('entity:'))).toBe(true);
  });
});

describe('scoping to one entity', () => {
  it('answers only for the entity asked about', async () => {
    signedIn();
    mockGetMemberships.mockResolvedValue([membership({ entityId: 'e1', role: 'founder' })]);
    await expect(hasEntityCapability('e1', 'entity:manage')).resolves.toBe(true);
    await expect(hasEntityCapability('e2', 'entity:manage')).resolves.toBe(false);
    await expect(getEntityAccess('e2')).resolves.toBeNull();
  });

  it('does not leak one entity’s capabilities to another', async () => {
    signedIn();
    mockGetMemberships.mockResolvedValue([
      membership({ entityId: 'e1', role: 'founder' }),
      membership({ entityId: 'e2', role: 'member' }),
    ]);
    await expect(hasEntityCapability('e2', 'entity:manage')).resolves.toBe(false);
    await expect(hasEntityCapability('e2', 'entity:read')).resolves.toBe(true);
  });
});

describe('requireEntityCapability', () => {
  it('returns the access record when the capability is held', async () => {
    signedIn();
    mockGetMemberships.mockResolvedValue([membership({ role: 'admin' })]);
    await expect(requireEntityCapability('e1', 'entity:manage')).resolves.toMatchObject({
      entityId: 'e1',
    });
  });

  it('throws ForbiddenError for a capability the role does not carry', async () => {
    signedIn();
    mockGetMemberships.mockResolvedValue([membership({ role: 'member' })]);
    await expect(requireEntityCapability('e1', 'entity:manage')).rejects.toBeInstanceOf(
      ForbiddenError
    );
  });

  it('throws for an entity the caller does not belong to', async () => {
    signedIn();
    mockGetMemberships.mockResolvedValue([membership({ entityId: 'e1', role: 'founder' })]);
    await expect(requireEntityCapability('e2', 'entity:read')).rejects.toBeInstanceOf(
      ForbiddenError
    );
  });
});

describe('denies rather than degrades', () => {
  it('grants nothing to a signed-out caller and does not query', async () => {
    mockWithAuth.mockResolvedValue({ user: null });
    await expect(getMyEntityAccess()).resolves.toEqual([]);
    expect(mockGetMemberships).not.toHaveBeenCalled();
  });

  it('grants nothing when the person record cannot be resolved', async () => {
    mockWithAuth.mockResolvedValue({ user: { id: 'workos-user-1' } });
    mockGetPerson.mockResolvedValue({ personId: null });
    await expect(getMyEntityAccess()).resolves.toEqual([]);
    expect(mockGetMemberships).not.toHaveBeenCalled();
  });

  it('denies on a failed membership read — empty means unproven, not permitted', async () => {
    // getActiveMemberships is fail-soft and returns [] on a dead cluster. Every
    // decision grants on presence, so a degraded read closes access.
    signedIn();
    mockGetMemberships.mockResolvedValue([]);
    await expect(hasEntityCapability('e1', 'entity:read')).resolves.toBe(false);
    await expect(requireEntityCapability('e1', 'entity:read')).rejects.toBeInstanceOf(
      ForbiddenError
    );
  });
});

describe('the two authorization systems stay unwired', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8');

  it('the platform tier resolver reads no database', () => {
    // roles.ts must answer from the verified WorkOS token alone. The moment it
    // imports a Mongo read, a row someone else writes becomes an admin grant.
    const roles = src('lib/auth/roles.ts');
    expect(roles).not.toMatch(/from '@?\.*\/?.*mongodb/);
    expect(roles).not.toMatch(/entity-access/);
  });

  it('the admin gate takes no input from memberships', () => {
    const layout = src('app/admin/layout.tsx');
    expect(layout).not.toMatch(/mongodb\/entity/);
    expect(layout).not.toMatch(/entity-access/);
  });

  it('the entity capability model never produces a platform tier', () => {
    const access = src('lib/auth/entity-access.ts');
    expect(access).not.toMatch(/from '@\/lib\/auth\/roles'/);
    // Every capability the model can hand out is namespaced to an entity.
    const declared = access.match(/^\s+\| '([^']+)'$/gm) ?? [];
    expect(declared.length).toBeGreaterThan(0);
    for (const line of declared) {
      expect(line).toMatch(/'entity:/);
    }
  });
});
