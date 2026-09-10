import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithAuth = vi.fn();
vi.mock('@workos-inc/authkit-nextjs', () => ({
  withAuth: () => mockWithAuth(),
}));

const mockGetProvenance = vi.fn();
vi.mock('@/lib/mongodb/article-metrics', () => ({
  getArticleProvenance: (...args: unknown[]) => mockGetProvenance(...args),
}));

import { getArticleProvenanceAction } from '@/lib/actions/article-metrics';

const PLATFORM_ORG = 'org_platform_team';
const PROVENANCE = { enriched: true, qualityScore: 0.85 };

/**
 * Unlike `getMyAdminAccessAction`, nothing downstream re-checks this action —
 * it returns the data itself, so it IS the gate. Every one of these cases is a
 * caller who must see nothing.
 */
describe('article provenance is staff-only', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WORKOS_PLATFORM_ORG_ID = PLATFORM_ORG;
    mockGetProvenance.mockResolvedValue(PROVENANCE);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('refuses an anonymous caller', async () => {
    mockWithAuth.mockResolvedValue({ user: null });
    expect(await getArticleProvenanceAction('article-1')).toBeNull();
    expect(mockGetProvenance).not.toHaveBeenCalled();
  });

  it('refuses a signed-in reader outside the platform-team org', async () => {
    mockWithAuth.mockResolvedValue({
      user: { id: 'user_reader' },
      organizationId: 'org_someone_else',
      role: 'admin',
      permissions: ['mukoko:news-moderator'],
    });
    expect(await getArticleProvenanceAction('article-1')).toBeNull();
    expect(mockGetProvenance).not.toHaveBeenCalled();
  });

  it('refuses a signed-in user with no organisation at all', async () => {
    mockWithAuth.mockResolvedValue({ user: { id: 'user_reader' } });
    expect(await getArticleProvenanceAction('article-1')).toBeNull();
  });

  it('serves a platform-team moderator', async () => {
    mockWithAuth.mockResolvedValue({
      user: { id: 'user_mod' },
      organizationId: PLATFORM_ORG,
      role: 'moderator',
    });
    expect(await getArticleProvenanceAction('article-1')).toEqual(PROVENANCE);
    expect(mockGetProvenance).toHaveBeenCalledWith('article-1');
  });

  it('serves platform-team staff', async () => {
    mockWithAuth.mockResolvedValue({
      user: { id: 'user_staff' },
      organizationId: PLATFORM_ORG,
    });
    expect(await getArticleProvenanceAction('article-1')).toEqual(PROVENANCE);
  });

  it('fails closed when the session cannot be read', async () => {
    mockWithAuth.mockRejectedValue(new Error('authkit unavailable'));
    expect(await getArticleProvenanceAction('article-1')).toBeNull();
    expect(mockGetProvenance).not.toHaveBeenCalled();
  });

  it('validates the caller-supplied id before it reaches a query', async () => {
    mockWithAuth.mockResolvedValue({ user: { id: 'u' }, organizationId: PLATFORM_ORG });
    expect(await getArticleProvenanceAction('')).toBeNull();
    expect(await getArticleProvenanceAction('x'.repeat(200))).toBeNull();
    expect(mockGetProvenance).not.toHaveBeenCalled();
  });

  it('reports a failed read as no data, not as an empty provenance', async () => {
    // An empty provenance object would render as a set of confident absences.
    mockWithAuth.mockResolvedValue({ user: { id: 'u' }, organizationId: PLATFORM_ORG });
    mockGetProvenance.mockRejectedValue(new Error('atlas unreachable'));
    expect(await getArticleProvenanceAction('article-1')).toBeNull();
  });
});
