/**
 * Tests for OIDC Authentication Middleware
 * Tests token validation, role-based access control, and minor restrictions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Setup mocks before importing the middleware
const mockValidateToken = vi.fn();
const mockHasRole = vi.fn();
const mockIsMinor = vi.fn();

// Mock OIDCAuthService with static method
vi.mock('../../services/OIDCAuthService.js', () => {
  const MockOIDCAuthService = vi.fn().mockImplementation(() => ({
    validateToken: mockValidateToken,
    hasRole: mockHasRole,
    isMinor: mockIsMinor,
  }));

  // Add static method
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (MockOIDCAuthService as any).extractBearerToken = (authHeader: string | null): string | null => {
    if (!authHeader) return null;
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
    return parts[1];
  };

  return { OIDCAuthService: MockOIDCAuthService };
});

// Import after mocks are set up
import { oidcAuth, requireAuth, requireAdmin, requireSuperAdmin, getCurrentUser, getCurrentUserId, isAuthenticated } from '../oidcAuth';

// Mock Hono context
const createMockContext = (options: {
  authHeader?: string | null;
} = {}) => {
  const { authHeader = null } = options;
  const variables: Record<string, any> = {};

  return {
    req: {
      header: vi.fn((name: string) => {
        if (name === 'Authorization') return authHeader;
        return null;
      }),
    },
    env: {
      CACHE_STORAGE: {},
      AUTH_ISSUER_URL: 'https://id.mukoko.com',
    },
    json: vi.fn((body: any, status?: number) => ({ body, status })),
    set: vi.fn((key: string, value: any) => {
      variables[key] = value;
    }),
    get: vi.fn((key: string) => variables[key]),
  };
};

const createMockNext = () => vi.fn().mockResolvedValue('next-called');

describe('oidcAuth Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations
    mockValidateToken.mockReset();
    mockHasRole.mockReset();
    mockIsMinor.mockReset();
  });

  describe('Token Extraction', () => {
    it('should initialize context variables', async () => {
      const c = createMockContext({ authHeader: null });
      const next = createMockNext();
      const middleware = oidcAuth({ required: false });

      await middleware(c as any, next);

      expect(c.set).toHaveBeenCalledWith('user', null);
      expect(c.set).toHaveBeenCalledWith('userId', null);
      expect(c.set).toHaveBeenCalledWith('isAuthenticated', false);
    });

    it('should return 401 when token missing and required', async () => {
      const c = createMockContext({ authHeader: null });
      const next = createMockNext();
      const middleware = oidcAuth({ required: true });

      await middleware(c as any, next);

      expect(c.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Authentication required',
          code: 'UNAUTHORIZED',
        }),
        401
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should continue without token when not required', async () => {
      const c = createMockContext({ authHeader: null });
      const next = createMockNext();
      const middleware = oidcAuth({ required: false });

      await middleware(c as any, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('Token Validation', () => {
    it('should return 401 for invalid token when required', async () => {
      mockValidateToken.mockResolvedValue({
        valid: false,
        error: 'Token expired',
      });

      const c = createMockContext({ authHeader: 'Bearer invalid-token' });
      const next = createMockNext();
      const middleware = oidcAuth({ required: true });

      await middleware(c as any, next);

      expect(c.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Token expired',
          code: 'INVALID_TOKEN',
        }),
        401
      );
    });

    it('should set user context for valid token', async () => {
      const mockClaims = {
        sub: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        role: 'user',
      };

      mockValidateToken.mockResolvedValue({
        valid: true,
        claims: mockClaims,
      });
      mockHasRole.mockReturnValue(true);
      mockIsMinor.mockReturnValue(false);

      const c = createMockContext({ authHeader: 'Bearer valid-token' });
      const next = createMockNext();
      const middleware = oidcAuth({ required: true });

      await middleware(c as any, next);

      expect(c.set).toHaveBeenCalledWith('user', mockClaims);
      expect(c.set).toHaveBeenCalledWith('userId', 'user-123');
      expect(c.set).toHaveBeenCalledWith('isAuthenticated', true);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('Role-Based Access Control', () => {
    it('should return 403 when user lacks required role', async () => {
      const mockClaims = {
        sub: 'user-123',
        role: 'user',
      };

      mockValidateToken.mockResolvedValue({
        valid: true,
        claims: mockClaims,
      });
      mockHasRole.mockReturnValue(false); // User doesn't have required role
      mockIsMinor.mockReturnValue(false);

      const c = createMockContext({ authHeader: 'Bearer valid-token' });
      const next = createMockNext();
      const middleware = oidcAuth({ required: true, roles: ['admin'] });

      await middleware(c as any, next);

      expect(c.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Insufficient permissions',
          code: 'FORBIDDEN',
          requiredRoles: ['admin'],
        }),
        403
      );
    });

    it('should allow access when user has required role', async () => {
      const mockClaims = {
        sub: 'admin-123',
        role: 'admin',
      };

      mockValidateToken.mockResolvedValue({
        valid: true,
        claims: mockClaims,
      });
      mockHasRole.mockReturnValue(true); // User has admin role
      mockIsMinor.mockReturnValue(false);

      const c = createMockContext({ authHeader: 'Bearer admin-token' });
      const next = createMockNext();
      const middleware = oidcAuth({ required: true, roles: ['admin'] });

      await middleware(c as any, next);

      expect(next).toHaveBeenCalled();
      expect(c.json).not.toHaveBeenCalled();
    });
  });

  describe('Minor Blocking', () => {
    it('should block minors when blockMinors is true', async () => {
      const mockClaims = {
        sub: 'minor-123',
        isMinor: true,
      };

      mockValidateToken.mockResolvedValue({
        valid: true,
        claims: mockClaims,
      });
      mockHasRole.mockReturnValue(true);
      mockIsMinor.mockReturnValue(true); // User is a minor

      const c = createMockContext({ authHeader: 'Bearer minor-token' });
      const next = createMockNext();
      const middleware = oidcAuth({ required: true, blockMinors: true });

      await middleware(c as any, next);

      expect(c.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'This feature is not available for users under 18',
          code: 'MINOR_RESTRICTED',
        }),
        403
      );
    });

    it('should allow minors when blockMinors is false', async () => {
      const mockClaims = {
        sub: 'minor-123',
        isMinor: true,
      };

      mockValidateToken.mockResolvedValue({
        valid: true,
        claims: mockClaims,
      });
      mockHasRole.mockReturnValue(true);
      mockIsMinor.mockReturnValue(true);

      const c = createMockContext({ authHeader: 'Bearer minor-token' });
      const next = createMockNext();
      const middleware = oidcAuth({ required: true, blockMinors: false });

      await middleware(c as any, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('Helper Functions', () => {
    describe('requireAuth', () => {
      it('should return middleware with required: true', async () => {
        const c = createMockContext({ authHeader: null });
        const next = createMockNext();
        const middleware = requireAuth();

        await middleware(c as any, next);

        expect(c.json).toHaveBeenCalledWith(
          expect.objectContaining({ code: 'UNAUTHORIZED' }),
          401
        );
      });
    });

    describe('requireAdmin', () => {
      it('should require admin, super_admin, or moderator roles', async () => {
        const mockClaims = { sub: 'user-123', role: 'user' };

        mockValidateToken.mockResolvedValue({
          valid: true,
          claims: mockClaims,
        });
        mockHasRole.mockReturnValue(false);
        mockIsMinor.mockReturnValue(false);

        const c = createMockContext({ authHeader: 'Bearer user-token' });
        const next = createMockNext();
        const middleware = requireAdmin();

        await middleware(c as any, next);

        expect(c.json).toHaveBeenCalledWith(
          expect.objectContaining({
            code: 'FORBIDDEN',
            requiredRoles: ['admin', 'super_admin', 'moderator'],
          }),
          403
        );
      });
    });

    describe('requireSuperAdmin', () => {
      it('should only allow super_admin role', async () => {
        const mockClaims = { sub: 'admin-123', role: 'admin' };

        mockValidateToken.mockResolvedValue({
          valid: true,
          claims: mockClaims,
        });
        mockHasRole.mockReturnValue(false); // admin doesn't have super_admin
        mockIsMinor.mockReturnValue(false);

        const c = createMockContext({ authHeader: 'Bearer admin-token' });
        const next = createMockNext();
        const middleware = requireSuperAdmin();

        await middleware(c as any, next);

        expect(c.json).toHaveBeenCalledWith(
          expect.objectContaining({
            code: 'FORBIDDEN',
            requiredRoles: ['super_admin'],
          }),
          403
        );
      });
    });
  });

  describe('Context Helper Functions', () => {
    describe('getCurrentUser', () => {
      it('should return user from context', () => {
        const mockUser = { sub: 'user-123', name: 'Test User' };
        const c = createMockContext();
        c.get = vi.fn().mockReturnValue(mockUser);

        const result = getCurrentUser(c as any);

        expect(result).toEqual(mockUser);
        expect(c.get).toHaveBeenCalledWith('user');
      });

      it('should return null when no user', () => {
        const c = createMockContext();
        c.get = vi.fn().mockReturnValue(null);

        const result = getCurrentUser(c as any);

        expect(result).toBeNull();
      });
    });

    describe('getCurrentUserId', () => {
      it('should return userId from context', () => {
        const c = createMockContext();
        c.get = vi.fn().mockReturnValue('user-123');

        const result = getCurrentUserId(c as any);

        expect(result).toBe('user-123');
        expect(c.get).toHaveBeenCalledWith('userId');
      });
    });

    describe('isAuthenticated', () => {
      it('should return true when authenticated', () => {
        const c = createMockContext();
        c.get = vi.fn().mockReturnValue(true);

        const result = isAuthenticated(c as any);

        expect(result).toBe(true);
        expect(c.get).toHaveBeenCalledWith('isAuthenticated');
      });

      it('should return false when not authenticated', () => {
        const c = createMockContext();
        c.get = vi.fn().mockReturnValue(false);

        const result = isAuthenticated(c as any);

        expect(result).toBe(false);
      });
    });
  });
});
