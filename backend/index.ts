import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

// Import all business logic services - backend does the heavy lifting
import { D1Service } from "../database/D1Service.js";
import { D1CacheService } from "./services/D1CacheService.js";
import { AnalyticsEngineService } from "./services/AnalyticsEngineService.js";
import { ArticleService } from "./services/ArticleService.js";
import { ProcessingClient } from "./services/ProcessingClient.js";
import { AuthorProfileService } from "./services/AuthorProfileService.js";
import { NewsSourceManager } from "./services/NewsSourceManager.js";
// SimpleRSSService removed — RSS collection delegated to Python Worker via ProcessingClient
// AISearchService removed — search delegated to Python Worker via ProcessingClient
// Security services
import { RateLimitService } from "./services/RateLimitService.js";
import { CSRFService } from "./services/CSRFService.js";
// OIDC Auth - using id.mukoko.com for authentication
import { oidcAuth, requireAuth, requireAdmin as requireAdminRole, getCurrentUser, getCurrentUserId, isAuthenticated } from "./middleware/oidcAuth.js";
// API Key Auth - for frontend (Vercel) to backend authentication
import { apiAuth, requireApiKey } from "./middleware/apiAuth.js";
// Additional enhancement services
import { CategoryManager } from "./services/CategoryManager.js";
import { ObservabilityService } from "./services/ObservabilityService.js";
import { D1UserService } from "./services/D1UserService.js";
import { PersonalizedFeedService } from "./services/PersonalizedFeedService.js";
import { CountryService } from "./services/CountryService.js";
import { SourceHealthService } from "./services/SourceHealthService.js";
// Durable Objects for real-time features
import { RealtimeAnalyticsDO } from "./services/RealtimeAnalyticsDO.js";
import { ArticleInteractionsDO } from "./services/ArticleInteractionsDO.js";
import { UserBehaviorDO } from "./services/UserBehaviorDO.js";
import { RealtimeCountersDO } from "./services/RealtimeCountersDO.js";
// Unified Auth Provider Service (Single Auth Wrapper with RBAC)
import { AuthProviderService, UserRole } from "./services/AuthProviderService.js";
// Story clustering for feed sections
import { normalizeTitle, titleSimilarity, clusterArticles, STOP_WORDS } from "./services/StoryClusteringService.js";

// Import admin interface
import { getAdminHTML, getLoginHTML } from "./admin/index.js";

// Types for Cloudflare bindings
type Bindings = {
  DB: D1Database;
  AUTH_STORAGE: KVNamespace;
  CACHE_STORAGE: KVNamespace;
  ARTICLE_INTERACTIONS: DurableObjectNamespace;
  USER_BEHAVIOR: DurableObjectNamespace;
  REALTIME_COUNTERS: DurableObjectNamespace;
  REALTIME_ANALYTICS: DurableObjectNamespace;
  NEWS_INTERACTIONS: AnalyticsEngineDataset;
  NEWS_ANALYTICS: AnalyticsEngineDataset;
  SEARCH_ANALYTICS: AnalyticsEngineDataset;
  CATEGORY_ANALYTICS: AnalyticsEngineDataset;
  USER_ANALYTICS: AnalyticsEngineDataset;
  PERFORMANCE_ANALYTICS: AnalyticsEngineDataset;
  AI_INSIGHTS_ANALYTICS: AnalyticsEngineDataset;
  AI: Ai;
  IMAGES?: ImagesBinding;
  STORAGE?: R2Bucket; // R2 object storage for feeds, backups, uploads
  NODE_ENV: string;
  LOG_LEVEL: string;
  ROLES_ENABLED: string;
  DEFAULT_ROLE: string;
  ADMIN_ROLES: string;
  CREATOR_ROLES: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  ADMIN_SESSION_SECRET: string; // Set via wrangler secret
  API_SECRET?: string; // Set via wrangler secret - bearer token for frontend API authentication
  AI_INSIGHTS_ENABLED: string;
  AI_SEARCH_ENABLED: string;
  AUTH_ISSUER_URL: string; // OIDC issuer URL (id.mukoko.com)
  RESEND_API_KEY?: string; // Set via wrangler secret for email
  EMAIL_FROM?: string; // Default sender email address
  DATA_PROCESSOR: Fetcher; // Service Binding to mukoko-news-api Python Worker
};

// Export Durable Object classes for Cloudflare
export { RealtimeAnalyticsDO, ArticleInteractionsDO, UserBehaviorDO, RealtimeCountersDO };

const app = new Hono<{ Bindings: Bindings }>();

// Add CORS middleware - allow credentials from frontend
app.use("*", cors({
  origin: [
    'https://news.mukoko.com',
    'https://mukoko-news.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8081',
    'http://localhost:19006',
  ],
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  exposeHeaders: ['Set-Cookie'],
}));
app.use("*", logger());

// Protect all /api/* routes with API key (except /health and /api/admin/*)
// Public API requires bearer token from authorized clients (Vercel frontend)
app.use("/api/*", async (c, next) => {
  // Bypass API key auth for health check and admin routes (admin has its own auth)
  const bypassPaths = [
    '/api/health',
  ];

  // Check if this is an admin route or bypass path
  if (c.req.path.startsWith('/api/admin/') || bypassPaths.includes(c.req.path)) {
    return await next();
  }

  // Require API key for all other /api/* routes (including /api/auth/*)
  // Auth routes are called by trusted clients (Vercel, Expo) that have the API_SECRET
  return await requireApiKey()(c, next);
});

// Protect all admin API routes (except login and backfill)
app.use("/api/admin/*", async (c, next) => {
  // Only login bypasses admin auth (requires session cookie validation internally)
  const bypassPaths = [
    '/api/admin/login',
  ];

  if (bypassPaths.includes(c.req.path)) {
    return await next();
  }

  // All other admin routes require authentication
  return await requireAdmin(c, next);
});

// Initialize all business services
function initializeServices(env: Bindings) {
  const d1Service = new D1Service(env.DB);
  const cacheService = new D1CacheService(env.DB);
  const analyticsService = new AnalyticsEngineService({
    NEWS_ANALYTICS: env.NEWS_ANALYTICS,
    SEARCH_ANALYTICS: env.SEARCH_ANALYTICS,
    CATEGORY_ANALYTICS: env.CATEGORY_ANALYTICS,
    USER_ANALYTICS: env.USER_ANALYTICS,
    PERFORMANCE_ANALYTICS: env.PERFORMANCE_ANALYTICS
  });
  const authorProfileService = new AuthorProfileService(d1Service);
  const articleService = new ArticleService(env.DB);
  const newsSourceManager = new NewsSourceManager(env.DB);

  // Initialize Security Services
  const rateLimitService = new RateLimitService(env.CACHE_STORAGE);
  const csrfService = new CSRFService(env.CACHE_STORAGE);

  const categoryManager = new CategoryManager(env.DB);
  const observabilityService = new ObservabilityService(env.DB, env.LOG_LEVEL || 'info');
  const userService = new D1UserService(env.DB);

  // Initialize SourceHealthService for D1-based health reads (fallback for admin)
  // RSS collection + health recording delegated to Python Worker
  const sourceHealthService = new SourceHealthService(env.DB);

  // Initialize ProcessingClient — delegates data processing to Python Worker via Service Binding
  const processingClient = new ProcessingClient(env.DATA_PROCESSOR);

  console.log('[INIT] All services initialized - processing delegated to Python Worker via Service Binding');

  return {
    d1Service,
    cacheService,
    analyticsService,
    authorProfileService,
    articleService,
    newsSourceManager,
    categoryManager,
    observabilityService,
    userService,
    rateLimitService,
    csrfService,
    sourceHealthService,
    processingClient
  };
}

// Session-based authentication using environment secret
// ADMIN_SESSION_SECRET must be set via: wrangler secret put ADMIN_SESSION_SECRET

// Helper function to get session secret from environment
function getSessionSecret(env: Bindings): string {
  const secret = env.ADMIN_SESSION_SECRET;
  if (!secret) {
    console.error('[AUTH] ADMIN_SESSION_SECRET not configured! Set via: wrangler secret put ADMIN_SESSION_SECRET');
    throw new Error('Server configuration error: missing session secret');
  }
  return secret;
}

// Legacy password functions removed - authentication now handled by OIDC (id.mukoko.com)

// Helper function to create session token
async function createSessionToken(email: string, env: Bindings): Promise<string> {
  const secret = getSessionSecret(env);
  const timestamp = Date.now();
  const data = `${email}:${timestamp}:${secret}`;
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Helper function to get cookie value
function getCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(c => c.trim());
  const cookie = cookies.find(c => c.startsWith(`${name}=`));
  return cookie ? cookie.substring(name.length + 1) : null;
}

// Authentication middleware - protect admin routes
// Uses AuthProviderService with RBAC - Admin auth is ALWAYS required (locked)
const requireAdmin = async (c: any, next: any) => {
  const cookieHeader = c.req.header('cookie');
  const sessionToken = getCookie(cookieHeader, 'auth_token') ||
                       c.req.header('authorization')?.replace('Bearer ', '') ||
                       c.req.header('x-session-token');
  const isApiRequest = c.req.path.startsWith('/api/');

  // Use AuthProviderService for admin access validation
  try {
    const authService = new AuthProviderService({ DB: c.env.DB, AUTH_STORAGE: c.env.AUTH_STORAGE as any });
    const result = await authService.validateAdminAccess(sessionToken);

    if (!result.allowed) {
      console.log('[AUTH] Admin access denied:', result.reason);
      if (isApiRequest) {
        const status = !sessionToken ? 401 : 403;
        return c.json({ error: result.reason || 'Admin access required' }, status);
      }
      return c.redirect('https://news.mukoko.com/auth/login', 302);
    }

    // Session valid and user is admin, continue
    c.set('user', {
      userId: result.user!.id,
      email: result.user!.email,
      username: result.user!.username,
      role: result.user!.role
    });
    await next();
  } catch (error) {
    console.error('[AUTH] Admin validation error:', error);
    if (isApiRequest) {
      return c.json({ error: 'Authentication error' }, 401);
    }
    return c.redirect('https://news.mukoko.com/auth/login', 302);
  }
};

// RBAC Middleware for role-based access
// Use for routes that need specific role levels but may not require admin
const requireRole = (requiredRole: 'admin' | 'moderator' | 'support' | 'author' | 'user') => {
  return async (c: any, next: any) => {
    const cookieHeader = c.req.header('cookie');
    const sessionToken = getCookie(cookieHeader, 'auth_token') ||
                         c.req.header('authorization')?.replace('Bearer ', '') ||
                         c.req.header('x-session-token');
    const isApiRequest = c.req.path.startsWith('/api/');

    try {
      const authService = new AuthProviderService({ DB: c.env.DB, AUTH_STORAGE: c.env.AUTH_STORAGE as any });
      const result = await authService.validateAccess(sessionToken, requiredRole);

      if (!result.allowed) {
        console.log(`[AUTH] ${requiredRole} access denied:`, result.reason);
        if (isApiRequest) {
          const status = !sessionToken ? 401 : 403;
          return c.json({ error: result.reason || `${requiredRole} access required` }, status);
        }
        return c.redirect('https://news.mukoko.com/auth/login', 302);
      }

      // Set user context if available
      if (result.user) {
        c.set('user', {
          userId: result.user.id,
          email: result.user.email,
          username: result.user.username,
          role: result.user.role
        });
      }
      await next();
    } catch (error) {
      console.error(`[AUTH] ${requiredRole} validation error:`, error);
      if (isApiRequest) {
        return c.json({ error: 'Authentication error' }, 401);
      }
      return c.redirect('https://news.mukoko.com/auth/login', 302);
    }
  };
};

// Optional auth middleware - doesn't require auth but sets user context if available
const optionalAuth = async (c: any, next: any) => {
  const cookieHeader = c.req.header('cookie');
  const sessionToken = getCookie(cookieHeader, 'auth_token') ||
                       c.req.header('authorization')?.replace('Bearer ', '') ||
                       c.req.header('x-session-token');

  if (sessionToken) {
    try {
      const authService = new AuthProviderService({ DB: c.env.DB, AUTH_STORAGE: c.env.AUTH_STORAGE as any });
      const user = await authService.getUserFromHeaders(c.req.raw.headers);
      if (user) {
        c.set('user', {
          userId: user.id,
          email: user.email,
          username: user.username,
          role: user.role
        });
      }
    } catch (error) {
      // Ignore errors - auth is optional
      console.log('[AUTH] Optional auth failed:', error);
    }
  }
  await next();
};

// Login page - redirect to frontend
app.get("/login", (c) => {
  return c.redirect("https://news.mukoko.com/auth/login", 302);
});

// Admin login - validates OIDC session and checks admin role
// The actual authentication happens via OIDC (/api/auth/oidc/callback)
// This endpoint validates the existing session has admin privileges
app.post("/api/admin/login", async (c) => {
  try {
    // Rate limit login attempts by IP
    if (c.env.AUTH_STORAGE) {
      const rateLimiter = new RateLimitService(c.env.AUTH_STORAGE);
      const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
      const rateCheck = await rateLimiter.checkRateLimit(`login:${clientIp}`, RateLimitService.getLoginConfig());
      if (!rateCheck.allowed) {
        return c.json({
          error: 'Too many login attempts. Please try again later.',
          retryAfter: rateCheck.retryAfter,
        }, 429);
      }
    }

    // Check for existing session token
    const cookieHeader = c.req.header('cookie');
    const sessionToken = getCookie(cookieHeader, 'auth_token');

    if (!sessionToken) {
      // Return OIDC login URL for redirect
      const issuerUrl = c.env.AUTH_ISSUER_URL || 'https://id.mukoko.com';
      return c.json({
        error: "No session found",
        oidc_url: `${issuerUrl}/oauth/authorize`,
        requires_auth: true
      }, 401);
    }

    // Validate session
    const authService = new AuthProviderService({
      DB: c.env.DB,
      AUTH_STORAGE: c.env.AUTH_STORAGE as any
    });

    const session = await authService.validateSession(sessionToken);
    if (!session) {
      return c.json({
        error: "Invalid or expired session",
        requires_auth: true
      }, 401);
    }

    // Check if user has admin role
    const adminRoles = c.env.ADMIN_ROLES?.split(',') || ['admin'];
    if (!adminRoles.includes(session.role)) {
      console.log('[AUTH] Admin login denied - user lacks admin role:', {
        email: session.email,
        role: session.role,
        requiredRoles: adminRoles
      });
      return c.json({ error: "Insufficient permissions - admin access required" }, 403);
    }

    // Get full user data
    const user = await authService.getUserById(session.user_id);
    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    console.log('[AUTH] Admin session validated:', { email: session.email, role: session.role });

    return c.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        username: user.username,
        role: user.role,
        picture: user.picture
      }
    });
  } catch (error: any) {
    console.error('[AUTH] Admin login error:', error);
    return c.json({ error: "Login failed" }, 500);
  }
});

// Logout API endpoint
app.post("/api/admin/logout", async (c) => {
  const cookieHeader = c.req.header('cookie');
  const sessionToken = getCookie(cookieHeader, 'auth_token'); // Changed from admin_session

  if (sessionToken) {
    // Delete session from shared KV
    await c.env.AUTH_STORAGE.delete(`session:${sessionToken}`);
  }

  return c.json({ success: true });
});

// =============================================================================
// AUTH SETTINGS API - Manage role-based authentication requirements
// =============================================================================

// Get current auth settings for all roles
app.get("/api/admin/auth-settings", async (c) => {
  try {
    const authService = new AuthProviderService({
      DB: c.env.DB,
      AUTH_STORAGE: c.env.AUTH_STORAGE as any
    });

    const settings = await authService.getAuthSettings();
    const history = await authService.getAuthSettingsHistory(10);

    return c.json({
      success: true,
      settings,
      recent_changes: history,
      note: "Admin authentication is locked and cannot be disabled"
    });
  } catch (error) {
    console.error('[AUTH-SETTINGS] Error fetching settings:', error);
    return c.json({ error: "Failed to fetch auth settings" }, 500);
  }
});

// Update auth setting for a specific role
app.put("/api/admin/auth-settings/:role", async (c) => {
  try {
    const role = c.req.param('role') as UserRole;
    const validRoles = ['admin', 'moderator', 'support', 'author', 'user'];

    if (!validRoles.includes(role)) {
      return c.json({ error: "Invalid role" }, 400);
    }

    const body = await c.req.json();
    const { auth_required, reason } = body;

    if (typeof auth_required !== 'boolean') {
      return c.json({ error: "auth_required must be a boolean" }, 400);
    }

    // Get admin user from session
    const cookieHeader = c.req.header('cookie');
    const sessionToken = getCookie(cookieHeader, 'auth_token');

    if (!sessionToken) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const authService = new AuthProviderService({
      DB: c.env.DB,
      AUTH_STORAGE: c.env.AUTH_STORAGE as any
    });

    const session = await authService.validateSession(sessionToken);
    if (!session || session.role !== 'admin') {
      return c.json({ error: "Admin access required" }, 403);
    }

    const result = await authService.updateAuthSetting(
      role,
      auth_required,
      session.user_id,
      reason
    );

    if (!result.success) {
      return c.json({ error: result.error }, 400);
    }

    // Fetch updated settings
    const settings = await authService.getAuthSettings();

    return c.json({
      success: true,
      message: `Auth setting for ${role} updated to ${auth_required ? 'enabled' : 'disabled'}`,
      settings
    });
  } catch (error) {
    console.error('[AUTH-SETTINGS] Error updating setting:', error);
    return c.json({ error: "Failed to update auth setting" }, 500);
  }
});

// Get auth settings change history
app.get("/api/admin/auth-settings/history", async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '50');

    const authService = new AuthProviderService({
      DB: c.env.DB,
      AUTH_STORAGE: c.env.AUTH_STORAGE as any
    });

    const history = await authService.getAuthSettingsHistory(limit);

    return c.json({
      success: true,
      history
    });
  } catch (error) {
    console.error('[AUTH-SETTINGS] Error fetching history:', error);
    return c.json({ error: "Failed to fetch auth settings history" }, 500);
  }
});

// User management redirects - all redirect to frontend
app.get("/register", (c) => {
  return c.redirect("https://news.mukoko.com/auth/register", 302);
});

app.get("/onboarding", (c) => {
  return c.redirect("https://news.mukoko.com/onboarding", 302);
});

app.get("/profile", (c) => {
  return c.redirect("https://news.mukoko.com/settings/profile", 302);
});

app.get("/settings/*", (c) => {
  return c.redirect("https://news.mukoko.com/settings/profile", 302);
});

// API Documentation - PUBLIC (no auth required)
app.get("/", (c) => {
  c.header("Content-Type", "text/html");
  return c.html(getAdminHTML());
});

app.get("/admin", (c) => {
  c.header("Content-Type", "text/html");
  return c.html(getAdminHTML());
});

// Health check endpoint with full service health
app.get("/api/health", async (c) => {
  try {
    const services = initializeServices(c.env);
    const health = await services.d1Service.healthCheck();

    // Check Python Worker (processing API) health
    let processingStatus = "unknown";
    try {
      const processingClient = new ProcessingClient(c.env.DATA_PROCESSOR);
      const pyHealth = await processingClient._healthCheck();
      processingStatus = pyHealth ? "operational" : "error";
    } catch {
      processingStatus = "error";
    }

    const allHealthy = health.healthy && processingStatus === "operational";

    return c.json({
      status: allHealthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      services: {
        database: health.healthy ? "operational" : "error",
        processing_api: processingStatus,
        analytics: !!(c.env.NEWS_ANALYTICS && c.env.SEARCH_ANALYTICS && c.env.CATEGORY_ANALYTICS),
        cache: "operational",
      },
      environment: c.env.NODE_ENV || "production",
      security: {
        apiAuthEnabled: !!c.env.API_SECRET,
        authMethods: [
          "Bearer token (API_SECRET) for frontend-to-backend auth",
          "Bearer token (OIDC JWT) for user authentication"
        ],
        protectedRoutes: "/api/* (except /api/health)",
        publicRoutes: "/api/health, /api/admin/* (separate admin auth)"
      }
    });
  } catch (error: any) {
    return c.json({
      status: "unhealthy",
      error: "Health check failed",
      timestamp: new Date().toISOString()
    }, 500);
  }
});

/**
 * Error tracking endpoint for frontend error boundary reports
 * Receives error reports from React error boundaries and logs them
 * Rate limited to prevent abuse (10 reports per minute per IP)
 */
app.post("/api/errors", async (c) => {
  try {
    // Simple rate limiting using KV (10 errors per minute per IP)
    const clientIP = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
    const rateLimitKey = `error_ratelimit:${clientIP}`;
    const MAX_ERRORS_PER_MINUTE = 10;

    if (c.env.CACHE_STORAGE) {
      const currentCount = await c.env.CACHE_STORAGE.get(rateLimitKey);
      const count = currentCount ? parseInt(currentCount, 10) : 0;

      if (count >= MAX_ERRORS_PER_MINUTE) {
        return c.json(
          { error: "Too many error reports. Please try again later." },
          429
        );
      }

      // Increment counter with 60 second TTL
      await c.env.CACHE_STORAGE.put(rateLimitKey, String(count + 1), {
        expirationTtl: 60,
      });
    }

    const body = await c.req.json();

    // Validate required fields
    const { error, stack, componentStack, url, userAgent, timestamp } = body;

    if (!error) {
      return c.json({ error: "Missing required field: error" }, 400);
    }

    const services = initializeServices(c.env);

    // Log error to ObservabilityService
    await services.observabilityService.log(
      "error",
      `[Frontend] ${error}`,
      {
        source: "ClientError",
        stack: stack?.slice(0, 2000), // Limit stack size
        componentStack: componentStack?.slice(0, 2000),
        url,
        userAgent,
        timestamp: timestamp || new Date().toISOString(),
      }
    );

    // Also write to analytics engine for aggregation/monitoring if available
    if (c.env.PERFORMANCE_ANALYTICS) {
      try {
        c.env.PERFORMANCE_ANALYTICS.writeDataPoint({
          blobs: [
            error.slice(0, 100), // error message (truncated)
            url || "unknown",
            userAgent?.slice(0, 100) || "unknown",
          ],
          doubles: [Date.now()],
          indexes: ["client_error"],
        });
      } catch (analyticsError) {
        // Don't fail the request if analytics fails
        console.warn("[Errors] Failed to write to analytics:", analyticsError);
      }
    }

    console.log(`[Errors] Logged client error: ${error.slice(0, 100)}`);

    return c.json({
      success: true,
      message: "Error logged successfully",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Errors] Failed to process error report:", error);
    return c.json(
      {
        error: "Failed to process error report",
        timestamp: new Date().toISOString(),
      },
      500
    );
  }
});

// Comprehensive admin stats endpoint
// TODO: Add authentication back when OpenAuthService is fixed
app.get("/api/admin/stats", async (c) => {
  try {
    const services = initializeServices(c.env);
    
    // Get basic database statistics directly
    const totalArticles = await services.d1Service.getArticleCount();
    
    // Get RSS source count directly from database
    const sourcesResult = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM rss_sources WHERE enabled = 1'
    ).first();
    const activeSources = sourcesResult.count;
    
    // Get categories count directly from database  
    const categoriesResult = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM categories WHERE enabled = 1'
    ).first();
    const categoriesCount = categoriesResult.count;
    
    return c.json({
      database: {
        total_articles: totalArticles,
        active_sources: activeSources,
        categories: categoriesCount,
        size: 217088 // Approximate size from earlier query
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    return c.json({ error: "Failed to fetch stats", details: error.message }, 500);
  }
});

// Full categories management endpoint
app.get("/api/categories", async (c) => {
  try {
    const services = initializeServices(c.env);
    const categories = await services.d1Service.getCategories();

    // Add statistics for each category
    const categoriesWithStats = await Promise.all(
      categories.map(async (cat) => {
        const articleCount = await services.d1Service.getArticleCount({ category_id: cat.id });
        return {
          ...cat,
          article_count: articleCount
        };
      })
    );

    return c.json({
      categories: categoriesWithStats
    });
  } catch (error) {
    console.error("Error fetching categories:", error);
    return c.json({ error: "Failed to fetch categories" }, 500);
  }
});

// Public stats endpoint - safe aggregate data for Insights feature
// This is separate from /api/admin/stats which may contain sensitive data
app.get("/api/stats", async (c) => {
  try {
    // Try Python Worker (MongoDB) first for enhanced stats
    try {
      const processingClient = new ProcessingClient(c.env.DATA_PROCESSOR);
      const stats = await processingClient.getEnhancedStats();
      return c.json(stats);
    } catch (pyError) {
      console.warn('[API] Python Worker stats unavailable, falling back to D1:', pyError);
    }

    // D1 fallback
    const services = initializeServices(c.env);
    const totalArticles = await services.d1Service.getArticleCount();
    const sourcesResult = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM rss_sources WHERE enabled = 1'
    ).first();
    const activeSources = sourcesResult?.count || 0;
    const categoriesResult = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM categories WHERE enabled = 1'
    ).first();
    const categoriesCount = categoriesResult?.count || 0;
    const todayArticles = await services.d1Service.getArticleCount({ today: true });

    return c.json({
      database: {
        total_articles: totalArticles,
        active_sources: activeSources,
        categories: categoriesCount,
        today_articles: todayArticles
      },
      source: 'd1_fallback',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error fetching public stats:", error);
    return c.json({ error: "Failed to fetch stats" }, 500);
  }
});

// Full articles management with caching and analytics
app.get("/api/feeds", async (c) => {
  try {
    const limit = parseInt(c.req.query("limit") || "50");
    const offset = parseInt(c.req.query("offset") || "0");
    const category = c.req.query("category");
    const sort = c.req.query("sort") || "latest"; // latest, trending, popular
    // Pan-African support: filter by countries (comma-separated country codes)
    const countriesParam = c.req.query("countries");
    const countries = countriesParam ? countriesParam.split(",").filter(c => c.trim()) : null;

    // Build query params array
    const queryParams: (string | number)[] = [];

    // Get articles directly from database
    let articlesQuery = `
      SELECT id, title, slug, description, content_snippet, author, source, source_id,
             published_at, image_url, original_url, category_id, country_id, view_count,
             like_count, bookmark_count
      FROM articles
      WHERE status = 'published'
    `;

    let countQuery = `SELECT COUNT(*) as total FROM articles WHERE status = 'published'`;

    if (category && category !== 'all') {
      articlesQuery += ` AND category_id = ?`;
      countQuery += ` AND category_id = ?`;
      queryParams.push(category);
    }

    // Pan-African: filter by countries
    if (countries && countries.length > 0) {
      const placeholders = countries.map(() => '?').join(',');
      articlesQuery += ` AND country_id IN (${placeholders})`;
      countQuery += ` AND country_id IN (${placeholders})`;
      queryParams.push(...countries);
    }

    // Apply sorting based on sort parameter
    let orderClause: string;
    switch (sort) {
      case 'trending':
        // Trending: recent articles with high engagement (weighted by recency)
        // Articles from last 7 days, sorted by (views + likes*3 + bookmarks*2) / age_in_hours
        articlesQuery += ` AND published_at > datetime('now', '-7 days')`;
        orderClause = `ORDER BY (view_count + like_count * 3 + bookmark_count * 2) DESC, published_at DESC`;
        break;
      case 'popular':
        // Popular: highest engagement regardless of date
        orderClause = `ORDER BY (view_count + like_count * 3 + bookmark_count * 2) DESC`;
        break;
      case 'latest':
      default:
        orderClause = `ORDER BY published_at DESC`;
        break;
    }

    articlesQuery += ` ${orderClause} LIMIT ? OFFSET ?`;

    // Execute queries with all params
    const articlesResult = await c.env.DB.prepare(articlesQuery)
      .bind(...queryParams, limit, offset).all();

    const totalResult = queryParams.length > 0
      ? await c.env.DB.prepare(countQuery).bind(...queryParams).first<{ total: number }>()
      : await c.env.DB.prepare(countQuery).first<{ total: number }>();

    const totalCount = totalResult?.total || 0;

    // Fetch keywords for each article (optional - gracefully handle if tables don't exist)
    const articles = articlesResult.results || [];
    for (const article of articles as any[]) {
      try {
        const keywordsResult = await c.env.DB.prepare(`
          SELECT k.id, k.name, k.slug
          FROM keywords k
          INNER JOIN article_keyword_links akl ON k.id = akl.keyword_id
          WHERE akl.article_id = ?
          ORDER BY akl.relevance_score DESC
          LIMIT 8
        `).bind(article.id).all();

        article.keywords = keywordsResult.results || [];
      } catch (keywordError) {
        // Keywords table may not exist or be empty - continue without keywords
        article.keywords = [];
      }
    }

    return c.json({
      articles: articles,
      total: totalCount,
      limit,
      offset,
      hasMore: offset + limit < totalCount,
      countries: countries || undefined,  // Pan-African: return countries used for filtering
    });
  } catch (error: any) {
    console.error("Error fetching articles:", error?.message || error);
    return c.json({
      error: "Failed to fetch articles",
      details: error?.message || String(error)
    }, 500);
  }
});

// Personalized feed endpoint - uses user preferences, history, and follows
app.get("/api/feeds/personalized", async (c) => {
  try {
    const limit = parseInt(c.req.query("limit") || "30");
    const offset = parseInt(c.req.query("offset") || "0");
    const excludeRead = c.req.query("excludeRead") !== "false";
    const diversityFactor = parseFloat(c.req.query("diversity") || "0.3");
    // Pan-African support: optional country filter override (comma-separated)
    const countriesParam = c.req.query("countries");
    const countries = countriesParam ? countriesParam.split(",").filter(c => c.trim()) : null;

    // Get user ID from header or session
    const userId = c.req.header("x-user-id") || c.req.header("x-session-id") || null;

    // Initialize personalized feed service
    const feedService = new PersonalizedFeedService(c.env.DB);

    // Get personalized feed (will use user's country preferences if no override)
    const result = await feedService.getPersonalizedFeed(userId, {
      limit,
      offset,
      excludeRead,
      diversityFactor,
      countries,  // Pan-African: pass country override
    });

    // Fetch keywords for each article
    for (const article of result.articles) {
      const keywordsResult = await c.env.DB.prepare(`
        SELECT k.id, k.name, k.slug
        FROM keywords k
        INNER JOIN article_keyword_links akl ON k.id = akl.keyword_id
        WHERE akl.article_id = ?
        ORDER BY akl.relevance_score DESC
        LIMIT 8
      `).bind(article.id).all();

      (article as any).keywords = keywordsResult.results || [];
    }

    return c.json({
      articles: result.articles,
      total: result.total,
      limit,
      offset,
      hasMore: offset + limit < result.total,
      isPersonalized: result.isPersonalized,
      countries: result.countries,  // Pan-African: return which countries were used
    });
  } catch (error) {
    console.error("Error fetching personalized feed:", error);
    return c.json({ error: "Failed to fetch personalized feed" }, 500);
  }
});

// Get feed explanation - why articles are recommended
app.get("/api/feeds/personalized/explain", async (c) => {
  try {
    const userId = c.req.header("x-user-id") || c.req.header("x-session-id");

    if (!userId) {
      return c.json({
        isPersonalized: false,
        message: "Sign in to get personalized recommendations",
        sources: [],
        authors: [],
        categories: [],
        topInterests: [],
      });
    }

    const feedService = new PersonalizedFeedService(c.env.DB);
    const explanation = await feedService.getFeedExplanation(userId);

    return c.json({
      isPersonalized: true,
      ...explanation,
    });
  } catch (error) {
    console.error("Error getting feed explanation:", error);
    return c.json({ error: "Failed to get feed explanation" }, 500);
  }
});

// Constants for story clustering algorithm
const CLUSTERING_CONFIG = {
  SIMILARITY_THRESHOLD: 0.4,    // Jaccard similarity threshold for grouping stories
  MAX_CLUSTERS: 10,             // Maximum number of story clusters to return
  MAX_RELATED_PER_CLUSTER: 4,   // Maximum related articles per cluster
  TOP_STORIES_LIMIT: 30,        // Articles to fetch for clustering
  YOUR_NEWS_LIMIT: 15,          // Articles for personalized section
  CATEGORY_LIMIT: 8,            // Articles per category section
  LATEST_LIMIT: 20,             // Latest articles to return
  MAX_CATEGORIES: 5,            // Maximum category sections
  TRENDING_HOURS: 48,           // Hours to look back for trending
};

// Valid country codes (Pan-African countries)
const VALID_COUNTRIES = new Set([
  'ZW', 'ZA', 'KE', 'NG', 'GH', 'TZ', 'UG', 'RW',
  'ET', 'BW', 'ZM', 'MW', 'EG', 'MA', 'NA', 'MZ'
]);

// Valid category IDs
const VALID_CATEGORIES = new Set([
  'politics', 'economy', 'technology', 'sports', 'health',
  'education', 'entertainment', 'international', 'general',
  'harare', 'agriculture', 'crime', 'environment'
]);

// STOP_WORDS imported from StoryClusteringService

// Sectioned feed endpoint - returns top stories with clustering, your news, and by category
// This endpoint powers the redesigned home feed with Google News-style story clustering
app.get("/api/feeds/sectioned", async (c) => {
  try {
    const countriesParam = c.req.query("countries");
    const categoriesParam = c.req.query("categories");

    // SECURITY: Validate country codes against allowlist to prevent injection
    const countries = countriesParam
      ? countriesParam.split(",")
          .map(code => code.trim().toUpperCase())
          .filter(code => VALID_COUNTRIES.has(code))
      : null;

    // SECURITY: Validate category IDs against allowlist
    const preferredCategories = categoriesParam
      ? categoriesParam.split(",")
          .map(cat => cat.trim().toLowerCase())
          .filter(cat => VALID_CATEGORIES.has(cat))
      : [];

    // normalizeTitle and titleSimilarity imported from StoryClusteringService
    // with DoS prevention (title length limit: 500 chars, word limit: 50)

    // Build country filter clause
    let countryClause = '';
    const countryParams: string[] = [];
    if (countries && countries.length > 0) {
      const placeholders = countries.map(() => '?').join(',');
      countryClause = ` AND country_id IN (${placeholders})`;
      countryParams.push(...countries);
    }

    // PERFORMANCE: Run independent queries in parallel
    // Phase 1: Fetch top stories and latest (independent of categories)
    const topStoriesQuery = `
      SELECT id, title, slug, description, content_snippet, author, source, source_id,
             published_at, image_url, original_url, category_id, country_id, view_count,
             like_count, bookmark_count
      FROM articles
      WHERE status = 'published'
        AND published_at > datetime('now', '-${CLUSTERING_CONFIG.TRENDING_HOURS} hours')
        ${countryClause}
      ORDER BY (view_count + like_count * 3 + bookmark_count * 2) DESC, published_at DESC
      LIMIT ${CLUSTERING_CONFIG.TOP_STORIES_LIMIT}
    `;

    const latestQuery = `
      SELECT id, title, slug, description, content_snippet, author, source, source_id,
             published_at, image_url, original_url, category_id, country_id, view_count,
             like_count, bookmark_count
      FROM articles
      WHERE status = 'published'
        ${countryClause}
      ORDER BY published_at DESC
      LIMIT ${CLUSTERING_CONFIG.LATEST_LIMIT}
    `;

    // Execute top stories and latest in parallel
    const [topStoriesResult, latestResult] = await Promise.all([
      c.env.DB.prepare(topStoriesQuery).bind(...countryParams).all(),
      c.env.DB.prepare(latestQuery).bind(...countryParams).all(),
    ]);

    const topStoriesRaw = (topStoriesResult.results || []) as any[];
    const latestArticles = (latestResult.results || []) as any[];

    // Cluster similar stories together
    interface StoryCluster {
      id: string;
      primaryArticle: any;
      relatedArticles: any[];
      articleCount: number;
    }

    const clusters: StoryCluster[] = [];
    const clusteredIds = new Set<string>();

    for (const article of topStoriesRaw) {
      if (clusteredIds.has(article.id)) continue;

      const articleWords = normalizeTitle(article.title);
      const cluster: StoryCluster = {
        id: `cluster-${article.id}`,
        primaryArticle: article,
        relatedArticles: [],
        articleCount: 1,
      };

      clusteredIds.add(article.id);

      // Find related articles (same story from different sources)
      for (const other of topStoriesRaw) {
        if (clusteredIds.has(other.id)) continue;
        if (article.source === other.source) continue; // Must be different sources

        const otherWords = normalizeTitle(other.title);
        const similarity = titleSimilarity(articleWords, otherWords);

        // Group stories that exceed similarity threshold
        if (similarity > CLUSTERING_CONFIG.SIMILARITY_THRESHOLD) {
          cluster.relatedArticles.push(other);
          cluster.articleCount++;
          clusteredIds.add(other.id);

          if (cluster.relatedArticles.length >= CLUSTERING_CONFIG.MAX_RELATED_PER_CLUSTER) break;
        }
      }

      clusters.push(cluster);
      if (clusters.length >= CLUSTERING_CONFIG.MAX_CLUSTERS) break;
    }

    // Phase 2: Fetch category-based content with batch query (fixes N+1 pattern)
    let yourNews: any[] = [];
    const categorySections: { id: string; name: string; articles: any[] }[] = [];

    // Get categories to query
    const allCategories = preferredCategories.length > 0
      ? preferredCategories
      : ['politics', 'economy', 'technology', 'sports'];
    const categoriesToFetch = allCategories.slice(0, CLUSTERING_CONFIG.MAX_CATEGORIES);

    // PERFORMANCE: Single batch query with IN clause instead of multiple queries
    // Uses window function ROW_NUMBER() to limit per-category results
    const categoryPlaceholders = categoriesToFetch.map(() => '?').join(',');
    const batchCategoryQuery = `
      WITH ranked_articles AS (
        SELECT id, title, slug, description, content_snippet, author, source, source_id,
               published_at, image_url, original_url, category_id, country_id, view_count,
               like_count, bookmark_count,
               ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY published_at DESC) as rn
        FROM articles
        WHERE status = 'published'
          AND category_id IN (${categoryPlaceholders})
          ${countryClause}
      )
      SELECT id, title, slug, description, content_snippet, author, source, source_id,
             published_at, image_url, original_url, category_id, country_id, view_count,
             like_count, bookmark_count
      FROM ranked_articles
      WHERE rn <= ${CLUSTERING_CONFIG.CATEGORY_LIMIT}
      ORDER BY category_id, published_at DESC
    `;

    // Build "Your News" query for user preferences
    let yourNewsPromise: Promise<any> | null = null;
    if (preferredCategories.length > 0) {
      const catPlaceholders = preferredCategories.map(() => '?').join(',');
      const yourNewsQuery = `
        SELECT id, title, slug, description, content_snippet, author, source, source_id,
               published_at, image_url, original_url, category_id, country_id, view_count,
               like_count, bookmark_count
        FROM articles
        WHERE status = 'published'
          AND category_id IN (${catPlaceholders})
          ${countryClause}
        ORDER BY published_at DESC
        LIMIT ${CLUSTERING_CONFIG.YOUR_NEWS_LIMIT}
      `;
      yourNewsPromise = c.env.DB.prepare(yourNewsQuery)
        .bind(...preferredCategories, ...countryParams).all();
    }

    // Execute batch category query
    const categoryResult = await c.env.DB.prepare(batchCategoryQuery)
      .bind(...categoriesToFetch, ...countryParams).all();
    const allCategoryArticles = (categoryResult.results || []) as any[];

    // Group results by category
    const articlesByCategory = new Map<string, any[]>();
    for (const article of allCategoryArticles) {
      const catId = article.category_id;
      if (!articlesByCategory.has(catId)) {
        articlesByCategory.set(catId, []);
      }
      articlesByCategory.get(catId)!.push(article);
    }

    // Build category sections in requested order
    for (const categoryId of categoriesToFetch) {
      const articles = articlesByCategory.get(categoryId) || [];
      if (articles.length > 0) {
        categorySections.push({
          id: categoryId,
          name: categoryId.charAt(0).toUpperCase() + categoryId.slice(1),
          articles,
        });
      }
    }

    // Get "Your News" result if applicable
    if (yourNewsPromise) {
      const yourNewsResult = await yourNewsPromise;
      yourNews = (yourNewsResult.results || []) as any[];
    }

    return c.json({
      topStories: clusters,
      yourNews,
      byCategory: categorySections,
      latest: latestArticles,
      countries: countries || undefined,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("Error fetching sectioned feed:", error?.message || error);
    return c.json({
      error: "Failed to fetch sectioned feed",
      details: error?.message || String(error)
    }, 500);
  }
});

// Debug endpoint to test single RSS feed fetch
app.get("/api/admin/test-feed", async (c) => {
  const { XMLParser } = await import('fast-xml-parser');
  const feedUrl = c.req.query('url') || 'https://www.techzim.co.zw/feed/';

  // Validate URL to prevent SSRF
  try {
    const parsed = new URL(feedUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return c.json({ error: "Only HTTP/HTTPS URLs allowed" }, 400);
    }
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' ||
        hostname === '::1' || hostname === '[::1]' ||
        hostname.startsWith('10.') || hostname.startsWith('192.168.') ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
        hostname.startsWith('fe80:') || hostname.startsWith('fc00:') || hostname.startsWith('fd') ||
        /^::ffff:(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|127\.)/.test(hostname) ||
        hostname === '169.254.169.254' || hostname.endsWith('.internal') || hostname.endsWith('.local')) {
      return c.json({ error: "Internal URLs not allowed" }, 403);
    }
  } catch {
    return c.json({ error: "Invalid URL" }, 400);
  }
  try {
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      redirect: 'manual'
    });

    // Reject redirects to prevent SSRF bypass via redirect-to-internal-IP
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');
      return c.json({ error: "Feed URL redirected", redirect_url: location }, 400);
    }

    const text = await response.text();
    const contentType = response.headers.get('content-type');
    const isXML = text.trim().startsWith('<?xml') || text.trim().startsWith('<rss');

    let parseResult: any = null;
    let itemCount = 0;
    let firstItemTitle = null;

    if (isXML) {
      try {
        const parser = new XMLParser({
          ignoreAttributes: false,
          attributeNamePrefix: '@_',
          textNodeName: '#text'
        });
        const feed = parser.parse(text);
        parseResult = {
          keys: Object.keys(feed),
          hasRss: !!feed.rss,
          hasChannel: !!feed.rss?.channel,
          channelKeys: feed.rss?.channel ? Object.keys(feed.rss.channel) : [],
          hasItems: !!feed.rss?.channel?.item
        };
        if (feed.rss?.channel?.item) {
          const items = Array.isArray(feed.rss.channel.item)
            ? feed.rss.channel.item
            : [feed.rss.channel.item];
          itemCount = items.length;
          firstItemTitle = items[0]?.title;
        }
      } catch (parseErr: any) {
        parseResult = { error: parseErr.message };
      }
    }

    return c.json({
      url: feedUrl,
      status: response.status,
      contentType,
      textLength: text.length,
      first500: text.substring(0, 500),
      isXML,
      isHTML: text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html'),
      parseResult,
      itemCount,
      firstItemTitle
    });
  } catch (error: any) {
    return c.json({
      url: feedUrl,
      error: error.message
    }, 500);
  }
});

// Debug endpoint to test storing one article (admin-only, moved to /api/admin/)
app.get("/api/admin/test-store", async (c) => {
  try {
    const slug = `test-article-${Date.now()}`;
    await c.env.DB.prepare(`
      INSERT INTO articles (
        title, slug, description, content, author, source, source_id, source_url,
        category_id, published_at, image_url, original_url, rss_guid,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(
      'Test Article Title',
      slug,
      'Test description',
      'Test content',
      'Test Author',
      'Techzim',
      'techzim',
      'techzim',
      'technology',
      new Date().toISOString(),
      null,
      `https://example.com/test-${Date.now()}`,
      `guid-${Date.now()}`
    ).run();

    const count = await c.env.DB.prepare('SELECT COUNT(*) as count FROM articles').first() as { count: number };

    return c.json({
      success: true,
      slug,
      articleCount: count?.count
    });
  } catch (error: any) {
    console.error('[API] test-store error:', error);
    return c.json({
      success: false,
      error: "Failed to store test article"
    }, 500);
  }
});

// RSS refresh endpoint — delegates to Python Worker for feed collection
app.post("/api/refresh-rss", async (c) => {
  try {
    console.log("[API] Starting RSS refresh via Python Worker...");
    const startTime = Date.now();

    const processingClient = new ProcessingClient(c.env.DATA_PROCESSOR);
    const results = await processingClient.collectFeeds();

    const processingTime = Date.now() - startTime;

    console.log(`[API] RSS refresh completed in ${processingTime}ms:`, results);

    return c.json({
      success: results.success,
      message: `RSS refresh completed. Processed ${results.newArticles} new articles.`,
      newArticles: results.newArticles,
      errors: results.errors,
      details: results.details,
      processing_time_ms: processingTime,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error("[API] Error in RSS refresh:", error);
    return c.json({
      success: false,
      error: "Failed to refresh RSS feeds",
      message: error.message || "Unknown error",
      timestamp: new Date().toISOString()
    }, 500);
  }
});

/**
 * Initialize/seed RSS sources for all supported African countries
 * Public endpoint for initial setup - can be called once to populate sources
 * Subsequent calls will skip existing sources
 */
app.post("/api/feed/initialize-sources", async (c) => {
  try {
    console.log("[API] Initializing Pan-African RSS sources...");

    const services = initializeServices(c.env);

    // Add sources for all African countries
    const results = await services.newsSourceManager.addPanAfricanNewsSources();

    // Track the initialization
    await services.analyticsService.trackEvent('feed_sources_initialized', {
      added: results.added,
      failed: results.failed,
      skipped: results.details.filter(d => d.includes('Skipped')).length
    });

    return c.json({
      success: true,
      message: results.added > 0
        ? `Initialized ${results.added} RSS sources across African countries`
        : 'All sources already exist',
      added: results.added,
      failed: results.failed,
      details: results.details,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error("[API] Error initializing sources:", error);
    return c.json({
      success: false,
      error: "Failed to initialize RSS sources",
      message: error.message || "Unknown error",
      timestamp: new Date().toISOString()
    }, 500);
  }
});

/**
 * User-facing feed collection endpoint
 * Allows users to manually trigger RSS collection for fresh articles
 * Similar to TikTok's "pull down to refresh" but for RSS sources
 *
 * Rate limited to prevent abuse (max once every 5 minutes per user/IP)
 */
app.post("/api/feed/collect", async (c) => {
  try {
    console.log("[API] User-initiated feed collection");

    // Simple rate limiting check (last collection time in KV)
    const clientId = c.req.header('cf-connecting-ip') || 'default';
    const cacheKey = `feed_collect:${clientId}`;

    // Check if user collected recently (5 minute cooldown)
    if (c.env.CACHE_STORAGE) {
      const lastCollect = await c.env.CACHE_STORAGE.get(cacheKey);
      if (lastCollect) {
        const lastTime = parseInt(lastCollect);
        const cooldownMs = 5 * 60 * 1000; // 5 minutes
        const timeSince = Date.now() - lastTime;

        if (timeSince < cooldownMs) {
          const remainingSeconds = Math.ceil((cooldownMs - timeSince) / 1000);
          return c.json({
            success: false,
            message: `Please wait ${remainingSeconds} seconds before collecting again`,
            cooldown_remaining_seconds: remainingSeconds,
            timestamp: new Date().toISOString()
          }, 429);
        }
      }
    }

    const startTime = Date.now();
    const processingClient = new ProcessingClient(c.env.DATA_PROCESSOR);
    const results = await processingClient.collectFeeds();
    const processingTime = Date.now() - startTime;

    // Update last collection time
    if (c.env.CACHE_STORAGE) {
      await c.env.CACHE_STORAGE.put(cacheKey, Date.now().toString(), { expirationTtl: 300 });
    }

    console.log(`[API] User feed collection completed: ${results.newArticles} new articles`);

    return c.json({
      success: true,
      message: results.newArticles > 0
        ? `Found ${results.newArticles} new articles!`
        : 'No new articles at this time',
      newArticles: results.newArticles,
      errors: results.errors,
      processing_time_ms: processingTime,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error("[API] Error in user feed collection:", error);
    return c.json({
      success: false,
      error: "Failed to collect new articles",
      message: error.message || "Unknown error",
      timestamp: new Date().toISOString()
    }, 500);
  }
});

// Backfill keywords for existing articles — delegates to Python Worker
app.post("/api/admin/backfill-keywords", async (c) => {
  try {
    console.log("[API] Starting keyword backfill via Python Worker...");
    const startTime = Date.now();

    const processingClient = new ProcessingClient(c.env.DATA_PROCESSOR);

    // Get all articles that don't have keywords
    const articlesWithoutKeywords = await c.env.DB
      .prepare(`
        SELECT a.id, a.title, a.description
        FROM articles a
        LEFT JOIN article_keyword_links akl ON a.id = akl.article_id
        WHERE akl.id IS NULL
        LIMIT 200
      `)
      .all();

    if (!articlesWithoutKeywords.results || articlesWithoutKeywords.results.length === 0) {
      return c.json({
        success: true,
        message: "No articles need keyword backfill",
        processed: 0,
        timestamp: new Date().toISOString()
      });
    }

    let processed = 0;
    let keywordsAdded = 0;

    for (const article of articlesWithoutKeywords.results) {
      try {
        const result = await processingClient.extractKeywords(
          article.title as string,
          (article.description as string) || ''
        );

        if (result.keywords && result.keywords.length > 0) {
          for (const kw of result.keywords) {
            const keywordId = kw.keyword.toLowerCase().replace(/\s+/g, '-');
            const keywordSlug = keywordId;
            const keywordName = kw.keyword.charAt(0).toUpperCase() + kw.keyword.slice(1);

            const existingKeyword = await c.env.DB
              .prepare('SELECT id FROM keywords WHERE id = ?')
              .bind(keywordId)
              .first();

            if (!existingKeyword) {
              await c.env.DB
                .prepare(`
                  INSERT INTO keywords (id, name, slug, type, enabled, created_at, updated_at)
                  VALUES (?, ?, ?, 'general', 1, datetime('now'), datetime('now'))
                `)
                .bind(keywordId, keywordName, keywordSlug)
                .run();
            }

            await c.env.DB
              .prepare(`
                INSERT INTO article_keyword_links (article_id, keyword_id, relevance_score, source, created_at)
                VALUES (?, ?, ?, 'ai', datetime('now'))
                ON CONFLICT(article_id, keyword_id) DO NOTHING
              `)
              .bind(article.id, keywordId, kw.confidence)
              .run();

            await c.env.DB
              .prepare('UPDATE keywords SET article_count = article_count + 1 WHERE id = ?')
              .bind(keywordId)
              .run();

            keywordsAdded++;
          }
        }

        processed++;
        if (processed % 10 === 0) {
          console.log(`[API] Backfilled ${processed} articles, ${keywordsAdded} keywords added`);
        }
      } catch (error: any) {
        console.error(`[API] Error backfilling article ${article.id}:`, error.message);
      }
    }

    const processingTime = Date.now() - startTime;
    console.log(`[API] Keyword backfill completed in ${processingTime}ms`);

    return c.json({
      success: true,
      message: `Backfilled keywords for ${processed} articles`,
      processed,
      keywordsAdded,
      processing_time_ms: processingTime,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error("[API] Error in keyword backfill:", error);
    return c.json({
      success: false,
      error: "Failed to backfill keywords",
      message: error.message || "Unknown error",
      timestamp: new Date().toISOString()
    }, 500);
  }
});

// ===== BULK PULL ENDPOINTS FOR INITIAL SETUP AND TESTING =====

// Initial bulk pull with batching support
// Batching prevents "Too many subrequests" errors by processing sources in groups
// Usage: POST /api/admin/bulk-pull { "batch": 0, "batchSize": 40 }
// TODO: Add authentication back when OpenAuthService is fixed
app.post("/api/admin/bulk-pull", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const batch = typeof body.batch === 'number' ? body.batch : 0;
    const batchSize = typeof body.batchSize === 'number' ? body.batchSize : 40;

    console.log(`Starting BULK PULL via Python Worker (batch ${batch}, size ${batchSize})...`);

    const processingClient = new ProcessingClient(c.env.DATA_PROCESSOR);
    const results = await processingClient.collectFeeds({ batch, batchSize });

    // Track the bulk pull event for analytics
    const services = initializeServices(c.env);
    await services.analyticsService.trackEvent('initial_bulk_pull', {
      batch: results.batch,
      total_batches: results.totalBatches,
      new_articles: results.newArticles,
      errors: results.errors
    });

    return c.json({
      success: results.success,
      message: `Batch ${results.batch + 1}/${results.totalBatches} completed: ${results.newArticles} new articles`,
      batch: results.batch,
      totalBatches: results.totalBatches,
      totalSources: results.totalSources,
      newArticles: results.newArticles,
      errors: results.errors,
      details: results.details,
      nextBatch: results.batch + 1 < results.totalBatches ? results.batch + 1 : null,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error("Error in bulk pull:", error);
    return c.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, 500);
  }
});

// Add new Zimbabwe sources
// TODO: Add authentication back when OpenAuthService is fixed
app.post("/api/admin/add-zimbabwe-sources", async (c) => {
  try {
    const services = initializeServices(c.env);

    console.log("Adding comprehensive Zimbabwe news sources...");

    // Use the news source manager to add all Zimbabwe sources
    const results = await services.newsSourceManager.addZimbabweNewsSources();

    // Track the source addition event
    await services.analyticsService.trackEvent('zimbabwe_sources_added', {
      added: results.added,
      failed: results.failed,
      total_attempted: results.added + results.failed
    });

    return c.json({
      success: true,
      message: `Added ${results.added} Zimbabwe news sources (${results.failed} failed)`,
      ...results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("Error adding Zimbabwe sources:", error);
    return c.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, 500);
  }
});

// Migrate existing articles to set country_id from their source
app.post("/api/admin/migrate-article-countries", async (c) => {
  try {
    // Update articles to inherit country_id from their rss_source
    const result = await c.env.DB.prepare(`
      UPDATE articles
      SET country_id = (
        SELECT rs.country_id
        FROM rss_sources rs
        WHERE rs.id = articles.source_id OR rs.name = articles.source
      )
      WHERE country_id IS NULL OR country_id = ''
    `).run();

    // Count how many were updated
    const countResult = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN country_id IS NOT NULL AND country_id != '' THEN 1 END) as with_country,
        COUNT(CASE WHEN country_id IS NULL OR country_id = '' THEN 1 END) as without_country
      FROM articles
    `).first() as { total: number; with_country: number; without_country: number };

    return c.json({
      success: true,
      message: `Migration complete`,
      changes: result.meta.changes,
      stats: countResult,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error("Error migrating article countries:", error);
    return c.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, 500);
  }
});

// Add Pan-African news sources for all countries
// TODO: Add authentication back when OpenAuthService is fixed
app.post("/api/admin/add-panafrican-sources", async (c) => {
  try {
    const services = initializeServices(c.env);

    console.log("Adding Pan-African news sources for all countries...");

    // Use the news source manager to add sources for all African countries
    const results = await services.newsSourceManager.addPanAfricanNewsSources();

    // Track the source addition event
    await services.analyticsService.trackEvent('panafrican_sources_added', {
      added: results.added,
      failed: results.failed,
      total_attempted: results.added + results.failed
    });

    return c.json({
      success: true,
      message: `Added ${results.added} Pan-African news sources across 15 countries (${results.failed} failed)`,
      ...results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("Error adding Pan-African sources:", error);
    return c.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, 500);
  }
});

// Get RSS configuration and source limits
// TODO: Add authentication back when OpenAuthService is fixed
app.get("/api/admin/rss-config", async (c) => {
  try {
    const services = initializeServices(c.env);
    
    // Get system configuration
    const systemConfig = await services.d1Service.db.prepare(`
      SELECT config_key, config_value, config_type, description, category 
      FROM system_config 
      WHERE category = 'rss' OR category = 'platform'
      ORDER BY category, config_key
    `).all();
    
    // Get sources with their current daily limits
    const sources = await services.d1Service.db.prepare(`
      SELECT id, name, url, category, enabled, priority, 
             daily_limit, articles_per_fetch, max_bulk_articles,
             quality_score, reliability_score, validation_status,
             last_fetched_at, fetch_count, error_count
      FROM rss_sources 
      ORDER BY priority DESC, name ASC
    `).all();
    
    // Get today's stats
    interface DailyStats { source_id: string; articles_fetched: number; articles_stored: number; successful_fetches: number; }
    const todayStats = await services.d1Service.db.prepare(`
      SELECT source_id, articles_fetched, articles_stored, successful_fetches
      FROM daily_source_stats
      WHERE date_tracked = DATE('now')
    `).all<DailyStats>();

    const statsMap: Record<string, DailyStats> = {};
    for (const stat of todayStats.results) {
      statsMap[stat.source_id] = stat;
    }
    
    const sourcesWithStats = sources.results.map((source: any) => ({
      ...source,
      todayStats: statsMap[source.id] || { articles_fetched: 0, articles_stored: 0, successful_fetches: 0 }
    }));
    
    return c.json({
      systemConfig: systemConfig.results,
      sources: sourcesWithStats,
      totalSources: sources.results.length,
      enabledSources: sources.results.filter((s: any) => s.enabled).length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error("Error getting RSS config:", error);
    return c.json({ 
      success: false, 
      error: error.message,
      timestamp: new Date().toISOString()
    }, 500);
  }
});

// Update RSS source configuration
// TODO: Add authentication back when OpenAuthService is fixed
app.put("/api/admin/rss-source/:sourceId", async (c) => {
  try {
    const services = initializeServices(c.env);
    const sourceId = c.req.param("sourceId");
    const body = await c.req.json();
    
    const {
      daily_limit,
      articles_per_fetch,
      max_bulk_articles,
      enabled,
      priority
    } = body;
    
    // Update source configuration
    await services.d1Service.db.prepare(`
      UPDATE rss_sources 
      SET daily_limit = ?, 
          articles_per_fetch = ?, 
          max_bulk_articles = ?,
          enabled = ?,
          priority = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      daily_limit,
      articles_per_fetch, 
      max_bulk_articles,
      enabled ? 1 : 0,
      priority,
      sourceId
    ).run();
    
    return c.json({
      success: true,
      message: `Updated configuration for source ${sourceId}`,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error("Error updating RSS source config:", error);
    return c.json({ 
      success: false, 
      error: error.message,
      timestamp: new Date().toISOString()
    }, 500);
  }
});

// Admin sources management - fetches real sources from database
app.get("/api/admin/sources", async (c) => {
  try {
    const services = initializeServices(c.env);

    // Get all sources from database via NewsSourceManager
    const sources = await services.newsSourceManager.getAllSources();

    // Enhance with statistics
    const sourcesWithStats = await Promise.all(
      sources.map(async (source) => {
        const articleCount = await services.d1Service.getArticleCount({ source_id: source.id });
        const lastFetch = await services.cacheService.getLastFetch(source.id);

        return {
          ...source,
          articles: articleCount,
          last_fetch: lastFetch || source.last_successful_fetch || new Date().toISOString(),
          status: source.enabled ? "active" : "inactive"
        };
      })
    );

    return c.json({ sources: sourcesWithStats });
  } catch (error) {
    console.error("Error fetching sources:", error);
    return c.json({ error: "Failed to fetch sources" }, 500);
  }
});

// Get single source with its domains
app.get("/api/admin/sources/:id", async (c) => {
  try {
    const sourceId = c.req.param("id");
    const services = initializeServices(c.env);

    // Get the source
    const source = await services.newsSourceManager.getSourceById(sourceId);
    if (!source) {
      return c.json({ error: "Source not found" }, 404);
    }

    // Get domains associated with this source
    const domainsResult = await c.env.DB.prepare(`
      SELECT id, domain, type, description, enabled, created_at
      FROM trusted_domains
      WHERE source_id = ?
      ORDER BY domain ASC
    `).bind(sourceId).all();

    // Get article count
    const articleCount = await services.d1Service.getArticleCount({ source_id: sourceId });

    return c.json({
      source: {
        ...source,
        articles: articleCount,
        domains: domainsResult.results || []
      }
    });
  } catch (error) {
    console.error("Error fetching source:", error);
    return c.json({ error: "Failed to fetch source" }, 500);
  }
});

// Get all domains for a specific source
app.get("/api/admin/sources/:id/domains", async (c) => {
  try {
    const sourceId = c.req.param("id");

    const result = await c.env.DB.prepare(`
      SELECT id, domain, type, description, enabled, created_at
      FROM trusted_domains
      WHERE source_id = ?
      ORDER BY domain ASC
    `).bind(sourceId).all();

    return c.json({ domains: result.results || [] });
  } catch (error) {
    console.error("Error fetching source domains:", error);
    return c.json({ error: "Failed to fetch source domains" }, 500);
  }
});

// Add a domain to a source
app.post("/api/admin/sources/:id/domains", async (c) => {
  try {
    const sourceId = c.req.param("id");
    const { domain, type = 'image', description } = await c.req.json();

    if (!domain) {
      return c.json({ error: "Domain is required" }, 400);
    }

    // Normalize domain (remove protocol, trailing slashes)
    const normalizedDomain = domain.toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '');

    // Insert or update the domain
    await c.env.DB.prepare(`
      INSERT INTO trusted_domains (domain, type, source_id, description, enabled)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(domain) DO UPDATE SET
        source_id = excluded.source_id,
        type = excluded.type,
        description = COALESCE(excluded.description, description)
    `).bind(normalizedDomain, type, sourceId, description || null).run();

    // Get the inserted/updated domain
    const result = await c.env.DB.prepare(`
      SELECT id, domain, type, source_id, description, enabled, created_at
      FROM trusted_domains
      WHERE domain = ?
    `).bind(normalizedDomain).first();

    return c.json({ domain: result, message: "Domain added successfully" });
  } catch (error) {
    console.error("Error adding domain:", error);
    return c.json({ error: "Failed to add domain" }, 500);
  }
});

// Get all trusted domains (with optional filtering)
app.get("/api/admin/domains", async (c) => {
  try {
    const sourceId = c.req.query("source_id");
    const type = c.req.query("type");
    const search = c.req.query("search");

    let query = `
      SELECT td.id, td.domain, td.type, td.source_id, td.description, td.enabled, td.created_at,
             ns.name as source_name
      FROM trusted_domains td
      LEFT JOIN news_sources ns ON td.source_id = ns.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (sourceId) {
      query += ` AND td.source_id = ?`;
      params.push(sourceId);
    }

    if (type) {
      query += ` AND td.type = ?`;
      params.push(type);
    }

    if (search) {
      query += ` AND (td.domain LIKE ? OR td.description LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY td.domain ASC LIMIT 500`;

    const result = await c.env.DB.prepare(query).bind(...params).all();

    // Get summary counts
    const countsResult = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN source_id IS NOT NULL THEN 1 ELSE 0 END) as linked,
        SUM(CASE WHEN source_id IS NULL THEN 1 ELSE 0 END) as shared
      FROM trusted_domains
    `).first();

    return c.json({
      domains: result.results || [],
      summary: {
        total: countsResult?.total || 0,
        linked: countsResult?.linked || 0,
        shared: countsResult?.shared || 0
      }
    });
  } catch (error) {
    console.error("Error fetching domains:", error);
    return c.json({ error: "Failed to fetch domains" }, 500);
  }
});

// Update a domain
app.patch("/api/admin/domains/:id", async (c) => {
  try {
    const domainId = c.req.param("id");
    const updates = await c.req.json();

    const allowedFields = ['source_id', 'type', 'description', 'enabled'];
    const setClauses: string[] = [];
    const params: any[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClauses.push(`${key} = ?`);
        params.push(value);
      }
    }

    if (setClauses.length === 0) {
      return c.json({ error: "No valid fields to update" }, 400);
    }

    params.push(domainId);

    await c.env.DB.prepare(`
      UPDATE trusted_domains
      SET ${setClauses.join(', ')}
      WHERE id = ?
    `).bind(...params).run();

    const result = await c.env.DB.prepare(`
      SELECT id, domain, type, source_id, description, enabled, created_at
      FROM trusted_domains
      WHERE id = ?
    `).bind(domainId).first();

    return c.json({ domain: result, message: "Domain updated successfully" });
  } catch (error) {
    console.error("Error updating domain:", error);
    return c.json({ error: "Failed to update domain" }, 500);
  }
});

// Delete a domain
app.delete("/api/admin/domains/:id", async (c) => {
  try {
    const domainId = c.req.param("id");

    // Get domain info before deleting
    const domain = await c.env.DB.prepare(`
      SELECT domain FROM trusted_domains WHERE id = ?
    `).bind(domainId).first();

    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    await c.env.DB.prepare(`
      DELETE FROM trusted_domains WHERE id = ?
    `).bind(domainId).run();

    return c.json({ message: "Domain deleted successfully", domain: domain.domain });
  } catch (error) {
    console.error("Error deleting domain:", error);
    return c.json({ error: "Failed to delete domain" }, 500);
  }
});

// Analytics insights endpoint - backend heavy lifting
// TODO: Add authentication back when OpenAuthService is fixed
app.get("/api/admin/analytics", async (c) => {
  try {
    const services = initializeServices(c.env);

    // Get comprehensive analytics data
    const analytics = await services.analyticsService.getInsights({
      timeframe: c.req.query("timeframe") || "7d",
      category: c.req.query("category")
    });

    return c.json(analytics);
  } catch (error) {
    console.error("Error fetching analytics:", error);
    return c.json({ error: "Failed to fetch analytics" }, 500);
  }
});

// Content insights — MongoDB-powered engagement analytics
app.get("/api/admin/content-insights", async (c) => {
  try {
    const countryId = c.req.query("country_id");
    if (countryId && !/^[A-Z]{2}$/.test(countryId)) {
      return c.json({ error: "Invalid country_id format (expected 2-letter ISO code)" }, 400);
    }
    const processingClient = new ProcessingClient(c.env.DATA_PROCESSOR);
    const insights = await processingClient.getContentInsights(countryId || undefined);
    return c.json({ success: true, ...insights });
  } catch (error: any) {
    console.error('[API] Error fetching content insights:', error);
    return c.json({ error: "Failed to fetch content insights" }, 500);
  }
});

// Cron job logs endpoint - view recent cron executions
app.get("/api/admin/cron-logs", async (c) => {
  try {
    const limit = parseInt(c.req.query("limit") || "50");
    const offset = parseInt(c.req.query("offset") || "0");

    const logs = await c.env.DB.prepare(`
      SELECT
        id,
        cron_type,
        status,
        trigger_time,
        completed_at,
        duration_ms,
        articles_processed,
        articles_new,
        sources_processed,
        sources_failed,
        error_message,
        created_at
      FROM cron_logs
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all();

    const totalResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM cron_logs
    `).first();

    return c.json({
      logs: logs.results,
      total: totalResult.count,
      limit,
      offset
    });
  } catch (error) {
    console.error("Error fetching cron logs:", error);
    return c.json({ error: "Failed to fetch cron logs" }, 500);
  }
});

// Article by source/slug with full service integration
app.get("/api/article/by-source-slug", async (c) => {
  const source = c.req.query("source");
  const slug = c.req.query("slug");
  
  if (!source || !slug) {
    return c.json({ error: "Source and slug are required" }, 400);
  }

  try {
    const services = initializeServices(c.env);

    // Use article service for enhanced retrieval with caching
    const article = await services.articleService.getArticleBySlug(slug);

    if (!article) {
      return c.json({ error: "Article not found" }, 404);
    }

    // Fetch keywords for the article
    const keywordsResult = await c.env.DB.prepare(`
      SELECT k.id, k.name, k.slug
      FROM keywords k
      INNER JOIN article_keyword_links akl ON k.id = akl.keyword_id
      WHERE akl.article_id = ?
      ORDER BY akl.relevance_score DESC
      LIMIT 10
    `).bind(article.id).all();

    article.keywords = keywordsResult.results || [];

    // Track article access analytics
    await services.analyticsService.trackEvent('article_view', {
      source: source,
      slug: slug,
      category: article.category_id,
      admin_access: true
    });

    return c.json({ article });
  } catch (error) {
    console.error("Error fetching article:", error);
    return c.json({ error: "Failed to fetch article" }, 500);
  }
});

// Get single article by ID
app.get("/api/article/:id", async (c) => {
  const articleId = c.req.param("id");

  if (!articleId) {
    return c.json({ error: "Article ID is required" }, 400);
  }

  try {
    const services = initializeServices(c.env);

    // Fetch article by ID
    const article = await c.env.DB.prepare(`
      SELECT id, title, slug, description, content, content_snippet, author, source, source_id,
             published_at, updated_at, image_url, original_url, category_id, view_count,
             like_count, bookmark_count, word_count, reading_time
      FROM articles
      WHERE id = ? AND status = 'published'
    `).bind(articleId).first();

    if (!article) {
      return c.json({ error: "Article not found" }, 404);
    }

    // Fetch keywords for the article
    const keywordsResult = await c.env.DB.prepare(`
      SELECT k.id, k.name, k.slug
      FROM keywords k
      INNER JOIN article_keyword_links akl ON k.id = akl.keyword_id
      WHERE akl.article_id = ?
      ORDER BY akl.relevance_score DESC
      LIMIT 10
    `).bind(article.id).all();

    article.keywords = keywordsResult.results || [];

    // Track article access analytics
    await services.analyticsService.trackEvent('article_view', {
      articleId: articleId,
      source: article.source,
      category: article.category_id,
      from_mobile: true
    });

    // Update view count
    await c.env.DB.prepare(`
      UPDATE articles SET
        view_count = view_count + 1,
        last_viewed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(articleId).run();

    return c.json({ article });
  } catch (error) {
    console.error("Error fetching article by ID:", error);
    return c.json({ error: "Failed to fetch article" }, 500);
  }
});

// Get related/similar articles for a given article
app.get("/api/article/:id/related", async (c) => {
  try {
    const articleId = c.req.param("id");
    const limit = parseInt(c.req.query("limit") || "6");

    // Get the source article's details
    const sourceArticle = await c.env.DB.prepare(`
      SELECT id, title, category_id, source_id, published_at,
             (SELECT GROUP_CONCAT(k.name) FROM keywords k
              INNER JOIN article_keyword_links akl ON k.id = akl.keyword_id
              WHERE akl.article_id = articles.id LIMIT 5) as keywords
      FROM articles WHERE id = ? AND status = 'published'
    `).bind(articleId).first();

    if (!sourceArticle) {
      return c.json({ error: "Article not found" }, 404);
    }

    // Find related articles using multiple criteria:
    // 1. Same category
    // 2. Shared keywords
    // 3. Similar time period (recent articles on same topic)
    // 4. Different source (cross-source coverage)
    const relatedResult = await c.env.DB.prepare(`
      WITH article_keywords AS (
        SELECT keyword_id FROM article_keyword_links WHERE article_id = ?
      ),
      scored_articles AS (
        SELECT
          a.id, a.title, a.slug, a.description, a.source, a.source_id,
          a.published_at, a.image_url, a.category_id, a.view_count,
          -- Scoring: same category = 3pts, shared keywords = 2pts each, different source = 1pt, recency bonus
          (CASE WHEN a.category_id = ? THEN 3 ELSE 0 END) +
          (SELECT COUNT(*) * 2 FROM article_keyword_links akl
           WHERE akl.article_id = a.id AND akl.keyword_id IN (SELECT keyword_id FROM article_keywords)) +
          (CASE WHEN a.source_id != ? THEN 1 ELSE 0 END) +
          (CASE WHEN a.published_at > datetime('now', '-7 days') THEN 2 ELSE 0 END)
          AS relevance_score,
          -- Flag if from different source (for "same story, different source" detection)
          (CASE WHEN a.source_id != ? THEN 1 ELSE 0 END) AS is_cross_source
        FROM articles a
        WHERE a.id != ?
          AND a.status = 'published'
          AND a.published_at > datetime('now', '-30 days')
      )
      SELECT id, title, slug, description, source, source_id, published_at,
             image_url, category_id, view_count, relevance_score, is_cross_source
      FROM scored_articles
      WHERE relevance_score > 0
      ORDER BY relevance_score DESC, published_at DESC
      LIMIT ?
    `).bind(
      articleId,
      sourceArticle.category_id,
      sourceArticle.source_id,
      sourceArticle.source_id,
      articleId,
      limit
    ).all();

    return c.json({
      related: relatedResult.results || [],
      source_article_id: articleId
    });
  } catch (error) {
    console.error("[RELATED_ARTICLES] Error:", error);
    return c.json({ error: "Failed to fetch related articles" }, 500);
  }
});

// Get story cluster - same story reported by multiple sources
app.get("/api/stories/cluster/:articleId", async (c) => {
  try {
    const articleId = c.req.param("articleId");

    // Get the source article
    const sourceArticle = await c.env.DB.prepare(`
      SELECT id, title, category_id, source_id, published_at, content_hash
      FROM articles WHERE id = ? AND status = 'published'
    `).bind(articleId).first();

    if (!sourceArticle) {
      return c.json({ error: "Article not found" }, 404);
    }

    // Find articles that are likely about the same story:
    // 1. Exact content hash match (duplicates)
    // 2. Same category + shared keywords + similar time window
    // 3. Different sources to show cross-coverage
    const clusterResult = await c.env.DB.prepare(`
      WITH source_keywords AS (
        SELECT keyword_id FROM article_keyword_links WHERE article_id = ?
      ),
      potential_matches AS (
        SELECT
          a.id, a.title, a.slug, a.description, a.source, a.source_id,
          a.published_at, a.image_url, a.category_id, a.view_count, a.content_hash,
          -- Count shared keywords
          (SELECT COUNT(*) FROM article_keyword_links akl
           WHERE akl.article_id = a.id AND akl.keyword_id IN (SELECT keyword_id FROM source_keywords)) AS shared_keywords,
          -- Is this from a different source?
          (CASE WHEN a.source_id != ? THEN 1 ELSE 0 END) AS is_different_source
        FROM articles a
        WHERE a.id != ?
          AND a.status = 'published'
          AND a.category_id = ?
          AND a.published_at BETWEEN datetime(?, '-3 days') AND datetime(?, '+3 days')
      )
      SELECT id, title, slug, description, source, source_id, published_at,
             image_url, category_id, view_count, shared_keywords, is_different_source,
             (CASE WHEN content_hash = ? THEN 'duplicate' ELSE 'related' END) AS match_type
      FROM potential_matches
      WHERE shared_keywords >= 2 OR content_hash = ?
      ORDER BY
        CASE WHEN content_hash = ? THEN 0 ELSE 1 END,
        shared_keywords DESC,
        is_different_source DESC,
        published_at DESC
      LIMIT 10
    `).bind(
      articleId,
      sourceArticle.source_id,
      articleId,
      sourceArticle.category_id,
      sourceArticle.published_at,
      sourceArticle.published_at,
      sourceArticle.content_hash,
      sourceArticle.content_hash,
      sourceArticle.content_hash
    ).all();

    // Group by source for the response
    const bySource: Record<string, unknown[]> = {};
    for (const article of clusterResult.results || []) {
      const a = article as { source: string };
      if (!bySource[a.source]) bySource[a.source] = [];
      bySource[a.source].push(article);
    }

    return c.json({
      cluster: {
        source_article: sourceArticle,
        related_coverage: clusterResult.results || [],
        by_source: bySource,
        source_count: Object.keys(bySource).length,
        total_articles: (clusterResult.results || []).length
      }
    });
  } catch (error) {
    console.error("[STORY_CLUSTER] Error:", error);
    return c.json({ error: "Failed to fetch story cluster" }, 500);
  }
});

// Get trending stories (clustered by topic)
app.get("/api/stories/trending", async (c) => {
  try {
    const limit = parseInt(c.req.query("limit") || "10");
    const hours = parseInt(c.req.query("hours") || "24");

    // Find articles with the most cross-source coverage (same story, multiple outlets)
    const trendingResult = await c.env.DB.prepare(`
      WITH recent_articles AS (
        SELECT
          a.id, a.title, a.slug, a.description, a.source, a.source_id,
          a.published_at, a.image_url, a.category_id, a.view_count,
          a.like_count, a.bookmark_count
        FROM articles a
        WHERE a.status = 'published'
          AND a.published_at > datetime('now', '-' || ? || ' hours')
      ),
      keyword_groups AS (
        SELECT
          akl.keyword_id,
          k.name as keyword_name,
          COUNT(DISTINCT ra.source_id) as source_count,
          COUNT(DISTINCT ra.id) as article_count,
          SUM(ra.view_count) as total_views,
          GROUP_CONCAT(DISTINCT ra.id) as article_ids
        FROM recent_articles ra
        JOIN article_keyword_links akl ON ra.id = akl.article_id
        JOIN keywords k ON akl.keyword_id = k.id
        WHERE k.category != 'meta'
        GROUP BY akl.keyword_id
        HAVING source_count >= 2
      )
      SELECT
        keyword_id, keyword_name, source_count, article_count,
        total_views, article_ids
      FROM keyword_groups
      ORDER BY source_count DESC, article_count DESC, total_views DESC
      LIMIT ?
    `).bind(hours, limit).all();

    // Fetch details for each trending story cluster
    const trendingStories = [];
    for (const trend of trendingResult.results || []) {
      const t = trend as { keyword_id: number; keyword_name: string; source_count: number; article_count: number; total_views: number; article_ids: string };
      const articleIds = t.article_ids.split(',').slice(0, 5);

      const articlesResult = await c.env.DB.prepare(`
        SELECT id, title, slug, source, source_id, published_at, image_url
        FROM articles
        WHERE id IN (${articleIds.map(() => '?').join(',')})
        ORDER BY published_at DESC
      `).bind(...articleIds).all();

      trendingStories.push({
        topic: t.keyword_name,
        source_count: t.source_count,
        article_count: t.article_count,
        total_views: t.total_views,
        articles: articlesResult.results || []
      });
    }

    return c.json({
      trending: trendingStories,
      period_hours: hours
    });
  } catch (error) {
    console.error("[TRENDING_STORIES] Error:", error);
    return c.json({ error: "Failed to fetch trending stories" }, 500);
  }
});

// ===== PHASE 1: PUBLIC USER-FACING ENDPOINTS =====

// News Bytes - Articles with images only (TikTok-like feed)
app.get("/api/news-bytes", async (c) => {
  try {
    const limit = parseInt(c.req.query("limit") || "20");
    const offset = parseInt(c.req.query("offset") || "0");
    const category = c.req.query("category");

    let query = `
      SELECT id, title, slug, description, content_snippet, author, source,
             published_at, image_url, original_url, category_id, view_count,
             like_count, bookmark_count
      FROM articles
      WHERE status = 'published'
      AND image_url IS NOT NULL
      AND image_url != ''
    `;

    let countQuery = `
      SELECT COUNT(*) as total FROM articles
      WHERE status = 'published'
      AND image_url IS NOT NULL
      AND image_url != ''
    `;

    if (category && category !== 'all') {
      query += ` AND category_id = ?`;
      countQuery += ` AND category_id = ?`;
    }

    query += ` ORDER BY published_at DESC LIMIT ? OFFSET ?`;

    const articlesResult = category && category !== 'all' ?
      await c.env.DB.prepare(query).bind(category, limit, offset).all() :
      await c.env.DB.prepare(query).bind(limit, offset).all();

    const totalResult = category && category !== 'all' ?
      await c.env.DB.prepare(countQuery).bind(category).first<{ total: number }>() :
      await c.env.DB.prepare(countQuery).first<{ total: number }>();

    const totalCount = totalResult?.total || 0;

    return c.json({
      articles: articlesResult.results,
      total: totalCount,
      limit,
      offset,
      hasMore: offset + limit < totalCount
    });
  } catch (error) {
    console.error("Error fetching news bytes:", error);
    return c.json({ error: "Failed to fetch news bytes" }, 500);
  }
});

// Search endpoint - Semantic search with AI, falls back to keyword search
app.get("/api/search", async (c) => {
  try {
    const query = c.req.query("q");
    const category = c.req.query("category");
    const limit = parseInt(c.req.query("limit") || "50");
    const useAI = c.req.query("ai") !== "false"; // Enable AI search by default

    if (!query || query.trim().length === 0) {
      return c.json({ error: "Search query is required" }, 400);
    }

    const services = initializeServices(c.env);
    let searchResults: any[] = [];
    let searchMethod = "keyword";
    let searchInsights: any[] | null = null;

    // Try semantic search via Python Worker first
    if (useAI) {
      try {
        const processingClient = new ProcessingClient(c.env.DATA_PROCESSOR);
        const aiResponse = await processingClient.search(query.trim(), {
          limit,
          category: category !== 'all' ? category : undefined,
          includeInsights: true
        });

        if (aiResponse.results && aiResponse.results.length > 0) {
          searchResults = aiResponse.results;
          searchMethod = aiResponse.method || "semantic";
          searchInsights = aiResponse.insights || null;
          console.log(`[SEARCH] Python Worker search returned ${aiResponse.results.length} results for "${query}"`);
        }
      } catch (aiError) {
        console.warn("[SEARCH] Python Worker search failed, falling back to keyword:", aiError);
      }
    }

    // Fall back to keyword search if semantic search didn't return results
    if (searchResults.length === 0) {
      const searchTerm = `%${query.trim()}%`;

      let searchQuery = `
        SELECT DISTINCT a.id, a.title, a.slug, a.description, a.content_snippet,
               a.author, a.source, a.published_at, a.image_url, a.original_url,
               a.category_id, a.view_count, a.like_count, a.bookmark_count
        FROM articles a
        LEFT JOIN article_keywords ak ON a.id = ak.article_id
        WHERE a.status = 'published'
        AND (
          a.title LIKE ? OR
          a.description LIKE ? OR
          a.content LIKE ? OR
          a.content_snippet LIKE ? OR
          ak.keyword LIKE ?
        )
      `;

      const params: (string | number)[] = [searchTerm, searchTerm, searchTerm, searchTerm, searchTerm];

      if (category && category !== 'all') {
        searchQuery += ` AND a.category_id = ?`;
        params.push(category);
      }

      searchQuery += ` ORDER BY a.published_at DESC LIMIT ?`;
      params.push(limit);

      const results = await c.env.DB.prepare(searchQuery).bind(...params).all();
      searchResults = results.results || [];
    }

    // Log search query for analytics
    try {
      await services.analyticsService.trackSearch({
        query: query.trim(),
        category: category || null,
        resultsCount: searchResults.length,
        userId: c.req.header('x-session-id') || 'anonymous'
      });
    } catch (logError) {
      console.error("Failed to log search:", logError);
    }

    return c.json({
      results: searchResults,
      query: query.trim(),
      count: searchResults.length,
      category: category || 'all',
      searchMethod,
      ...(searchInsights ? { insights: searchInsights } : {})
    });
  } catch (error) {
    console.error("Error searching articles:", error);
    return c.json({ error: "Failed to search articles" }, 500);
  }
});

// Public Authors endpoint (for user discovery)
app.get("/api/authors", async (c) => {
  try {
    const services = initializeServices(c.env);
    const limit = parseInt(c.req.query("limit") || "20");
    const outlet = c.req.query("outlet");

    // Get authors from the service (same logic as admin endpoint)
    const authors = await services.authorProfileService.getAuthors({
      limit,
      outlet
    });

    return c.json({
      authors,
      total: authors.length,
      limit
    });
  } catch (error) {
    console.error("Error fetching authors:", error);
    return c.json({ error: "Failed to fetch authors" }, 500);
  }
});

// Public Sources endpoint (for following and /sources page)
app.get("/api/sources", async (c) => {
  try {
    // Get active sources with article counts using a subquery for SQL portability
    const sources = await c.env.DB.prepare(`
      SELECT
        rs.id, rs.name, rs.url, rs.category, rs.country_id,
        rs.priority, rs.last_fetched_at, rs.fetch_count, rs.error_count,
        rs.last_error,
        COALESCE(counts.article_count, 0) as article_count,
        counts.latest_article_at
      FROM rss_sources rs
      LEFT JOIN (
        SELECT source_id,
               COUNT(*) as article_count,
               MAX(published_at) as latest_article_at
        FROM articles
        GROUP BY source_id
      ) counts ON counts.source_id = rs.id
      WHERE rs.enabled = 1
      ORDER BY article_count DESC, rs.priority DESC, rs.name ASC
    `).all();

    return c.json({
      sources: sources.results || [],
      total: (sources.results || []).length
    });
  } catch (error) {
    console.error("Error fetching sources:", error);
    return c.json({ error: "Failed to fetch sources" }, 500);
  }
});

// Public Keywords endpoint (for tag cloud)
app.get("/api/keywords", async (c) => {
  try {
    const limit = parseInt(c.req.query("limit") || "32");

    // Get top keywords ordered by article_count
    const keywords = await c.env.DB.prepare(`
      SELECT id, name, slug, type, article_count
      FROM keywords
      WHERE enabled = 1 AND article_count > 0
      ORDER BY article_count DESC
      LIMIT ?
    `).bind(limit).all();

    return c.json({
      keywords: keywords.results || [],
      total: keywords.results?.length || 0
    });
  } catch (error) {
    console.error("Error fetching keywords:", error);
    return c.json({ error: "Failed to fetch keywords" }, 500);
  }
});

// User-triggered refresh endpoint (with rate limiting)
// Simple in-memory rate limiter (use KV or D1 for production)
const refreshRateLimiter = new Map();

app.post("/api/refresh", async (c) => {
  try {
    // Get user identifier (session ID or user ID)
    const userId = c.req.header('x-session-id') || c.req.header('x-user-id') || 'anonymous';

    // Check rate limit (5 minutes between refreshes)
    const lastRefresh = refreshRateLimiter.get(userId);
    const now = Date.now();
    const rateLimitMs = 5 * 60 * 1000; // 5 minutes

    if (lastRefresh && (now - lastRefresh) < rateLimitMs) {
      const remainingMs = rateLimitMs - (now - lastRefresh);
      const remainingSec = Math.ceil(remainingMs / 1000);

      return c.json({
        error: "Rate limit exceeded",
        message: `Please wait ${remainingSec} seconds before refreshing again`,
        retryAfter: remainingSec
      }, 429);
    }

    // Update rate limiter
    refreshRateLimiter.set(userId, now);

    // Clean up old entries (older than 10 minutes)
    for (const [key, timestamp] of refreshRateLimiter.entries()) {
      if (now - timestamp > 10 * 60 * 1000) {
        refreshRateLimiter.delete(key);
      }
    }

    // Delegate to Python Worker for RSS collection
    const processingClient = new ProcessingClient(c.env.DATA_PROCESSOR);
    console.log('[USER_REFRESH] User-triggered refresh initiated by:', userId);

    const result = await processingClient.collectFeeds();

    // Track refresh in analytics
    if (c.env.NEWS_INTERACTIONS) {
      try {
        c.env.NEWS_INTERACTIONS.writeDataPoint({
          blobs: ['user_refresh', 'success', userId],
          doubles: [result.newArticles || 0],
          indexes: ['refresh_trigger']
        });
      } catch (analyticsError) {
        console.error('[USER_REFRESH] Analytics tracking failed:', analyticsError);
      }
    }

    return c.json({
      success: true,
      message: "Refresh completed",
      newArticles: result.newArticles || 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("[USER_REFRESH] Error during user refresh:", error);
    return c.json({
      error: "Failed to refresh",
      message: "An error occurred while refreshing articles"
    }, 500);
  }
});

// ===== PHASE 2: USER ENGAGEMENT APIs (REQUIRE AUTH) =====

// Article Like/Unlike - with real-time Durable Object updates
app.post("/api/articles/:id/like", async (c) => {
  try {
    const articleId = c.req.param("id");
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id') || 'anonymous';

    // Check if already liked
    const existing = await c.env.DB.prepare(`
      SELECT id FROM user_likes WHERE user_id = ? AND article_id = ?
    `).bind(userId, articleId).first();

    const isLiking = !existing;

    if (existing) {
      // Unlike
      await c.env.DB.prepare(`
        DELETE FROM user_likes WHERE user_id = ? AND article_id = ?
      `).bind(userId, articleId).run();

      await c.env.DB.prepare(`
        UPDATE articles SET like_count = like_count - 1 WHERE id = ?
      `).bind(articleId).run();
    } else {
      // Like
      await c.env.DB.prepare(`
        INSERT INTO user_likes (user_id, article_id) VALUES (?, ?)
      `).bind(userId, articleId).run();

      await c.env.DB.prepare(`
        UPDATE articles SET like_count = like_count + 1 WHERE id = ?
      `).bind(articleId).run();
    }

    // Update real-time counts via Durable Object
    try {
      const doId = c.env.ARTICLE_INTERACTIONS.idFromName(`article:${articleId}`);
      const stub = c.env.ARTICLE_INTERACTIONS.get(doId);
      await stub.fetch(new Request('https://do/like', {
        method: 'POST',
        body: JSON.stringify({ userId, type: isLiking ? 'like' : 'unlike' })
      }));
    } catch (doError) {
      console.warn('[LIKE] Durable Object update failed:', doError);
    }

    // Track in analytics
    if (c.env.NEWS_ANALYTICS) {
      try {
        c.env.NEWS_ANALYTICS.writeDataPoint({
          blobs: [isLiking ? 'article_like' : 'article_unlike', userId, articleId.toString()],
          doubles: [Date.now()],
          indexes: ['engagement']
        });
      } catch (analyticsError) {
        console.error('[LIKE] Analytics tracking failed:', analyticsError);
      }
    }

    return c.json({ success: true, liked: isLiking, message: isLiking ? "Article liked" : "Article unliked" });
  } catch (error) {
    console.error("[LIKE] Error:", error);
    return c.json({ error: "Failed to like article" }, 500);
  }
});

// Article Save/Bookmark - with real-time Durable Object updates
app.post("/api/articles/:id/save", async (c) => {
  try {
    const articleId = c.req.param("id");
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id') || 'anonymous';

    // Check if already saved
    const existing = await c.env.DB.prepare(`
      SELECT id FROM user_bookmarks WHERE user_id = ? AND article_id = ?
    `).bind(userId, articleId).first();

    const isSaving = !existing;

    if (existing) {
      // Unsave
      await c.env.DB.prepare(`
        DELETE FROM user_bookmarks WHERE user_id = ? AND article_id = ?
      `).bind(userId, articleId).run();

      await c.env.DB.prepare(`
        UPDATE articles SET bookmark_count = bookmark_count - 1 WHERE id = ?
      `).bind(articleId).run();
    } else {
      // Save
      await c.env.DB.prepare(`
        INSERT INTO user_bookmarks (user_id, article_id) VALUES (?, ?)
      `).bind(userId, articleId).run();

      await c.env.DB.prepare(`
        UPDATE articles SET bookmark_count = bookmark_count + 1 WHERE id = ?
      `).bind(articleId).run();
    }

    // Update real-time counts via Durable Object
    try {
      const doId = c.env.ARTICLE_INTERACTIONS.idFromName(`article:${articleId}`);
      const stub = c.env.ARTICLE_INTERACTIONS.get(doId);
      await stub.fetch(new Request('https://do/save', {
        method: 'POST',
        body: JSON.stringify({ userId, type: isSaving ? 'save' : 'unsave' })
      }));
    } catch (doError) {
      console.warn('[SAVE] Durable Object update failed:', doError);
    }

    // Track in analytics
    if (c.env.NEWS_ANALYTICS) {
      try {
        c.env.NEWS_ANALYTICS.writeDataPoint({
          blobs: [isSaving ? 'article_save' : 'article_unsave', userId, articleId.toString()],
          doubles: [Date.now()],
          indexes: ['engagement']
        });
      } catch (analyticsError) {
        console.error('[SAVE] Analytics tracking failed:', analyticsError);
      }
    }

    return c.json({ success: true, saved: isSaving, message: isSaving ? "Article bookmarked" : "Bookmark removed" });
  } catch (error) {
    console.error("[SAVE] Error:", error);
    return c.json({ error: "Failed to save article" }, 500);
  }
});

// Article View Tracking
app.post("/api/articles/:id/view", async (c) => {
  try {
    const articleId = c.req.param("id");
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id') || 'anonymous';

    const body = await c.req.json();
    const readingTime = body.reading_time || 0; // seconds
    const scrollDepth = body.scroll_depth || 0; // percentage 0-100

    // Insert or update reading history
    await c.env.DB.prepare(`
      INSERT INTO user_reading_history (user_id, article_id, reading_time, scroll_depth)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, article_id)
      DO UPDATE SET
        reading_time = reading_time + ?,
        scroll_depth = MAX(scroll_depth, ?),
        last_position_at = CURRENT_TIMESTAMP
    `).bind(userId, articleId, readingTime, scrollDepth, readingTime, scrollDepth).run();

    // Increment view count
    await c.env.DB.prepare(`
      UPDATE articles SET view_count = view_count + 1 WHERE id = ?
    `).bind(articleId).run();

    // Track in analytics
    if (c.env.NEWS_ANALYTICS) {
      try {
        c.env.NEWS_ANALYTICS.writeDataPoint({
          blobs: ['article_view', userId, articleId.toString()],
          doubles: [readingTime, scrollDepth],
          indexes: ['engagement']
        });
      } catch (analyticsError) {
        console.error('[VIEW] Analytics tracking failed:', analyticsError);
      }
    }

    return c.json({ success: true, message: "View tracked" });
  } catch (error) {
    console.error("[VIEW] Error:", error);
    return c.json({ error: "Failed to track view" }, 500);
  }
});

// Article Comment
app.post("/api/articles/:id/comment", async (c) => {
  try {
    const articleId = c.req.param("id");
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id') || 'anonymous';

    const body = await c.req.json();
    const content = body.content;
    const parentCommentId = body.parent_comment_id || null;

    if (!content || content.trim().length === 0) {
      return c.json({ error: "Comment content is required" }, 400);
    }

    if (content.length > 1000) {
      return c.json({ error: "Comment too long (max 1000 characters)" }, 400);
    }

    // Insert comment
    const result = await c.env.DB.prepare(`
      INSERT INTO article_comments (article_id, user_id, parent_comment_id, content, status)
      VALUES (?, ?, ?, ?, 'published')
    `).bind(articleId, userId, parentCommentId, content.trim()).run();

    // Note: Triggers will handle comment_count and reply_count updates

    // Track in analytics
    if (c.env.NEWS_ANALYTICS) {
      try {
        c.env.NEWS_ANALYTICS.writeDataPoint({
          blobs: ['article_comment', userId, articleId.toString()],
          doubles: [Date.now()],
          indexes: ['engagement']
        });
      } catch (analyticsError) {
        console.error('[COMMENT] Analytics tracking failed:', analyticsError);
      }
    }

    return c.json({
      success: true,
      commentId: result.meta.last_row_id,
      message: "Comment posted"
    });
  } catch (error) {
    console.error("[COMMENT] Error:", error);
    return c.json({ error: "Failed to post comment" }, 500);
  }
});

// Get Article Comments
app.get("/api/articles/:id/comments", async (c) => {
  try {
    const articleId = c.req.param("id");
    const limit = parseInt(c.req.query("limit") || "50");
    const offset = parseInt(c.req.query("offset") || "0");

    const comments = await c.env.DB.prepare(`
      SELECT
        id,
        article_id,
        user_id,
        parent_comment_id,
        content,
        like_count,
        reply_count,
        status,
        created_at,
        updated_at
      FROM article_comments
      WHERE article_id = ? AND status = 'published' AND parent_comment_id IS NULL
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(articleId, limit, offset).all();

    // Get replies for each comment
    for (const comment of comments.results) {
      const replies = await c.env.DB.prepare(`
        SELECT
          id,
          article_id,
          user_id,
          parent_comment_id,
          content,
          like_count,
          reply_count,
          status,
          created_at,
          updated_at
        FROM article_comments
        WHERE parent_comment_id = ? AND status = 'published'
        ORDER BY created_at ASC
        LIMIT 10
      `).bind(comment.id).all();

      (comment as any).replies = replies.results;
    }

    return c.json({
      comments: comments.results,
      total: comments.results.length,
      limit,
      offset
    });
  } catch (error) {
    console.error("[COMMENTS] Error:", error);
    return c.json({ error: "Failed to fetch comments" }, 500);
  }
});

// User Preferences - GET
app.get("/api/user/me/preferences", async (c) => {
  try {
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id') || 'anonymous';

    // Get user preferences
    const prefs = await c.env.DB.prepare(`
      SELECT preference_key, preference_value
      FROM user_preferences
      WHERE user_id = ?
    `).bind(userId).all();

    const preferences: Record<string, unknown> = {};
    for (const pref of prefs.results as Array<{ preference_key: string; preference_value: unknown }>) {
      preferences[pref.preference_key] = pref.preference_value;
    }

    // Get followed sources
    const followedSources = await c.env.DB.prepare(`
      SELECT follow_id as source_id, created_at
      FROM user_follows
      WHERE user_id = ? AND follow_type = 'source'
    `).bind(userId).all();

    // Get followed authors
    const followedAuthors = await c.env.DB.prepare(`
      SELECT follow_id as author_id, created_at
      FROM user_follows
      WHERE user_id = ? AND follow_type = 'author'
    `).bind(userId).all();

    // Get reading habits
    const readingStats = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as articles_read,
        SUM(reading_time) as total_reading_time,
        AVG(scroll_depth) as avg_scroll_depth
      FROM user_reading_history
      WHERE user_id = ?
    `).bind(userId).first();

    return c.json({
      preferences,
      followed_sources: followedSources.results,
      followed_authors: followedAuthors.results,
      reading_stats: readingStats
    });
  } catch (error) {
    console.error("[PREFERENCES_GET] Error:", error);
    return c.json({ error: "Failed to fetch preferences" }, 500);
  }
});

// User Preferences - UPDATE
app.post("/api/user/me/preferences", async (c) => {
  try {
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id') || 'anonymous';
    const body = await c.req.json();

    // Update or insert preferences
    for (const [key, value] of Object.entries(body)) {
      await c.env.DB.prepare(`
        INSERT INTO user_preferences (user_id, preference_key, preference_value)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, preference_key)
        DO UPDATE SET preference_value = ?, updated_at = CURRENT_TIMESTAMP
      `).bind(userId, key, value, value).run();
    }

    return c.json({ success: true, message: "Preferences updated" });
  } catch (error) {
    console.error("[PREFERENCES_UPDATE] Error:", error);
    return c.json({ error: "Failed to update preferences" }, 500);
  }
});

// Follow Source/Author
app.post("/api/user/me/follows", async (c) => {
  try {
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id') || 'anonymous';
    const body = await c.req.json();

    const followType = body.follow_type; // 'source' or 'author'
    const followId = body.follow_id;

    if (!['source', 'author', 'category'].includes(followType)) {
      return c.json({ error: "Invalid follow_type. Must be 'source', 'author', or 'category'" }, 400);
    }

    if (!followId) {
      return c.json({ error: "follow_id is required" }, 400);
    }

    // Insert follow
    await c.env.DB.prepare(`
      INSERT INTO user_follows (user_id, follow_type, follow_id)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, follow_type, follow_id) DO NOTHING
    `).bind(userId, followType, followId).run();

    // Track in analytics
    if (c.env.USER_ANALYTICS) {
      try {
        c.env.USER_ANALYTICS.writeDataPoint({
          blobs: ['user_follow', userId, followType, followId],
          doubles: [Date.now()],
          indexes: ['follows']
        });
      } catch (analyticsError) {
        console.error('[FOLLOW] Analytics tracking failed:', analyticsError);
      }
    }

    return c.json({ success: true, message: `Now following ${followType}` });
  } catch (error) {
    console.error("[FOLLOW] Error:", error);
    return c.json({ error: "Failed to follow" }, 500);
  }
});

// Unfollow Source/Author
app.delete("/api/user/me/follows/:type/:id", async (c) => {
  try {
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id') || 'anonymous';
    const followType = c.req.param("type");
    const followId = c.req.param("id");

    if (!['source', 'author', 'category'].includes(followType)) {
      return c.json({ error: "Invalid follow_type" }, 400);
    }

    // Delete follow
    await c.env.DB.prepare(`
      DELETE FROM user_follows
      WHERE user_id = ? AND follow_type = ? AND follow_id = ?
    `).bind(userId, followType, followId).run();

    // Track in analytics
    if (c.env.USER_ANALYTICS) {
      try {
        c.env.USER_ANALYTICS.writeDataPoint({
          blobs: ['user_unfollow', userId, followType, followId],
          doubles: [Date.now()],
          indexes: ['follows']
        });
      } catch (analyticsError) {
        console.error('[UNFOLLOW] Analytics tracking failed:', analyticsError);
      }
    }

    return c.json({ success: true, message: `Unfollowed ${followType}` });
  } catch (error) {
    console.error("[UNFOLLOW] Error:", error);
    return c.json({ error: "Failed to unfollow" }, 500);
  }
});

// Get user's followed authors
app.get("/api/user/me/follows/authors", async (c) => {
  try {
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id');
    if (!userId) {
      return c.json({ authors: [], message: "No user session" });
    }

    const limit = parseInt(c.req.query("limit") || "50");
    const offset = parseInt(c.req.query("offset") || "0");

    const result = await c.env.DB.prepare(`
      SELECT a.id, a.name, a.slug, a.normalized_name, a.bio, a.profile_image_url,
             a.follower_count, a.article_count, a.is_verified,
             uf.followed_at
      FROM user_follows uf
      JOIN authors a ON uf.follow_id = CAST(a.id AS TEXT)
      WHERE uf.user_id = ? AND uf.follow_type = 'author'
      ORDER BY uf.followed_at DESC
      LIMIT ? OFFSET ?
    `).bind(userId, limit, offset).all();

    return c.json({
      authors: result.results || [],
      total: result.results?.length || 0,
      limit,
      offset
    });
  } catch (error) {
    console.error("[FOLLOWS_AUTHORS] Error:", error);
    return c.json({ error: "Failed to fetch followed authors" }, 500);
  }
});

// Get user's followed sources
app.get("/api/user/me/follows/sources", async (c) => {
  try {
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id');
    if (!userId) {
      return c.json({ sources: [], message: "No user session" });
    }

    const limit = parseInt(c.req.query("limit") || "50");
    const offset = parseInt(c.req.query("offset") || "0");

    const result = await c.env.DB.prepare(`
      SELECT ns.id, ns.name, ns.slug, ns.logo_url, ns.website_url,
             ns.follower_count, ns.article_count, ns.country_id,
             uf.followed_at
      FROM user_follows uf
      JOIN news_sources ns ON uf.follow_id = ns.id
      WHERE uf.user_id = ? AND uf.follow_type = 'source'
      ORDER BY uf.followed_at DESC
      LIMIT ? OFFSET ?
    `).bind(userId, limit, offset).all();

    return c.json({
      sources: result.results || [],
      total: result.results?.length || 0,
      limit,
      offset
    });
  } catch (error) {
    console.error("[FOLLOWS_SOURCES] Error:", error);
    return c.json({ error: "Failed to fetch followed sources" }, 500);
  }
});

// Get user's followed categories
app.get("/api/user/me/follows/categories", async (c) => {
  try {
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id');
    if (!userId) {
      return c.json({ categories: [], message: "No user session" });
    }

    const result = await c.env.DB.prepare(`
      SELECT c.id, c.name, c.emoji, c.color, c.description,
             uf.followed_at
      FROM user_follows uf
      JOIN categories c ON uf.follow_id = c.id
      WHERE uf.user_id = ? AND uf.follow_type = 'category'
      ORDER BY uf.followed_at DESC
    `).bind(userId).all();

    return c.json({
      categories: result.results || []
    });
  } catch (error) {
    console.error("[FOLLOWS_CATEGORIES] Error:", error);
    return c.json({ error: "Failed to fetch followed categories" }, 500);
  }
});

// Get all user follows (combined)
app.get("/api/user/me/follows", async (c) => {
  try {
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id');
    if (!userId) {
      return c.json({ follows: { authors: [], sources: [], categories: [] }, message: "No user session" });
    }

    const result = await c.env.DB.prepare(`
      SELECT follow_type, follow_id, followed_at
      FROM user_follows
      WHERE user_id = ?
      ORDER BY followed_at DESC
    `).bind(userId).all();

    const follows = {
      authors: [] as string[],
      sources: [] as string[],
      categories: [] as string[]
    };

    for (const row of result.results || []) {
      const r = row as { follow_type: string; follow_id: string };
      if (r.follow_type === 'author') follows.authors.push(r.follow_id);
      else if (r.follow_type === 'source') follows.sources.push(r.follow_id);
      else if (r.follow_type === 'category') follows.categories.push(r.follow_id);
    }

    return c.json({ follows });
  } catch (error) {
    console.error("[FOLLOWS_ALL] Error:", error);
    return c.json({ error: "Failed to fetch follows" }, 500);
  }
});

// ===== COUNTRY ENDPOINTS (Pan-African Support) =====

// Get all available countries
app.get("/api/countries", async (c) => {
  try {
    const withStats = c.req.query("withStats") === "true";
    const countryService = new CountryService(c.env.DB);

    const countries = await countryService.getCountries({
      enabledOnly: true,
      withStats,
    });

    return c.json({ countries });
  } catch (error) {
    console.error("[COUNTRIES] Error fetching countries:", error);
    return c.json({ error: "Failed to fetch countries" }, 500);
  }
});

// Get a single country with details
app.get("/api/countries/:countryId", async (c) => {
  try {
    const countryId = c.req.param("countryId");
    const countryService = new CountryService(c.env.DB);

    const result = await countryService.getCountryWithDetails(countryId);

    if (!result.country) {
      return c.json({ error: "Country not found" }, 404);
    }

    return c.json(result);
  } catch (error) {
    console.error("[COUNTRIES] Error fetching country:", error);
    return c.json({ error: "Failed to fetch country" }, 500);
  }
});

// Get user's country preferences
app.get("/api/user/me/countries", async (c) => {
  try {
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id');

    if (!userId) {
      return c.json({ error: "User not authenticated" }, 401);
    }

    const countryService = new CountryService(c.env.DB);
    const preferences = await countryService.getUserCountryPreferences(userId);

    return c.json({
      countries: preferences.countries,
      primaryCountry: preferences.primaryCountry,
    });
  } catch (error) {
    console.error("[USER_COUNTRIES] Error:", error);
    return c.json({ error: "Failed to fetch country preferences" }, 500);
  }
});

// Set user's country preferences (replaces all)
app.put("/api/user/me/countries", async (c) => {
  try {
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id');

    if (!userId) {
      return c.json({ error: "User not authenticated" }, 401);
    }

    const body = await c.req.json();
    const { countries } = body;

    if (!Array.isArray(countries)) {
      return c.json({ error: "countries must be an array" }, 400);
    }

    const countryService = new CountryService(c.env.DB);
    const result = await countryService.setUserCountryPreferences(userId, countries);

    if (!result.success) {
      return c.json({ error: result.error }, 400);
    }

    // Track in analytics
    if (c.env.USER_ANALYTICS) {
      try {
        c.env.USER_ANALYTICS.writeDataPoint({
          blobs: ['country_preferences_updated', userId, JSON.stringify(countries.map(c => c.countryId))],
          doubles: [Date.now(), countries.length],
          indexes: ['countries']
        });
      } catch (analyticsError) {
        console.error('[COUNTRIES] Analytics tracking failed:', analyticsError);
      }
    }

    return c.json({ success: true, message: "Country preferences updated" });
  } catch (error) {
    console.error("[USER_COUNTRIES] Error:", error);
    return c.json({ error: "Failed to update country preferences" }, 500);
  }
});

// Add a country to user's preferences
app.post("/api/user/me/countries", async (c) => {
  try {
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id');

    if (!userId) {
      return c.json({ error: "User not authenticated" }, 401);
    }

    const body = await c.req.json();
    const { countryId, isPrimary, notifyBreaking } = body;

    if (!countryId) {
      return c.json({ error: "countryId is required" }, 400);
    }

    const countryService = new CountryService(c.env.DB);
    const result = await countryService.addUserCountry(userId, countryId, {
      isPrimary,
      notifyBreaking,
    });

    if (!result.success) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({ success: true, message: `Added ${countryId} to preferences` });
  } catch (error) {
    console.error("[USER_COUNTRIES] Error:", error);
    return c.json({ error: "Failed to add country" }, 500);
  }
});

// Remove a country from user's preferences
app.delete("/api/user/me/countries/:countryId", async (c) => {
  try {
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id');

    if (!userId) {
      return c.json({ error: "User not authenticated" }, 401);
    }

    const countryId = c.req.param("countryId");
    const countryService = new CountryService(c.env.DB);
    const result = await countryService.removeUserCountry(userId, countryId);

    return c.json({ success: result.success });
  } catch (error) {
    console.error("[USER_COUNTRIES] Error:", error);
    return c.json({ error: "Failed to remove country" }, 500);
  }
});

// Set user's primary country
app.put("/api/user/me/countries/:countryId/primary", async (c) => {
  try {
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id');

    if (!userId) {
      return c.json({ error: "User not authenticated" }, 401);
    }

    const countryId = c.req.param("countryId");
    const countryService = new CountryService(c.env.DB);
    const result = await countryService.setUserPrimaryCountry(userId, countryId);

    if (!result.success) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({ success: true, message: `Set ${countryId} as primary country` });
  } catch (error) {
    console.error("[USER_COUNTRIES] Error:", error);
    return c.json({ error: "Failed to set primary country" }, 500);
  }
});

// Get article counts by country (for stats)
app.get("/api/countries/stats/articles", async (c) => {
  try {
    const since = c.req.query("since");
    const countryService = new CountryService(c.env.DB);

    const stats = await countryService.getArticleCountsByCountry({ since });

    return c.json({ stats });
  } catch (error) {
    console.error("[COUNTRIES] Error fetching stats:", error);
    return c.json({ error: "Failed to fetch country stats" }, 500);
  }
});

// ===== ADMIN ENDPOINTS (PROTECTED - TODO: Re-enable auth) =====

// AI Pipeline monitoring and author recognition endpoints
// TODO: Add authentication back when OpenAuthService is fixed
app.get("/api/admin/ai-pipeline-status", async (c) => {
  try {
    const services = initializeServices(c.env);
    
    // Get AI processing statistics
    const aiStats = await services.d1Service.db.prepare(`
      SELECT 
        processing_type,
        status,
        COUNT(*) as count,
        AVG(processing_time) as avg_time,
        MAX(created_at) as last_processed
      FROM ai_processing_log 
      WHERE created_at > datetime('now', '-24 hours')
      GROUP BY processing_type, status
      ORDER BY processing_type, status
    `).all();
    
    // Get author extraction statistics
    const authorStats = await services.d1Service.db.prepare(`
      SELECT 
        COUNT(DISTINCT a.id) as total_authors,
        COUNT(DISTINCT CASE WHEN a.verification_status = 'verified' THEN a.id END) as verified_authors,
        COUNT(DISTINCT aa.article_id) as articles_with_authors,
        AVG(aa.confidence_score) as avg_confidence
      FROM authors a
      LEFT JOIN article_authors aa ON a.id = aa.author_id
    `).first();
    
    // Get keyword extraction statistics  
    const keywordStats = await services.d1Service.db.prepare(`
      SELECT 
        COUNT(DISTINCT k.id) as total_keywords,
        COUNT(DISTINCT ak.article_id) as articles_with_keywords,
        AVG(ak.confidence_score) as avg_keyword_confidence,
        MAX(k.usage_count) as most_used_keyword_count
      FROM keywords k
      LEFT JOIN article_keywords ak ON k.id = ak.keyword_id
    `).first();
    
    // Get quality scoring statistics
    const qualityStats = await services.d1Service.db.prepare(`
      SELECT 
        COUNT(*) as articles_scored,
        AVG(quality_score) as avg_quality,
        COUNT(CASE WHEN quality_score > 0.8 THEN 1 END) as high_quality_count,
        COUNT(CASE WHEN quality_score < 0.5 THEN 1 END) as low_quality_count
      FROM articles 
      WHERE quality_score IS NOT NULL
    `).first();
    
    return c.json({
      ai_processing: aiStats.results,
      author_recognition: {
        total_authors: authorStats.total_authors || 0,
        verified_authors: authorStats.verified_authors || 0,
        articles_with_authors: authorStats.articles_with_authors || 0,
        avg_confidence: authorStats.avg_confidence || 0
      },
      keyword_extraction: {
        total_keywords: keywordStats.total_keywords || 0,
        articles_with_keywords: keywordStats.articles_with_keywords || 0,
        avg_confidence: keywordStats.avg_keyword_confidence || 0,
        most_used_count: keywordStats.most_used_keyword_count || 0
      },
      quality_assessment: {
        articles_scored: qualityStats.articles_scored || 0,
        avg_quality: qualityStats.avg_quality || 0,
        high_quality_count: qualityStats.high_quality_count || 0,
        low_quality_count: qualityStats.low_quality_count || 0
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error fetching AI pipeline status:", error);
    return c.json({ error: "Failed to fetch AI pipeline status" }, 500);
  }
});

// AI Testing endpoint - test AI functionality
app.post("/api/admin/ai-test", async (c) => {
  try {
    const services = initializeServices(c.env);
    const body = await c.req.json().catch(() => ({}));
    const testText = body.text || "Zimbabwe's economy shows signs of recovery as the government implements new fiscal policies to stabilize the currency and attract foreign investment.";
    const testTitle = body.title || "Zimbabwe Economy Shows Recovery Signs";

    const results: {
      ai_available: boolean;
      tests: Array<{
        name: string;
        status: 'passed' | 'failed' | 'skipped';
        duration_ms: number;
        result?: any;
        error?: string;
      }>;
      summary: {
        total: number;
        passed: number;
        failed: number;
        skipped: number;
      };
      timestamp: string;
    } = {
      ai_available: false,
      tests: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
      timestamp: new Date().toISOString()
    };

    // Test 1: Check AI binding availability
    const aiCheckStart = Date.now();
    try {
      if (!c.env.AI) {
        throw new Error("AI binding not configured");
      }
      results.ai_available = true;
      results.tests.push({
        name: "AI Binding Check",
        status: 'passed',
        duration_ms: Date.now() - aiCheckStart,
        result: { message: "AI binding is available" }
      });
    } catch (error) {
      results.tests.push({
        name: "AI Binding Check",
        status: 'failed',
        duration_ms: Date.now() - aiCheckStart,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }

    // Test 2: Simple AI inference test
    const inferenceStart = Date.now();
    try {
      if (!results.ai_available) {
        results.tests.push({
          name: "Basic AI Inference",
          status: 'skipped',
          duration_ms: 0,
          error: "Skipped due to AI binding unavailable"
        });
      } else {
        const response = await c.env.AI.run('@cf/meta/llama-3-8b-instruct', {
          prompt: "Say 'AI is working' if you receive this message:",
          max_tokens: 10
        });

        results.tests.push({
          name: "Basic AI Inference",
          status: response?.response ? 'passed' : 'failed',
          duration_ms: Date.now() - inferenceStart,
          result: {
            response: response?.response?.substring(0, 100) || "No response",
            model: "@cf/meta/llama-3-8b-instruct"
          }
        });
      }
    } catch (error) {
      results.tests.push({
        name: "Basic AI Inference",
        status: 'failed',
        duration_ms: Date.now() - inferenceStart,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }

    // Test 3: Content cleaning test (via Python Worker)
    const processingClient = new ProcessingClient(c.env.DATA_PROCESSOR);
    const cleaningStart = Date.now();
    try {
      const dirtyContent = `${testText} <img src="test.jpg"/> ~~random~~ chars!!! http://example.com/image.png ADVERTISEMENT`;
      const cleanResult = await processingClient.cleanContent(dirtyContent, {
        removeImages: true,
        extractImageUrls: true,
        minContentLength: 50
      });

      results.tests.push({
        name: "Content Cleaning (Python Worker)",
        status: cleanResult.cleaned_content.length > 0 ? 'passed' : 'failed',
        duration_ms: Date.now() - cleaningStart,
        result: {
          original_length: dirtyContent.length,
          cleaned_length: cleanResult.cleaned_content.length,
          removed_chars: cleanResult.removed_char_count,
          extracted_images: cleanResult.extracted_images.length,
          sample: cleanResult.cleaned_content.substring(0, 200)
        }
      });
    } catch (error) {
      results.tests.push({
        name: "Content Cleaning (Python Worker)",
        status: 'failed',
        duration_ms: Date.now() - cleaningStart,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }

    // Test 4: Keyword extraction test (via Python Worker)
    const keywordStart = Date.now();
    try {
      const kwResult = await processingClient.extractKeywords(testTitle, testText, 'politics');

      results.tests.push({
        name: "Keyword Extraction (Python Worker)",
        status: kwResult.keywords && kwResult.keywords.length > 0 ? 'passed' : 'failed',
        duration_ms: Date.now() - keywordStart,
        result: {
          keyword_count: kwResult.keywords?.length || 0,
          keywords: kwResult.keywords?.slice(0, 5).map((k: any) => ({
            keyword: k.keyword,
            confidence: k.confidence,
            category: k.category
          }))
        }
      });
    } catch (error) {
      results.tests.push({
        name: "Keyword Extraction (Python Worker)",
        status: 'failed',
        duration_ms: Date.now() - keywordStart,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }

    // Test 5: Quality scoring test (via Python Worker)
    const qualityStart = Date.now();
    try {
      const qualityResult = await processingClient.scoreQuality(testTitle, testText);

      results.tests.push({
        name: "Quality Scoring (Python Worker)",
        status: typeof qualityResult.quality_score === 'number' ? 'passed' : 'failed',
        duration_ms: Date.now() - qualityStart,
        result: {
          quality_score: qualityResult.quality_score,
          quality_rating: qualityResult.quality_score > 0.8 ? 'Excellent' : qualityResult.quality_score > 0.6 ? 'Good' : qualityResult.quality_score > 0.4 ? 'Fair' : 'Needs Improvement'
        }
      });
    } catch (error) {
      results.tests.push({
        name: "Quality Scoring (Python Worker)",
        status: 'failed',
        duration_ms: Date.now() - qualityStart,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }

    // Calculate summary
    results.summary.total = results.tests.length;
    results.summary.passed = results.tests.filter(t => t.status === 'passed').length;
    results.summary.failed = results.tests.filter(t => t.status === 'failed').length;
    results.summary.skipped = results.tests.filter(t => t.status === 'skipped').length;

    return c.json(results);
  } catch (error) {
    console.error("Error running AI tests:", error);
    return c.json({ error: "Failed to run AI tests", details: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

// Author recognition and journalism tracking
// TODO: Add authentication back when OpenAuthService is fixed
app.get("/api/admin/authors", async (c) => {
  try {
    const services = initializeServices(c.env);
    const limit = parseInt(c.req.query("limit") || "20");
    const outlet = c.req.query("outlet");
    
    let query = `
      SELECT 
        a.*,
        COUNT(DISTINCT aa.article_id) as article_count,
        AVG(ar.quality_score) as avg_article_quality,
        MAX(ar.published_at) as last_article_date
      FROM authors a
      LEFT JOIN article_authors aa ON a.id = aa.author_id
      LEFT JOIN articles ar ON aa.article_id = ar.id
    `;
    
    const params = [];
    if (outlet) {
      query += ` WHERE a.outlet = ?`;
      params.push(outlet);
    }
    
    query += `
      GROUP BY a.id
      ORDER BY article_count DESC, a.created_at DESC
      LIMIT ?
    `;
    params.push(limit);
    
    const authors = await services.d1Service.db.prepare(query).bind(...params).all();
    
    // Get outlets summary
    const outlets = await services.d1Service.db.prepare(`
      SELECT 
        outlet,
        COUNT(*) as author_count,
        SUM(article_count) as total_articles
      FROM authors 
      WHERE outlet IS NOT NULL
      GROUP BY outlet
      ORDER BY author_count DESC
    `).all();
    
    return c.json({
      authors: authors.results,
      outlets: outlets.results,
      recognition_message: "Celebrating Zimbabwe journalism through author recognition and byline tracking"
    });
  } catch (error) {
    console.error("Error fetching authors:", error);
    return c.json({ error: "Failed to fetch authors" }, 500);
  }
});

// Content quality insights
// TODO: Add authentication back when OpenAuthService is fixed
app.get("/api/admin/content-quality", async (c) => {
  try {
    const services = initializeServices(c.env);
    
    // Quality distribution
    const qualityDistribution = await services.d1Service.db.prepare(`
      SELECT 
        CASE 
          WHEN quality_score >= 0.8 THEN 'Excellent'
          WHEN quality_score >= 0.6 THEN 'Good'  
          WHEN quality_score >= 0.4 THEN 'Fair'
          ELSE 'Needs Improvement'
        END as quality_tier,
        COUNT(*) as count,
        AVG(quality_score) as avg_score
      FROM articles 
      WHERE quality_score IS NOT NULL
      GROUP BY quality_tier
      ORDER BY avg_score DESC
    `).all();
    
    // Top quality articles by category
    const topByCategory = await services.d1Service.db.prepare(`
      SELECT 
        category,
        title,
        quality_score,
        published_at,
        (SELECT name FROM authors WHERE id = (
          SELECT author_id FROM article_authors WHERE article_id = articles.id LIMIT 1
        )) as author_name
      FROM articles 
      WHERE quality_score IS NOT NULL
      ORDER BY quality_score DESC
      LIMIT 10
    `).all();
    
    return c.json({
      quality_distribution: qualityDistribution.results,
      top_quality_articles: topByCategory.results,
      ai_enhancements: {
        content_cleaning: "Active - removing image URLs and noise",
        grammar_assessment: "Active - AI grammar scoring",
        readability_analysis: "Active - readability metrics",
        headline_optimization: "Active - headline quality scoring"
      }
    });
  } catch (error) {
    console.error("Error fetching content quality data:", error);
    return c.json({ error: "Failed to fetch content quality data" }, 500);
  }
});

// ===== AUTHOR PROFILE & SOCIAL FEATURES =====

// Individual author profile pages (auto-generated)
app.get("/api/author/:slug", async (c) => {
  try {
    const services = initializeServices(c.env);
    const slug = c.req.param("slug");
    
    const profile = await services.authorProfileService.getAuthorProfile(slug);
    
    if (!profile) {
      return c.json({ error: "Author not found" }, 404);
    }
    
    // Track profile view
    await services.authorProfileService.trackProfileInteraction(
      profile.id,
      'view',
      undefined, // userId would come from auth
      {
        ipAddress: c.req.header('cf-connecting-ip'),
        userAgent: c.req.header('user-agent'),
        referrer: c.req.header('referer')
      }
    );
    
    return c.json({
      author: profile,
      journalism_recognition: "Celebrating Zimbabwe journalism through comprehensive author profiles",
      profile_features: [
        "Cross-outlet author tracking",
        "Article quality scoring",
        "Professional credibility metrics",
        "Social engagement tracking",
        "Follow functionality"
      ]
    });
  } catch (error) {
    console.error("Error fetching author profile:", error);
    return c.json({ error: "Failed to fetch author profile" }, 500);
  }
});

// Follow/unfollow an author
app.post("/api/author/:authorId/follow", async (c) => {
  try {
    const services = initializeServices(c.env);
    const authorId = parseInt(c.req.param("authorId"));

    // Get userId from headers - supports anonymous session-based engagement
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id') || 'anonymous';

    const result = await services.authorProfileService.toggleAuthorFollow(userId, authorId);

    return c.json(result);
  } catch (error) {
    console.error("Error toggling author follow:", error);
    return c.json({ error: "Failed to update follow status" }, 500);
  }
});

// Follow/unfollow a news source
app.post("/api/source/:sourceId/follow", async (c) => {
  try {
    const services = initializeServices(c.env);
    const sourceId = c.req.param("sourceId");

    // Get userId from headers - supports anonymous session-based engagement
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id') || 'anonymous';

    const result = await services.authorProfileService.toggleSourceFollow(userId, sourceId);

    return c.json(result);
  } catch (error) {
    console.error("Error toggling source follow:", error);
    return c.json({ error: "Failed to update follow status" }, 500);
  }
});

// Featured authors showcase
app.get("/api/featured-authors", async (c) => {
  try {
    const services = initializeServices(c.env);
    const limit = parseInt(c.req.query("limit") || "10");
    
    const authors = await services.authorProfileService.getFeaturedAuthors(limit);
    
    return c.json({
      featured_authors: authors,
      message: "Showcasing Zimbabwe's leading journalists and their contributions to news coverage"
    });
  } catch (error) {
    console.error("Error fetching featured authors:", error);
    return c.json({ error: "Failed to fetch featured authors" }, 500);
  }
});

// Trending authors based on recent engagement
app.get("/api/trending-authors", async (c) => {
  try {
    const services = initializeServices(c.env);
    const days = parseInt(c.req.query("days") || "7");
    const limit = parseInt(c.req.query("limit") || "10");
    
    const authors = await services.authorProfileService.getTrendingAuthors(days, limit);
    
    return c.json({
      trending_authors: authors,
      timeframe: `${days} days`,
      message: "Authors trending based on recent articles and reader engagement"
    });
  } catch (error) {
    console.error("Error fetching trending authors:", error);
    return c.json({ error: "Failed to fetch trending authors" }, 500);
  }
});

// Search authors across outlets
app.get("/api/search/authors", async (c) => {
  try {
    const services = initializeServices(c.env);
    const query = c.req.query("q");
    const limit = parseInt(c.req.query("limit") || "20");
    
    if (!query) {
      return c.json({ error: "Search query required" }, 400);
    }
    
    const authors = await services.authorProfileService.searchAuthors(query, limit);
    
    return c.json({
      authors,
      query,
      total: authors.length,
      cross_outlet_search: "Search includes authors across all Zimbabwe news outlets"
    });
  } catch (error) {
    console.error("Error searching authors:", error);
    return c.json({ error: "Failed to search authors" }, 500);
  }
});

// Enhanced author management for admin (with cross-outlet view)
// TODO: Add authentication back when OpenAuthService is fixed
app.get("/api/admin/authors/detailed", async (c) => {
  try {
    const services = initializeServices(c.env);
    const limit = parseInt(c.req.query("limit") || "50");
    const outlet = c.req.query("outlet");
    const verified = c.req.query("verified");
    
    let query = `
      SELECT 
        a.*,
        COUNT(DISTINCT ao.outlet_id) as outlet_count,
        COUNT(DISTINCT aa.article_id) as total_articles,
        AVG(ar.quality_score) as avg_quality,
        MAX(ar.published_at) as last_article,
        GROUP_CONCAT(DISTINCT ns.name) as outlets_list
      FROM authors a
      LEFT JOIN author_outlets ao ON a.id = ao.author_id
      LEFT JOIN article_authors aa ON a.id = aa.author_id
      LEFT JOIN articles ar ON aa.article_id = ar.id
      LEFT JOIN news_sources ns ON ao.outlet_id = ns.id
    `;
    
    const params = [];
    const conditions = [];
    
    if (outlet) {
      conditions.push('ao.outlet_id = ?');
      params.push(outlet);
    }
    
    if (verified !== undefined) {
      conditions.push('a.is_verified = ?');
      params.push(verified === 'true' ? 1 : 0);
    }
    
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    
    query += `
      GROUP BY a.id
      ORDER BY total_articles DESC, a.follower_count DESC
      LIMIT ?
    `;
    params.push(limit);
    
    const authors = await services.d1Service.db.prepare(query).bind(...params).all();
    
    // Get deduplication stats
    const deduplicationStats = await services.d1Service.db.prepare(`
      SELECT 
        COUNT(DISTINCT a.normalized_name) as unique_authors,
        COUNT(*) as total_records,
        COUNT(CASE WHEN outlet_count > 1 THEN 1 END) as cross_outlet_authors
      FROM (
        SELECT 
          a.normalized_name,
          COUNT(DISTINCT ao.outlet_id) as outlet_count
        FROM authors a
        LEFT JOIN author_outlets ao ON a.id = ao.author_id
        GROUP BY a.normalized_name
      ) a
    `).first();
    
    return c.json({
      authors: authors.results,
      deduplication_stats: deduplicationStats,
      cross_outlet_tracking: "Authors are deduplicated across all news outlets",
      features: [
        "Smart author deduplication",
        "Cross-outlet article tracking", 
        "Professional credibility scoring",
        "Social engagement metrics",
        "Automated profile generation"
      ]
    });
  } catch (error) {
    console.error("Error fetching detailed authors:", error);
    return c.json({ error: "Failed to fetch detailed authors" }, 500);
  }
});

// Category management with author expertise tracking
// TODO: Add authentication back when OpenAuthService is fixed
app.get("/api/admin/categories/with-authors", async (c) => {
  try {
    const services = initializeServices(c.env);
    
    // Get categories with author expertise data
    const categories = await services.d1Service.db.prepare(`
      SELECT 
        c.*,
        COUNT(DISTINCT ace.author_id) as expert_authors,
        COUNT(DISTINCT aa.article_id) as total_articles,
        AVG(ace.avg_quality_score) as category_quality,
        GROUP_CONCAT(DISTINCT a.name) as top_authors
      FROM categories c
      LEFT JOIN author_category_expertise ace ON c.id = ace.category_id
      LEFT JOIN authors a ON ace.author_id = a.id AND ace.expertise_level IN ('expert', 'specialist')
      LEFT JOIN article_authors aa ON a.id = aa.author_id
      LEFT JOIN articles ar ON aa.article_id = ar.id AND ar.category = c.id
      GROUP BY c.id
      ORDER BY expert_authors DESC, total_articles DESC
    `).all();
    
    // Get category managers
    const managers = await services.d1Service.db.prepare(`
      SELECT 
        cm.category_id,
        u.username as manager_name,
        cm.manager_type,
        cm.permissions
      FROM category_managers cm
      JOIN users u ON cm.user_id = u.id
      ORDER BY cm.category_id, cm.manager_type
    `).all();
    
    const managersByCategory: Record<string, Array<unknown>> = {};
    for (const manager of managers.results as Array<{ category_id: string; manager_name: string; manager_type: string; permissions: string }>) {
      if (!managersByCategory[manager.category_id]) {
        managersByCategory[manager.category_id] = [];
      }
      managersByCategory[manager.category_id].push(manager);
    }
    
    const categoriesWithManagers = categories.results.map((category: any) => ({
      ...category,
      managers: managersByCategory[category.id] || [],
      top_authors: category.top_authors ? category.top_authors.split(',').slice(0, 5) : []
    }));
    
    return c.json({
      categories: categoriesWithManagers,
      author_expertise_tracking: "Categories track author expertise and specialization",
      management_features: [
        "Author expertise by category",
        "Category manager assignments",
        "Quality scoring by category",
        "Editorial oversight tools"
      ]
    });
  } catch (error) {
    console.error("Error fetching categories with authors:", error);
    return c.json({ error: "Failed to fetch categories with authors" }, 500);
  }
});

// Dynamic PWA manifest with full category management
app.get("/api/manifest.json", async (c) => {
  try {
    const services = initializeServices(c.env);
    const categories = await services.d1Service.getCategories();
    
    const shortcuts = categories
      .filter(cat => cat.id !== 'all' && cat.enabled)
      .slice(0, 4) // PWA spec recommends max 4 shortcuts
      .map(category => ({
        name: `${category.emoji || '📰'} ${category.name}`,
        url: `/?category=${category.id}`,
        description: `Browse ${category.name.toLowerCase()} news`
      }));

    const manifest = {
      name: "Mukoko News",
      short_name: "Mukoko News",
      description: "Zimbabwe's Modern News Platform",
      start_url: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#00A651",
      icons: [
        {
          src: "/icon-192x192.png",
          sizes: "192x192",
          type: "image/png"
        },
        {
          src: "/icon-512x512.png",
          sizes: "512x512",
          type: "image/png"
        }
      ],
      shortcuts,
      categories: ["news", "lifestyle", "business"],
      lang: "en",
      dir: "ltr",
      orientation: "portrait-primary"
    };

    c.header("Content-Type", "application/manifest+json");
    c.header("Cache-Control", "public, max-age=3600"); // Cache for 1 hour
    
    // Track manifest generation
    await services.analyticsService.trackEvent('manifest_generated', {
      shortcuts: shortcuts.length,
      categories: categories.length
    });
    
    return c.json(manifest);
  } catch (error) {
    console.error("Error generating manifest:", error);
    return c.json({ error: "Failed to generate manifest" }, 500);
  }
});

// ===== CATEGORY MANAGEMENT ENDPOINTS (Using CategoryManager) =====

// Get category insights and analytics
app.get("/api/admin/category-insights", async (c) => {
  try {
    const services = initializeServices(c.env);
    const days = parseInt(c.req.query('days') || '30');

    const insights = await services.categoryManager.generateInsights(days);

    return c.json({
      success: true,
      insights,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[API] Error getting category insights:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Get trending categories
app.get("/api/trending-categories", async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '8');

    // Try Python Worker (MongoDB aggregation with growth rates)
    try {
      const processingClient = new ProcessingClient(c.env.DATA_PROCESSOR);
      const result = await processingClient.getTrendingCategories(limit);
      return c.json(result);
    } catch (pyError) {
      console.warn('[API] Python Worker trending-categories unavailable, falling back to D1:', pyError);
    }

    // D1 fallback
    const services = initializeServices(c.env);
    const trending = await services.categoryManager.getTrendingCategories(limit);
    return c.json({
      success: true,
      trending,
      source: 'd1_fallback',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[API] Error getting trending categories:', error);
    return c.json({ error: "Failed to fetch trending categories" }, 500);
  }
});

// Get user's personalized category recommendations
app.get("/api/user/personalized-categories", async (c) => {
  try {
    const services = initializeServices(c.env);
    const userId = c.req.query('userId');

    if (!userId) {
      return c.json({ error: 'User ID required' }, 400);
    }

    const categories = await services.categoryManager.getPersonalizedCategories(userId, 10);

    return c.json({
      success: true,
      categories,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[API] Error getting personalized categories:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Initialize user category interest (for onboarding)
app.post("/api/user/me/category-interest", async (c) => {
  try {
    const services = initializeServices(c.env);
    const { categoryId, initialScore } = await c.req.json();

    // Get user ID from auth token
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // TODO: Extract user ID from token (for now, get from OpenAuthService)
    // This is a placeholder - you'll need to implement proper token validation
    const token = authHeader.substring(7);

    // For now, we'll get user ID from the session
    // In production, validate the token and extract user_id
    const sessionResult = await c.env.DB.prepare(`
      SELECT user_id FROM user_sessions WHERE token_hash = ? AND expires_at > datetime('now')
    `).bind(token).first() as any;

    if (!sessionResult) {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }

    const userId = sessionResult.user_id;

    // Update category interest
    await services.categoryManager.updateInterestScore(
      userId,
      categoryId,
      initialScore || 10,
      'view'
    );

    return c.json({
      success: true,
      message: 'Category interest initialized',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[API] Error initializing category interest:', error);
    return c.json({ error: error.message }, 500);
  }
});

// ===== OBSERVABILITY ENDPOINTS (Using ObservabilityService) =====

// Health check with full observability
app.get("/api/admin/observability/health", async (c) => {
  try {
    const services = initializeServices(c.env);
    const healthChecks = await services.observabilityService.performHealthChecks(c.env);

    return c.json({
      success: true,
      health: healthChecks,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[API] Error performing health checks:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Get metrics summary
app.get("/api/admin/observability/metrics", async (c) => {
  try {
    const services = initializeServices(c.env);
    const metrics = services.observabilityService.getMetricsSummary();

    return c.json({
      success: true,
      metrics,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[API] Error getting metrics:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Get alerts
app.get("/api/admin/observability/alerts", async (c) => {
  try {
    const services = initializeServices(c.env);
    const alerts = await services.observabilityService.checkAlerts();

    return c.json({
      success: true,
      alerts,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[API] Error checking alerts:', error);
    return c.json({ error: error.message }, 500);
  }
});

// ===== SOURCE HEALTH MONITORING ENDPOINTS =====

// Get full source health summary — tries Python Worker (MongoDB), falls back to D1
app.get("/api/admin/sources/health", async (c) => {
  try {
    // Try Python Worker first for richer MongoDB-backed health data
    try {
      const processingClient = new ProcessingClient(c.env.DATA_PROCESSOR);
      const healthData = await processingClient.getSourceHealth();
      return c.json({
        success: true,
        source: 'mongodb',
        ...healthData,
        timestamp: new Date().toISOString()
      });
    } catch (pyError) {
      console.warn('[API] Python Worker health unavailable, falling back to D1:', pyError);
    }

    // Fallback to D1-based health
    const services = initializeServices(c.env);
    const summary = await services.sourceHealthService.getHealthSummary();

    return c.json({
      success: true,
      source: 'd1_fallback',
      ...summary,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[API] Error getting source health:', error);
    return c.json({ error: "Failed to get source health", message: error.message }, 500);
  }
});

// Get only failing sources (quick admin view)
app.get("/api/admin/sources/failing", async (c) => {
  try {
    const services = initializeServices(c.env);
    const failing = await services.sourceHealthService.getFailingSources();

    return c.json({
      success: true,
      sources: failing,
      count: failing.length,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[API] Error getting failing sources:', error);
    return c.json({ error: "Failed to get failing sources", message: error.message }, 500);
  }
});

// Get health for a single source
app.get("/api/admin/sources/health/:sourceId", async (c) => {
  try {
    const sourceId = c.req.param('sourceId');
    const services = initializeServices(c.env);
    const health = await services.sourceHealthService.getSourceHealth(sourceId);

    if (!health) {
      return c.json({ error: "Source not found" }, 404);
    }

    return c.json({
      success: true,
      source: health,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[API] Error getting source health:', error);
    return c.json({ error: "Failed to get source health", message: error.message }, 500);
  }
});

// Reset health tracking for a source (after manual fix)
app.post("/api/admin/sources/health/:sourceId/reset", async (c) => {
  try {
    const sourceId = c.req.param('sourceId');
    const services = initializeServices(c.env);

    await services.sourceHealthService.resetSourceHealth(sourceId);

    return c.json({
      success: true,
      message: `Health tracking reset for source ${sourceId}`,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[API] Error resetting source health:', error);
    return c.json({ error: "Failed to reset source health", message: error.message }, 500);
  }
});

// ===== USER SERVICE ENDPOINTS (Using D1UserService) =====

// Get user bookmarks
app.get("/api/user/bookmarks", async (c) => {
  try {
    const services = initializeServices(c.env);
    const userId = c.req.query('userId');
    const limit = parseInt(c.req.query('limit') || '100');
    const offset = parseInt(c.req.query('offset') || '0');

    if (!userId) {
      return c.json({ error: 'User ID required' }, 400);
    }

    const bookmarks = await services.userService.getUserBookmarks(userId, limit, offset);

    return c.json({
      success: true,
      bookmarks,
      count: bookmarks.length,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[API] Error getting user bookmarks:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Get user reading history
app.get("/api/user/history", async (c) => {
  try {
    const services = initializeServices(c.env);
    const userId = c.req.query('userId');
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

    if (!userId) {
      return c.json({ error: 'User ID required' }, 400);
    }

    const history = await services.userService.getUserReadingHistory(userId, limit, offset);

    return c.json({
      success: true,
      history,
      count: history.length,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[API] Error getting reading history:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Get user statistics
app.get("/api/user/stats", async (c) => {
  try {
    const services = initializeServices(c.env);
    const userId = c.req.query('userId');

    if (!userId) {
      return c.json({ error: 'User ID required' }, 400);
    }

    const stats = await services.userService.getUserStats(userId);

    return c.json({
      success: true,
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[API] Error getting user stats:', error);
    return c.json({ error: error.message }, 500);
  }
});

// ===== AUTHENTICATION ENDPOINTS =====
// D1-FIRST AUTHENTICATION ARCHITECTURE
//
// All authentication data stored in D1 database:
// - Passwords: users.password_hash (salted SHA-256)
// - Sessions: user_sessions table
// - User data: users table
//
// KV namespace (AUTH_STORAGE) only used for:
// - Temporary verification codes (10-minute TTL)
// - Rate limiting (future enhancement)
//
// Why D1-first?
// - Scales better for thousands of users
// - Lower cost than KV for core auth data
// - Persistent, reliable storage
// - Single source of truth for all user data

// Register - Redirects to OIDC provider
// Authentication is handled by id.mukoko.com
app.post("/api/auth/register", async (c) => {
  return c.json({
    error: "Direct registration is disabled",
    message: "Please use Mukoko ID to create an account",
    oidc: {
      issuer: "https://id.mukoko.com",
      authorize_endpoint: "https://id.mukoko.com/authorize",
      client_id: "mukoko-news",
      action: "register"
    }
  }, 400);
});

// Login - Redirects to OIDC provider
// Authentication is handled by id.mukoko.com
app.post("/api/auth/login", async (c) => {
  return c.json({
    error: "Direct login is disabled",
    message: "Please use Mukoko ID to sign in",
    oidc: {
      issuer: "https://id.mukoko.com",
      authorize_endpoint: "https://id.mukoko.com/authorize",
      client_id: "mukoko-news",
      action: "login"
    }
  }, 400);
});

// OIDC Callback - Exchange authorization code for tokens
// Called by mobile/web after redirect from id.mukoko.com
// Rate limited to prevent brute-force attacks
app.post("/api/auth/oidc/callback", async (c) => {
  try {
    const services = initializeServices(c.env);
    const clientIP = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';

    // Rate limit: 10 attempts per 15 minutes per IP
    const rateLimit = await services.rateLimitService.checkRateLimit(`oidc:${clientIP}`, {
      maxAttempts: 10,
      windowMs: 15 * 60 * 1000, // 15 minutes
      blockDurationMs: 30 * 60 * 1000 // 30 minute block
    });

    if (!rateLimit.allowed) {
      console.warn(`[AUTH] Rate limit exceeded for IP: ${clientIP}`);
      return c.json({
        error: "Too many authentication attempts",
        retryAfter: rateLimit.retryAfter
      }, 429);
    }

    const { code, redirect_uri } = await c.req.json();

    if (!code || !redirect_uri) {
      // Record failed attempt
      await services.rateLimitService.recordAttempt(`oidc:${clientIP}`, {
        maxAttempts: 10,
        windowMs: 15 * 60 * 1000,
        blockDurationMs: 30 * 60 * 1000
      });
      return c.json({ error: "Missing code or redirect_uri" }, 400);
    }

    // Exchange code for tokens with id.mukoko.com
    const tokenResponse = await fetch("https://id.mukoko.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri,
        client_id: "mukoko-news",
        // client_secret would be added in production
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error("[OIDC] Token exchange failed:", errorData);
      return c.json({ error: "Token exchange failed" }, 401);
    }

    const tokens = await tokenResponse.json() as {
      access_token: string;
      id_token?: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
    };

    // Decode ID token to get claims (JWT payload is base64url encoded)
    let claims: any = {};
    if (tokens.id_token) {
      try {
        const [, payload] = tokens.id_token.split('.');
        const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
        claims = JSON.parse(decoded);
      } catch (e) {
        console.error("[OIDC] Failed to decode ID token:", e);
      }
    }

    // If no ID token, fetch userinfo
    if (!claims.sub && tokens.access_token) {
      const userInfoResponse = await fetch("https://id.mukoko.com/oauth/userinfo", {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      });
      if (userInfoResponse.ok) {
        claims = await userInfoResponse.json();
      }
    }

    if (!claims.sub) {
      return c.json({ error: "Could not get user identity from OIDC provider" }, 401);
    }

    // Authenticate with our service
    const authService = new AuthProviderService({
      DB: c.env.DB,
      AUTH_STORAGE: c.env.AUTH_STORAGE as any
    });

    const result = await authService.authenticateWithOIDC(claims, "mukoko");

    if (!result.success) {
      return c.json({ error: result.error || "Authentication failed" }, 401);
    }

    // Set cookie and return session
    const cookieValue = `auth_token=${result.session_token}; Domain=.mukoko.com; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`;

    return new Response(JSON.stringify({
      access_token: result.session_token,
      user: result.user,
      is_new_user: result.is_new_user,
      refresh_token: tokens.refresh_token || null
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': cookieValue
      }
    });
  } catch (error: any) {
    console.error("[OIDC] Callback error:", error);
    return c.json({ error: "Authentication failed" }, 500);
  }
});

// Refresh access token
// Called when the current token is about to expire
app.post("/api/auth/refresh", async (c) => {
  try {
    const { refresh_token } = await c.req.json();

    if (!refresh_token) {
      return c.json({ error: "Missing refresh_token" }, 400);
    }

    // Exchange refresh token with id.mukoko.com
    const tokenResponse = await fetch("https://id.mukoko.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token,
        client_id: "mukoko-news",
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error("[OIDC] Token refresh failed:", errorData);
      return c.json({ error: "Token refresh failed" }, 401);
    }

    const tokens = await tokenResponse.json() as {
      access_token: string;
      id_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    // Decode ID token to get claims
    let claims: any = {};
    if (tokens.id_token) {
      try {
        const [, payload] = tokens.id_token.split('.');
        const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
        claims = JSON.parse(decoded);
      } catch (e) {
        console.error("[OIDC] Failed to decode ID token:", e);
      }
    }

    if (!claims.sub) {
      return c.json({ error: "Could not get user identity from refreshed token" }, 401);
    }

    // Re-authenticate to create new session
    const authService = new AuthProviderService({
      DB: c.env.DB,
      AUTH_STORAGE: c.env.AUTH_STORAGE as any
    });

    const result = await authService.authenticateWithOIDC(claims, "mukoko");

    if (!result.success) {
      return c.json({ error: result.error || "Session refresh failed" }, 401);
    }

    // Set cookie and return new session
    const cookieValue = `auth_token=${result.session_token}; Domain=.mukoko.com; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`;

    return new Response(JSON.stringify({
      access_token: result.session_token,
      user: result.user,
      refresh_token: tokens.refresh_token || refresh_token
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': cookieValue
      }
    });
  } catch (error: any) {
    console.error("[OIDC] Refresh error:", error);
    return c.json({ error: "Token refresh failed" }, 500);
  }
});

// Get current session - uses AuthProviderService
app.get("/api/auth/session", async (c) => {
  try {
    // Try to get token from cookie first, then Authorization header
    const cookieHeader = c.req.header('cookie');
    let token = getCookie(cookieHeader, 'auth_token');

    if (!token) {
      const authHeader = c.req.header('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({ session: null, user: null });
      }
      token = authHeader.substring(7);
    }

    const authService = new AuthProviderService({
      DB: c.env.DB,
      AUTH_STORAGE: c.env.AUTH_STORAGE as any // Type compatibility workaround
    });

    const session = await authService.validateSession(token);
    if (!session) {
      return c.json({ session: null, user: null });
    }

    // Fetch full user data if needed
    const user = await authService.getUserById(session.user_id);

    return c.json({
      session: { access_token: token },
      user: user || {
        id: session.user_id,
        email: session.email,
        username: session.username,
        role: session.role
      }
    });
  } catch (error: any) {
    console.error("[AUTH] Session check error:", error);
    return c.json({ session: null, user: null });
  }
});

// Logout - uses AuthProviderService
app.post("/api/auth/logout", async (c) => {
  try {
    // Try to get token from cookie first, then Authorization header
    const cookieHeader = c.req.header('cookie');
    let token = getCookie(cookieHeader, 'auth_token');

    if (!token) {
      const authHeader = c.req.header('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (token) {
      const authService = new AuthProviderService({
        DB: c.env.DB,
        AUTH_STORAGE: c.env.AUTH_STORAGE as any // Type compatibility workaround
      });
      await authService.invalidateSession(token);
    }

    // Clear the cookie by setting it with Max-Age=0
    return new Response(JSON.stringify({ success: true }), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'auth_token=; Domain=.mukoko.com; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
      }
    });
  } catch (error: any) {
    console.error("[AUTH] Logout error:", error);
    return c.json({ error: "Logout failed" }, 500);
  }
});

// Update user profile (including username during onboarding)
app.patch("/api/user/me/profile", async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const token = authHeader.substring(7);
    const { username, displayName, bio, avatarUrl } = await c.req.json();

    // Get user ID from session
    const sessionResult = await c.env.DB.prepare(`
      SELECT user_id FROM user_sessions WHERE token_hash = ? AND expires_at > datetime('now')
    `).bind(token).first() as any;

    if (!sessionResult) {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }

    const userId = sessionResult.user_id;

    // If username is being updated, check uniqueness
    if (username) {
      // Validate username format
      const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;
      if (!usernameRegex.test(username)) {
        return c.json({
          error: 'Username must be 3-30 characters and contain only letters, numbers, and underscores'
        }, 400);
      }

      // Check if username is already taken by another user
      const existingUser = await c.env.DB.prepare(`
        SELECT id FROM users WHERE username = ? AND id != ?
      `).bind(username, userId).first() as any;

      if (existingUser) {
        return c.json({ error: 'Username is already taken' }, 409);
      }
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];

    if (username !== undefined) {
      updates.push('username = ?');
      values.push(username);
    }
    if (displayName !== undefined) {
      updates.push('name = ?');
      values.push(displayName);
    }
    if (bio !== undefined) {
      updates.push('bio = ?');
      values.push(bio);
    }
    if (avatarUrl !== undefined) {
      updates.push('picture = ?');
      values.push(avatarUrl);
    }

    if (updates.length === 0) {
      return c.json({ error: 'No fields to update' }, 400);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(userId);

    await c.env.DB.prepare(`
      UPDATE users SET ${updates.join(', ')} WHERE id = ?
    `).bind(...values).run();

    // Get updated user
    const updatedUser = await c.env.DB.prepare(`
      SELECT id, email, username, name, bio, picture, role, status, created_at
      FROM users WHERE id = ?
    `).bind(userId).first() as any;

    return c.json({
      success: true,
      user: updatedUser,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[API] Error updating profile:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Check username availability
app.get("/api/auth/check-username", async (c) => {
  try {
    const username = c.req.query('username');

    if (!username) {
      return c.json({ error: 'Username parameter required' }, 400);
    }

    // Validate format
    const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;
    if (!usernameRegex.test(username)) {
      return c.json({
        available: false,
        error: 'Invalid username format'
      });
    }

    // Check if taken
    const existingUser = await c.env.DB.prepare(`
      SELECT id FROM users WHERE username = ?
    `).bind(username).first() as any;

    return c.json({
      available: !existingUser,
      username
    });
  } catch (error: any) {
    console.error('[API] Error checking username:', error);
    return c.json({ error: error.message }, 500);
  }
});

// ===== USER IDENTITY & AUTH PROVIDERS =====

// Get user's linked authentication providers
app.get("/api/user/me/auth-providers", async (c) => {
  try {
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id');
    if (!userId) {
      return c.json({ error: "User identification required" }, 401);
    }

    const providers = await c.env.DB.prepare(`
      SELECT
        id, provider_type, provider_name,
        CASE WHEN oidc_subject IS NOT NULL THEN 'linked' ELSE NULL END as oidc_status,
        CASE WHEN wallet_address IS NOT NULL THEN wallet_address ELSE NULL END as wallet_address,
        chain_id, ens_name,
        CASE WHEN mobile_number IS NOT NULL THEN
          SUBSTR(mobile_number, 1, 4) || '****' || SUBSTR(mobile_number, -4)
        ELSE NULL END as mobile_masked,
        mobile_verified,
        is_primary, verified_at, last_used_at, created_at
      FROM user_auth_providers
      WHERE user_id = ?
      ORDER BY is_primary DESC, created_at ASC
    `).bind(userId).all();

    return c.json({
      providers: providers.results || [],
      count: providers.results?.length || 0
    });
  } catch (error) {
    console.error("[AUTH_PROVIDERS] Error:", error);
    return c.json({ error: "Failed to fetch auth providers" }, 500);
  }
});

// Link a new authentication provider (OIDC callback handler)
app.post("/api/user/me/auth-providers/oidc", async (c) => {
  try {
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id');
    if (!userId) {
      return c.json({ error: "User identification required" }, 401);
    }

    const body = await c.req.json();
    const { provider_name, oidc_subject, oidc_issuer, claims } = body;

    if (!provider_name || !oidc_subject || !oidc_issuer) {
      return c.json({ error: "Missing required OIDC fields" }, 400);
    }

    // Check if this OIDC subject is already linked to another user
    const existing = await c.env.DB.prepare(`
      SELECT user_id FROM user_auth_providers
      WHERE provider_type = 'oidc' AND oidc_subject = ? AND oidc_issuer = ? AND user_id != ?
    `).bind(oidc_subject, oidc_issuer, userId).first();

    if (existing) {
      return c.json({ error: "This identity is already linked to another account" }, 409);
    }

    // Link the provider
    await c.env.DB.prepare(`
      INSERT INTO user_auth_providers (
        user_id, provider_type, provider_name, oidc_subject, oidc_issuer,
        verified_at, metadata
      ) VALUES (?, 'oidc', ?, ?, ?, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(provider_type, provider_name, oidc_subject) DO UPDATE SET
        user_id = excluded.user_id,
        verified_at = CURRENT_TIMESTAMP,
        metadata = excluded.metadata,
        updated_at = CURRENT_TIMESTAMP
    `).bind(userId, provider_name, oidc_subject, oidc_issuer, JSON.stringify(claims || {})).run();

    // Update user profile from OIDC claims if provided
    if (claims) {
      const updates: string[] = [];
      const params: any[] = [];

      if (claims.name && !await hasUserField(c.env.DB, userId, 'name')) {
        updates.push('name = ?');
        params.push(claims.name);
      }
      if (claims.picture && !await hasUserField(c.env.DB, userId, 'picture')) {
        updates.push('picture = ?');
        params.push(claims.picture);
      }
      if (claims.email && !await hasUserField(c.env.DB, userId, 'email')) {
        updates.push('email = ?');
        params.push(claims.email);
      }
      if (claims.email_verified) {
        updates.push('email_verified = TRUE');
      }
      if (claims.phone_number && !await hasUserField(c.env.DB, userId, 'phone_number')) {
        updates.push('phone_number = ?');
        params.push(claims.phone_number);
      }
      if (claims.phone_number_verified) {
        updates.push('phone_number_verified = TRUE');
      }

      if (updates.length > 0) {
        params.push(userId);
        await c.env.DB.prepare(`
          UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).bind(...params).run();
      }
    }

    return c.json({ success: true, message: "Authentication provider linked" });
  } catch (error) {
    console.error("[LINK_OIDC] Error:", error);
    return c.json({ error: "Failed to link authentication provider" }, 500);
  }
});

// Helper function to check if user has a field set
async function hasUserField(db: D1Database, userId: string, field: string): Promise<boolean> {
  const result = await db.prepare(`SELECT ${field} FROM users WHERE id = ?`).bind(userId).first();
  return result && result[field] !== null && result[field] !== '';
}

// Link mobile number
app.post("/api/user/me/auth-providers/mobile", async (c) => {
  try {
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id');
    if (!userId) {
      return c.json({ error: "User identification required" }, 401);
    }

    const body = await c.req.json();
    const { mobile_number, country_code } = body;

    if (!mobile_number) {
      return c.json({ error: "Mobile number required" }, 400);
    }

    // Check if mobile is already linked to another user
    const existing = await c.env.DB.prepare(`
      SELECT user_id FROM user_auth_providers
      WHERE provider_type = 'mobile' AND mobile_number = ? AND user_id != ?
    `).bind(mobile_number, userId).first();

    if (existing) {
      return c.json({ error: "This mobile number is already linked to another account" }, 409);
    }

    // Create provider link (unverified - will need OTP verification)
    await c.env.DB.prepare(`
      INSERT INTO user_auth_providers (
        user_id, provider_type, provider_name, mobile_number, mobile_country_code, mobile_verified
      ) VALUES (?, 'mobile', 'sms', ?, ?, FALSE)
      ON CONFLICT(mobile_number) DO UPDATE SET
        user_id = excluded.user_id,
        mobile_country_code = excluded.mobile_country_code,
        updated_at = CURRENT_TIMESTAMP
    `).bind(userId, mobile_number, country_code || 'ZW').run();

    return c.json({
      success: true,
      message: "Mobile number added. Please verify with OTP.",
      requires_verification: true
    });
  } catch (error) {
    console.error("[LINK_MOBILE] Error:", error);
    return c.json({ error: "Failed to link mobile number" }, 500);
  }
});

// Link Web3 wallet
app.post("/api/user/me/auth-providers/wallet", async (c) => {
  try {
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id');
    if (!userId) {
      return c.json({ error: "User identification required" }, 401);
    }

    const body = await c.req.json();
    const { wallet_address, chain_id, ens_name } = body;

    if (!wallet_address) {
      return c.json({ error: "Wallet address required" }, 400);
    }

    const normalizedAddress = wallet_address.toLowerCase();

    // Check if wallet is already linked to another user
    const existing = await c.env.DB.prepare(`
      SELECT user_id FROM user_auth_providers
      WHERE provider_type = 'web3' AND wallet_address = ? AND user_id != ?
    `).bind(normalizedAddress, userId).first();

    if (existing) {
      return c.json({ error: "This wallet is already linked to another account" }, 409);
    }

    // Create provider link (will need signature verification for full verification)
    await c.env.DB.prepare(`
      INSERT INTO user_auth_providers (
        user_id, provider_type, provider_name, wallet_address, chain_id, ens_name
      ) VALUES (?, 'web3', 'ethereum', ?, ?, ?)
      ON CONFLICT(wallet_address, chain_id) DO UPDATE SET
        user_id = excluded.user_id,
        ens_name = COALESCE(excluded.ens_name, ens_name),
        updated_at = CURRENT_TIMESTAMP
    `).bind(userId, normalizedAddress, chain_id || 1, ens_name || null).run();

    return c.json({
      success: true,
      message: "Wallet linked. Signature verification recommended.",
      requires_verification: true
    });
  } catch (error) {
    console.error("[LINK_WALLET] Error:", error);
    return c.json({ error: "Failed to link wallet" }, 500);
  }
});

// Set primary authentication provider
app.put("/api/user/me/auth-providers/:providerId/primary", async (c) => {
  try {
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id');
    if (!userId) {
      return c.json({ error: "User identification required" }, 401);
    }

    const providerId = c.req.param("providerId");

    // Clear all primary flags for this user
    await c.env.DB.prepare(`
      UPDATE user_auth_providers SET is_primary = FALSE WHERE user_id = ?
    `).bind(userId).run();

    // Set the new primary
    const result = await c.env.DB.prepare(`
      UPDATE user_auth_providers
      SET is_primary = TRUE, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).bind(providerId, userId).run();

    if (result.meta.changes === 0) {
      return c.json({ error: "Provider not found" }, 404);
    }

    return c.json({ success: true, message: "Primary authentication method updated" });
  } catch (error) {
    console.error("[SET_PRIMARY_PROVIDER] Error:", error);
    return c.json({ error: "Failed to update primary provider" }, 500);
  }
});

// Unlink authentication provider
app.delete("/api/user/me/auth-providers/:providerId", async (c) => {
  try {
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id');
    if (!userId) {
      return c.json({ error: "User identification required" }, 401);
    }

    const providerId = c.req.param("providerId");

    // Check if this is the only auth method
    const countResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM user_auth_providers WHERE user_id = ?
    `).bind(userId).first<{ count: number }>();

    if ((countResult?.count || 0) <= 1) {
      return c.json({ error: "Cannot remove your only authentication method" }, 400);
    }

    // Delete the provider
    const result = await c.env.DB.prepare(`
      DELETE FROM user_auth_providers WHERE id = ? AND user_id = ?
    `).bind(providerId, userId).run();

    if (result.meta.changes === 0) {
      return c.json({ error: "Provider not found" }, 404);
    }

    return c.json({ success: true, message: "Authentication provider removed" });
  } catch (error) {
    console.error("[UNLINK_PROVIDER] Error:", error);
    return c.json({ error: "Failed to remove provider" }, 500);
  }
});

// Get user identity summary (combines user profile with auth providers)
app.get("/api/user/me/identity", async (c) => {
  try {
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id');
    if (!userId) {
      return c.json({ error: "User identification required" }, 401);
    }

    // Get user profile
    const user = await c.env.DB.prepare(`
      SELECT id, email, username, name, picture, bio,
             phone_number, phone_number_verified,
             role, status, email_verified,
             created_at, updated_at, last_login_at
      FROM users WHERE id = ?
    `).bind(userId).first();

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    // Get auth providers summary
    const providers = await c.env.DB.prepare(`
      SELECT provider_type, provider_name, is_primary, verified_at IS NOT NULL as is_verified
      FROM user_auth_providers WHERE user_id = ?
    `).bind(userId).all();

    // Calculate identity completeness
    const u = user as Record<string, any>;
    const completeness = {
      has_email: !!u.email && u.email_verified,
      has_phone: !!u.phone_number && u.phone_number_verified,
      has_username: !!u.username,
      has_name: !!u.name,
      has_picture: !!u.picture,
      provider_count: providers.results?.length || 0,
      score: 0
    };
    completeness.score = [
      completeness.has_email,
      completeness.has_phone,
      completeness.has_username,
      completeness.has_name,
      completeness.has_picture
    ].filter(Boolean).length;

    return c.json({
      user: {
        id: u.id,
        email: u.email,
        email_verified: u.email_verified,
        username: u.username,
        name: u.name,
        picture: u.picture,
        bio: u.bio,
        phone_number: u.phone_number ? u.phone_number.replace(/(\+\d{3})\d+(\d{4})/, '$1****$2') : null,
        phone_number_verified: u.phone_number_verified,
        role: u.role,
        status: u.status,
        created_at: u.created_at,
        last_login_at: u.last_login_at
      },
      providers: providers.results || [],
      completeness
    });
  } catch (error) {
    console.error("[USER_IDENTITY] Error:", error);
    return c.json({ error: "Failed to fetch user identity" }, 500);
  }
});

// Sync user profile from OIDC claims (called after OIDC login)
app.post("/api/user/me/identity/sync-from-oidc", async (c) => {
  try {
    const userId = c.req.header('x-user-id') || c.req.header('x-session-id');
    if (!userId) {
      return c.json({ error: "User identification required" }, 401);
    }

    const body = await c.req.json();
    const { claims, overwrite = false } = body;

    if (!claims) {
      return c.json({ error: "OIDC claims required" }, 400);
    }

    // Build update query based on claims
    const updates: string[] = [];
    const params: any[] = [];

    // Map OIDC standard claims to user fields (1:1 mapping now)
    const fieldMapping: Record<string, string> = {
      name: 'name',
      given_name: 'given_name',
      family_name: 'family_name',
      picture: 'picture',
      email: 'email',
      phone_number: 'phone_number'
    };

    for (const [claimKey, userField] of Object.entries(fieldMapping)) {
      if (claims[claimKey]) {
        if (overwrite || !await hasUserField(c.env.DB, userId, userField)) {
          updates.push(`${userField} = ?`);
          params.push(claims[claimKey]);
        }
      }
    }

    // Handle verified flags
    if (claims.email_verified === true) {
      updates.push('email_verified = TRUE');
    }
    if (claims.phone_number_verified === true) {
      updates.push('phone_number_verified = TRUE');
    }

    if (updates.length > 0) {
      params.push(userId);
      await c.env.DB.prepare(`
        UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).bind(...params).run();
    }

    return c.json({
      success: true,
      message: "Profile synced from OIDC claims",
      fields_updated: updates.length
    });
  } catch (error) {
    console.error("[SYNC_OIDC] Error:", error);
    return c.json({ error: "Failed to sync profile" }, 500);
  }
});

// Get available authentication providers
app.get("/api/auth/providers", async (c) => {
  try {
    const countryCode = c.req.query("country") || null;

    let query = `
      SELECT id, provider_type, display_name, icon_url, sort_order,
             available_countries, enabled
      FROM auth_provider_config
      WHERE enabled = TRUE
    `;

    const result = await c.env.DB.prepare(query).all();

    // Filter by country if specified
    let providers = result.results || [];
    if (countryCode) {
      providers = providers.filter((p: any) => {
        if (!p.available_countries) return true;
        const countries = JSON.parse(p.available_countries);
        return countries.includes(countryCode);
      });
    }

    // Group by type
    const grouped = {
      oidc: providers.filter((p: any) => p.provider_type === 'oidc'),
      mobile: providers.filter((p: any) => p.provider_type === 'mobile'),
      web3: providers.filter((p: any) => p.provider_type === 'web3')
    };

    return c.json({ providers: grouped });
  } catch (error) {
    console.error("[AUTH_PROVIDERS_LIST] Error:", error);
    return c.json({ error: "Failed to fetch providers" }, 500);
  }
});

// ===== USER MANAGEMENT (ADMIN ONLY) =====

// Get all users (admin only)
app.get("/api/admin/users", async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const token = authHeader.substring(7);
    const authService = new AuthProviderService({ DB: c.env.DB, AUTH_STORAGE: c.env.AUTH_STORAGE as any });
    const session = await authService.validateSession(token);

    if (!session || session.role !== 'admin') {
      return c.json({ error: "Admin access required" }, 403);
    }

    const limit = parseInt(c.req.query("limit") || "50");
    const offset = parseInt(c.req.query("offset") || "0");
    const search = c.req.query("search") || "";

    let query = `
      SELECT id, email, username, name, picture, role, status, email_verified,
             created_at, updated_at, last_login_at, login_count
      FROM users
    `;

    let params: any[] = [];

    if (search) {
      query += ` WHERE email LIKE ? OR name LIKE ? OR username LIKE ?`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const users = await c.env.DB.prepare(query).bind(...params).all();
    const totalResult = await c.env.DB.prepare(
      search
        ? `SELECT COUNT(*) as total FROM users WHERE email LIKE ? OR name LIKE ? OR username LIKE ?`
        : `SELECT COUNT(*) as total FROM users`
    ).bind(...(search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [])).first();

    return c.json({
      users: users.results,
      total: totalResult.total,
      limit,
      offset
    });
  } catch (error: any) {
    console.error("[ADMIN] List users error:", error);
    return c.json({ error: "Failed to fetch users" }, 500);
  }
});

// Get user stats (admin only)
app.get("/api/admin/user-stats", async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const token = authHeader.substring(7);
    const authService = new AuthProviderService({ DB: c.env.DB, AUTH_STORAGE: c.env.AUTH_STORAGE as any });
    const session = await authService.validateSession(token);

    if (!session || session.role !== 'admin') {
      return c.json({ error: "Admin access required" }, 403);
    }

    // Get user statistics directly from DB
    const totalResult = await c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();
    const activeResult = await c.env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'active'").first<{ count: number }>();
    const suspendedResult = await c.env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'suspended'").first<{ count: number }>();
    const roleStats = await c.env.DB.prepare(`
      SELECT role, COUNT(*) as count FROM users GROUP BY role
    `).all<{ role: string; count: number }>();

    const stats = {
      total: totalResult?.count || 0,
      active: activeResult?.count || 0,
      suspended: suspendedResult?.count || 0,
      by_role: Object.fromEntries((roleStats.results || []).map(r => [r.role, r.count]))
    };

    return c.json(stats);
  } catch (error: any) {
    console.error("[ADMIN] User stats error:", error);
    return c.json({ error: "Failed to fetch user stats" }, 500);
  }
});

// Update user role (admin only)
app.put("/api/admin/users/:userId/role", async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const token = authHeader.substring(7);
    const authService = new AuthProviderService({ DB: c.env.DB, AUTH_STORAGE: c.env.AUTH_STORAGE as any });
    const session = await authService.validateSession(token);

    if (!session || session.role !== 'admin') {
      return c.json({ error: "Admin access required" }, 403);
    }

    const userId = c.req.param("userId");
    const { role } = await c.req.json();

    // Valid roles: admin, moderator, support, author, user
    if (!['admin', 'moderator', 'support', 'author', 'user'].includes(role)) {
      return c.json({ error: "Invalid role. Valid roles: admin, moderator, support, author, user" }, 400);
    }

    await authService.updateUserRole(userId, role, session.user_id);

    return c.json({ message: "User role updated successfully" });
  } catch (error: any) {
    console.error("[ADMIN] Update user role error:", error);
    return c.json({ error: "Failed to update user role" }, 500);
  }
});

// Suspend/activate user (admin only)
app.put("/api/admin/users/:userId/status", async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const token = authHeader.substring(7);
    const authService = new AuthProviderService({ DB: c.env.DB, AUTH_STORAGE: c.env.AUTH_STORAGE as any });
    const session = await authService.validateSession(token);

    if (!session || session.role !== 'admin') {
      return c.json({ error: "Admin access required" }, 403);
    }

    const userId = c.req.param("userId");
    const { status } = await c.req.json();

    if (!['active', 'suspended', 'deleted'].includes(status)) {
      return c.json({ error: "Invalid status" }, 400);
    }

    await c.env.DB.prepare(
      'UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(status, userId).run();

    // If suspending or deleting, revoke all sessions
    if (status === 'suspended' || status === 'deleted') {
      await c.env.DB.prepare('DELETE FROM user_sessions WHERE user_id = ?').bind(userId).run();
    }

    return c.json({ message: `User ${status} successfully` });
  } catch (error: any) {
    console.error("[ADMIN] Update user status error:", error);
    return c.json({ error: "Failed to update user status" }, 500);
  }
});

// Delete user (admin only)
app.delete("/api/admin/users/:userId", async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const token = authHeader.substring(7);
    const authService = new AuthProviderService({ DB: c.env.DB, AUTH_STORAGE: c.env.AUTH_STORAGE as any });
    const session = await authService.validateSession(token);

    if (!session || session.role !== 'admin') {
      return c.json({ error: "Admin access required" }, 403);
    }

    const userId = c.req.param("userId");

    // Soft delete - set status to 'deleted'
    await c.env.DB.prepare(
      'UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind('deleted', userId).run();

    // Revoke all sessions
    await c.env.DB.prepare('DELETE FROM user_sessions WHERE user_id = ?').bind(userId).run();

    return c.json({ message: "User deleted successfully" });
  } catch (error: any) {
    console.error("[ADMIN] Delete user error:", error);
    return c.json({ error: "Failed to delete user" }, 500);
  }
});

// ===== PASSWORD RECOVERY =====

// Password reset - Redirects to OIDC provider
// Password management is handled by id.mukoko.com
app.post("/api/auth/forgot-password", async (c) => {
  return c.json({
    error: "Password reset is handled by Mukoko ID",
    message: "Please visit id.mukoko.com to reset your password",
    oidc: {
      issuer: "https://id.mukoko.com",
      password_reset_endpoint: "https://id.mukoko.com/forgot-password"
    }
  }, 400);
});

// Reset password - Redirects to OIDC provider
// Password management is handled by id.mukoko.com
app.post("/api/auth/reset-password", async (c) => {
  return c.json({
    error: "Password reset is handled by Mukoko ID",
    message: "Please visit id.mukoko.com to reset your password",
    oidc: {
      issuer: "https://id.mukoko.com",
      password_reset_endpoint: "https://id.mukoko.com/forgot-password"
    }
  }, 400);
});

// Change password - Redirects to OIDC provider
// Password management is handled by id.mukoko.com
app.post("/api/auth/change-password", async (c) => {
  return c.json({
    error: "Password change is handled by Mukoko ID",
    message: "Please visit id.mukoko.com to change your password",
    oidc: {
      issuer: "https://id.mukoko.com",
      account_settings_endpoint: "https://id.mukoko.com/settings"
    }
  }, 400);
});

// ===== USER PROFILE ENDPOINTS =====

// Get user profile by username
app.get("/api/user/:username", async (c) => {
  try {
    const username = c.req.param("username");
    const authService = new AuthProviderService({ DB: c.env.DB, AUTH_STORAGE: c.env.AUTH_STORAGE as any });

    const user = await authService.getUserByUsername(username);
    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    // Public profile data only (no email, no sensitive data)
    return c.json({
      id: user.id,
      username: user.username,
      name: user.name,
      picture: user.picture,
      bio: user.bio,
      role: user.role,
      created_at: user.created_at
    });
  } catch (error: any) {
    console.error("[USER] Get profile error:", error);
    return c.json({ error: "Failed to fetch user profile" }, 500);
  }
});

// Update username (authenticated)
app.put("/api/user/me/username", async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const token = authHeader.substring(7);
    const authService = new AuthProviderService({ DB: c.env.DB, AUTH_STORAGE: c.env.AUTH_STORAGE as any });
    const session = await authService.validateSession(token);

    if (!session) {
      return c.json({ error: "Invalid session" }, 401);
    }

    const { username } = await c.req.json();

    if (!username) {
      return c.json({ error: "Username is required" }, 400);
    }

    // Validate username format (alphanumeric, underscore, 3-30 chars)
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
      return c.json({ error: "Username must be 3-30 characters, alphanumeric or underscore only" }, 400);
    }

    // Check if username is taken
    const existing = await c.env.DB.prepare(
      'SELECT id FROM users WHERE username = ? AND id != ?'
    ).bind(username.toLowerCase(), session.user_id).first();

    if (existing) {
      return c.json({ error: "Username is already taken" }, 400);
    }

    // Update username
    await c.env.DB.prepare(
      'UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(username.toLowerCase(), session.user_id).run();

    return c.json({ message: "Username updated successfully", username: username.toLowerCase() });
  } catch (error: any) {
    console.error("[USER] Update username error:", error);
    return c.json({ error: "Failed to update username" }, 500);
  }
});

// Update user profile (authenticated)
app.put("/api/user/me/profile", async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const token = authHeader.substring(7);
    const authService = new AuthProviderService({ DB: c.env.DB, AUTH_STORAGE: c.env.AUTH_STORAGE as any });
    const session = await authService.validateSession(token);

    if (!session) {
      return c.json({ error: "Invalid session" }, 401);
    }

    const { name, bio, picture } = await c.req.json();

    await c.env.DB.prepare(`
      UPDATE users
      SET name = ?, bio = ?, picture = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(name || null, bio || null, picture || null, session.user_id).run();

    return c.json({ message: "Profile updated successfully" });
  } catch (error: any) {
    console.error("[USER] Update profile error:", error);
    return c.json({ error: "Failed to update profile" }, 500);
  }
});

// Get user's bookmarked articles
app.get("/api/user/:username/bookmarks", async (c) => {
  try {
    const username = c.req.param("username");
    const limit = parseInt(c.req.query("limit") || "20");
    const offset = parseInt(c.req.query("offset") || "0");

    const authService = new AuthProviderService({ DB: c.env.DB, AUTH_STORAGE: c.env.AUTH_STORAGE as any });
    const user = await authService.getUserByUsername(username);

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    // Check if requesting user has permission to view (own bookmarks only for now)
    const authHeader = c.req.header('Authorization');
    let canView = false;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const session = await authService.validateSession(token);
      canView = session && (session.user_id === user.id);
    }

    if (!canView) {
      return c.json({ error: "Access denied" }, 403);
    }

    const bookmarksResult = await c.env.DB.prepare(`
      SELECT a.id, a.title, a.slug, a.description, a.author, a.source,
             a.source_id, a.category_id, a.published_at, a.image_url,
             b.created_at as bookmarked_at, b.tags, b.notes
      FROM user_bookmarks b
      INNER JOIN articles a ON b.article_id = a.id
      WHERE b.user_id = ? AND a.status = 'published'
      ORDER BY b.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(user.id, limit, offset).all();

    const totalResult = await c.env.DB.prepare(
      'SELECT COUNT(*) as total FROM user_bookmarks WHERE user_id = ?'
    ).bind(user.id).first();

    return c.json({
      bookmarks: bookmarksResult.results || [],
      total: totalResult?.total || 0,
      limit,
      offset
    });
  } catch (error: any) {
    console.error("[USER] Get bookmarks error:", error);
    return c.json({ error: "Failed to fetch bookmarks" }, 500);
  }
});

// Get user's liked articles
app.get("/api/user/:username/likes", async (c) => {
  try {
    const username = c.req.param("username");
    const limit = parseInt(c.req.query("limit") || "20");
    const offset = parseInt(c.req.query("offset") || "0");

    const authService = new AuthProviderService({ DB: c.env.DB, AUTH_STORAGE: c.env.AUTH_STORAGE as any });
    const user = await authService.getUserByUsername(username);

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    // Check if requesting user has permission to view (own likes only for now)
    const authHeader = c.req.header('Authorization');
    let canView = false;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const session = await authService.validateSession(token);
      canView = session && (session.user_id === user.id);
    }

    if (!canView) {
      return c.json({ error: "Access denied" }, 403);
    }

    const likesResult = await c.env.DB.prepare(`
      SELECT a.id, a.title, a.slug, a.description, a.author, a.source,
             a.source_id, a.category_id, a.published_at, a.image_url,
             l.created_at as liked_at
      FROM user_likes l
      INNER JOIN articles a ON l.article_id = a.id
      WHERE l.user_id = ? AND a.status = 'published'
      ORDER BY l.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(user.id, limit, offset).all();

    const totalResult = await c.env.DB.prepare(
      'SELECT COUNT(*) as total FROM user_likes WHERE user_id = ?'
    ).bind(user.id).first();

    return c.json({
      likes: likesResult.results || [],
      total: totalResult?.total || 0,
      limit,
      offset
    });
  } catch (error: any) {
    console.error("[USER] Get likes error:", error);
    return c.json({ error: "Failed to fetch likes" }, 500);
  }
});

// Get user's reading history
app.get("/api/user/:username/history", async (c) => {
  try {
    const username = c.req.param("username");
    const limit = parseInt(c.req.query("limit") || "20");
    const offset = parseInt(c.req.query("offset") || "0");

    const authService = new AuthProviderService({ DB: c.env.DB, AUTH_STORAGE: c.env.AUTH_STORAGE as any });
    const user = await authService.getUserByUsername(username);

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    // Check if requesting user has permission to view (own history only)
    const authHeader = c.req.header('Authorization');
    let canView = false;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const session = await authService.validateSession(token);
      canView = session && (session.user_id === user.id);
    }

    if (!canView) {
      return c.json({ error: "Access denied" }, 403);
    }

    const historyResult = await c.env.DB.prepare(`
      SELECT a.id, a.title, a.slug, a.description, a.author, a.source,
             a.source_id, a.category_id, a.published_at, a.image_url,
             h.started_at, h.last_position_at, h.reading_time,
             h.scroll_depth, h.completion_percentage
      FROM user_reading_history h
      INNER JOIN articles a ON h.article_id = a.id
      WHERE h.user_id = ? AND a.status = 'published'
      ORDER BY h.last_position_at DESC
      LIMIT ? OFFSET ?
    `).bind(user.id, limit, offset).all();

    const totalResult = await c.env.DB.prepare(
      'SELECT COUNT(*) as total FROM user_reading_history WHERE user_id = ?'
    ).bind(user.id).first();

    return c.json({
      history: historyResult.results || [],
      total: totalResult?.total || 0,
      limit,
      offset
    });
  } catch (error: any) {
    console.error("[USER] Get history error:", error);
    return c.json({ error: "Failed to fetch reading history" }, 500);
  }
});

// Get user's activity stats (for profile overview)
app.get("/api/user/:username/stats", async (c) => {
  try {
    const username = c.req.param("username");
    const authService = new AuthProviderService({ DB: c.env.DB, AUTH_STORAGE: c.env.AUTH_STORAGE as any });
    const user = await authService.getUserByUsername(username);

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    // Get counts
    const bookmarksCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM user_bookmarks WHERE user_id = ?'
    ).bind(user.id).first();

    const likesCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM user_likes WHERE user_id = ?'
    ).bind(user.id).first();

    const historyCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM user_reading_history WHERE user_id = ?'
    ).bind(user.id).first();

    // Get total reading time
    const totalReadingTime = await c.env.DB.prepare(
      'SELECT SUM(reading_time) as total FROM user_reading_history WHERE user_id = ?'
    ).bind(user.id).first();

    return c.json({
      bookmarks: bookmarksCount?.count || 0,
      likes: likesCount?.count || 0,
      articles_read: historyCount?.count || 0,
      total_reading_time: totalReadingTime?.total || 0,
      member_since: user.created_at
    });
  } catch (error: any) {
    console.error("[USER] Get stats error:", error);
    return c.json({ error: "Failed to fetch user stats" }, 500);
  }
});

// NOTE: /api/search is defined above (line ~2599) with Python Worker semantic search + D1 fallback.
// The old unified search was removed as it was unreachable (duplicate route).

// Search articles by keyword
app.get("/api/search/by-keyword/:keyword", async (c) => {
  try {
    const keyword = c.req.param("keyword");
    const limit = parseInt(c.req.query("limit") || "20");
    const offset = parseInt(c.req.query("offset") || "0");

    const articlesResult = await c.env.DB.prepare(`
      SELECT a.id, a.title, a.slug, a.description, a.author, a.source,
             a.source_id, a.category_id, a.published_at, a.image_url
      FROM articles a
      INNER JOIN article_keyword_links akl ON a.id = akl.article_id
      INNER JOIN keywords k ON akl.keyword_id = k.id
      WHERE a.status = 'published' AND k.slug = ?
      ORDER BY a.published_at DESC
      LIMIT ? OFFSET ?
    `).bind(keyword, limit, offset).all();

    const totalResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as total
      FROM articles a
      INNER JOIN article_keyword_links akl ON a.id = akl.article_id
      INNER JOIN keywords k ON akl.keyword_id = k.id
      WHERE a.status = 'published' AND k.slug = ?
    `).bind(keyword).first();

    return c.json({
      keyword,
      articles: articlesResult.results || [],
      total: totalResult.total || 0,
      limit,
      offset
    });
  } catch (error: any) {
    console.error("[SEARCH] Keyword search error:", error);
    return c.json({ error: "Keyword search failed" }, 500);
  }
});

// Search articles by author
app.get("/api/search/by-author", async (c) => {
  try {
    const author = c.req.query("author") || "";
    const limit = parseInt(c.req.query("limit") || "20");
    const offset = parseInt(c.req.query("offset") || "0");

    if (!author) {
      return c.json({ error: "Author parameter is required" }, 400);
    }

    const articlesResult = await c.env.DB.prepare(`
      SELECT id, title, slug, description, author, source, source_id,
             category_id, published_at, image_url
      FROM articles
      WHERE status = 'published' AND author = ?
      ORDER BY published_at DESC
      LIMIT ? OFFSET ?
    `).bind(author, limit, offset).all();

    const totalResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as total FROM articles
      WHERE status = 'published' AND author = ?
    `).bind(author).first();

    return c.json({
      author,
      articles: articlesResult.results || [],
      total: totalResult.total || 0,
      limit,
      offset
    });
  } catch (error: any) {
    console.error("[SEARCH] Author search error:", error);
    return c.json({ error: "Author search failed" }, 500);
  }
});

// ============================================================
// SEO & SITEMAP ENDPOINTS
// ============================================================

import { SEOService } from "./services/SEOService.js";

// Dynamic sitemap index
app.get("/sitemap.xml", async (c) => {
  try {
    const seoService = new SEOService(c.env.DB);
    const sitemap = await seoService.generateSitemapIndex();
    return new Response(sitemap, {
      headers: {
        "Content-Type": "application/xml",
        "Cache-Control": "public, max-age=3600" // 1 hour cache
      }
    });
  } catch (error: any) {
    console.error("[SEO] Sitemap index error:", error);
    return c.text("Sitemap generation failed", 500);
  }
});

// Articles sitemap
app.get("/sitemap-articles.xml", async (c) => {
  try {
    const seoService = new SEOService(c.env.DB);
    const sitemap = await seoService.generateArticleSitemap({ limit: 5000 });
    return new Response(sitemap, {
      headers: {
        "Content-Type": "application/xml",
        "Cache-Control": "public, max-age=3600"
      }
    });
  } catch (error: any) {
    console.error("[SEO] Articles sitemap error:", error);
    return c.text("Sitemap generation failed", 500);
  }
});

// Google News sitemap (last 2 days)
app.get("/sitemap-news.xml", async (c) => {
  try {
    const seoService = new SEOService(c.env.DB);
    const sitemap = await seoService.generateNewsSitemap();
    return new Response(sitemap, {
      headers: {
        "Content-Type": "application/xml",
        "Cache-Control": "public, max-age=900" // 15 min cache for news
      }
    });
  } catch (error: any) {
    console.error("[SEO] News sitemap error:", error);
    return c.text("Sitemap generation failed", 500);
  }
});

// Category-specific sitemap
app.get("/sitemap-:category.xml", async (c) => {
  try {
    const category = c.req.param("category");
    if (category === "articles" || category === "news") {
      return c.notFound(); // Already handled above
    }
    const seoService = new SEOService(c.env.DB);
    const sitemap = await seoService.generateArticleSitemap({
      category,
      limit: 2000
    });
    return new Response(sitemap, {
      headers: {
        "Content-Type": "application/xml",
        "Cache-Control": "public, max-age=3600"
      }
    });
  } catch (error: any) {
    console.error("[SEO] Category sitemap error:", error);
    return c.text("Sitemap generation failed", 500);
  }
});

// Get SEO metadata for an article (for SSR/prerendering)
app.get("/api/seo/article/:slug", async (c) => {
  try {
    const slug = c.req.param("slug");
    const article = await c.env.DB.prepare(`
      SELECT id, slug, title, description, content, author, category, tags,
             image_url, optimized_image_url, published_at, updated_at, word_count, source
      FROM articles
      WHERE slug = ? AND status = 'published'
    `).bind(slug).first();

    if (!article) {
      return c.json({ error: "Article not found" }, 404);
    }

    const seoService = new SEOService(c.env.DB);
    const seo = await seoService.generateArticleSEO(article as any);

    return c.json({
      success: true,
      seo,
      metaTags: seoService.generateMetaTags(seo)
    });
  } catch (error: any) {
    console.error("[SEO] Article SEO error:", error);
    return c.json({ error: "SEO generation failed" }, 500);
  }
});

// Get SEO metadata for homepage
app.get("/api/seo/homepage", async (c) => {
  try {
    const seoService = new SEOService(c.env.DB);
    const seo = seoService.generateHomepageSEO();

    return c.json({
      success: true,
      seo,
      metaTags: seoService.generateMetaTags(seo)
    });
  } catch (error: any) {
    console.error("[SEO] Homepage SEO error:", error);
    return c.json({ error: "SEO generation failed" }, 500);
  }
});

// Get SEO metadata for category page
app.get("/api/seo/category/:category", async (c) => {
  try {
    const category = c.req.param("category");

    // Get article count for category
    const countResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM articles
      WHERE category = ? AND status = 'published'
    `).bind(category).first();

    const seoService = new SEOService(c.env.DB);
    const seo = seoService.generateCategorySEO(category, (countResult as any)?.count || 0);

    return c.json({
      success: true,
      seo,
      metaTags: seoService.generateMetaTags(seo)
    });
  } catch (error: any) {
    console.error("[SEO] Category SEO error:", error);
    return c.json({ error: "SEO generation failed" }, 500);
  }
});

// Admin: Batch update SEO for articles
app.post("/api/admin/seo/batch-update", async (c) => {
  try {
    const { batchSize = 100 } = await c.req.json().catch(() => ({}));

    const seoService = new SEOService(c.env.DB);
    const result = await seoService.autoUpdateArticleSEO(batchSize);

    return c.json({
      success: true,
      message: `Updated SEO for ${result.updated} articles`,
      ...result
    });
  } catch (error: any) {
    console.error("[SEO] Batch update error:", error);
    return c.json({ error: "SEO batch update failed" }, 500);
  }
});

// Admin: Get SEO status/stats
app.get("/api/admin/seo/stats", async (c) => {
  try {
    const stats = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total_articles,
        SUM(CASE WHEN meta_description IS NOT NULL AND meta_description != '' THEN 1 ELSE 0 END) as with_meta_description,
        SUM(CASE WHEN seo_title IS NOT NULL AND seo_title != '' THEN 1 ELSE 0 END) as with_seo_title,
        SUM(CASE WHEN canonical_url IS NOT NULL AND canonical_url != '' THEN 1 ELSE 0 END) as with_canonical,
        SUM(CASE WHEN og_image IS NOT NULL AND og_image != '' THEN 1 ELSE 0 END) as with_og_image,
        SUM(CASE WHEN seo_updated_at IS NOT NULL THEN 1 ELSE 0 END) as with_seo_data,
        SUM(CASE WHEN seo_updated_at IS NULL OR seo_updated_at < datetime('now', '-7 days') THEN 1 ELSE 0 END) as needs_update
      FROM articles
      WHERE status = 'published'
    `).first();

    return c.json({
      success: true,
      stats: {
        totalArticles: (stats as any)?.total_articles || 0,
        withMetaDescription: (stats as any)?.with_meta_description || 0,
        withSeoTitle: (stats as any)?.with_seo_title || 0,
        withCanonical: (stats as any)?.with_canonical || 0,
        withOgImage: (stats as any)?.with_og_image || 0,
        withSeoData: (stats as any)?.with_seo_data || 0,
        needsUpdate: (stats as any)?.needs_update || 0
      }
    });
  } catch (error: any) {
    console.error("[SEO] Stats error:", error);
    return c.json({ error: "Failed to get SEO stats" }, 500);
  }
});

// robots.txt
app.get("/robots.txt", async (c) => {
  const robotsTxt = `# Mukoko News - Zimbabwe's Modern News Platform
User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin/
Allow: /api/seo/

# Sitemaps
Sitemap: https://news.mukoko.com/sitemap.xml
Sitemap: https://news.mukoko.com/sitemap-news.xml

# Crawl delay for polite crawling
Crawl-delay: 1
`;

  return new Response(robotsTxt, {
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "public, max-age=86400" // 24 hour cache
    }
  });
});

// Scheduled handler for cron jobs with rotating batch processing
// Cron runs every 6 hours (0, 6, 12, 18 UTC), rotating through batches
const scheduledHandler = async (
  controller: ScheduledController,
  env: Bindings,
  ctx: ExecutionContext
) => {
  console.log(`[CRON] Scheduled task triggered at ${new Date().toISOString()}`);
  console.log(`[CRON] Cron expression: ${controller.cron}`);

  try {
    // Determine which batch to process based on hour (rotates through batches)
    // 0h = batch 0, 6h = batch 1, 12h = batch 2, 18h = batch 3
    const hour = new Date(controller.scheduledTime).getUTCHours();
    const batchIndex = Math.floor(hour / 6); // 0, 1, 2, or 3

    // 1. Delegate RSS feed collection to Python Worker
    console.log(`[CRON] Starting RSS feed refresh via Python Worker (batch ${batchIndex})...`);
    const processingClient = new ProcessingClient(env.DATA_PROCESSOR);
    const rssStartTime = Date.now();

    const rssResult = await processingClient.collectFeeds({ batch: batchIndex, batchSize: 40 });
    const rssDuration = Date.now() - rssStartTime;

    console.log(`[CRON] RSS batch complete: ${rssResult.newArticles} new articles, ${rssResult.errors} errors in ${rssDuration}ms`);

    // Log RSS refresh to database
    await env.DB.prepare(`
      INSERT INTO cron_logs (cron_type, status, articles_processed, errors, execution_time_ms, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      `rss_refresh_batch_${batchIndex}`,
      rssResult.errors === 0 ? 'success' : 'partial',
      rssResult.newArticles,
      rssResult.errors,
      rssDuration
    ).run();

    // 2. Run SEO batch update
    console.log('[CRON] Starting SEO batch update...');
    const seoService = new SEOService(env.DB);
    const seoStartTime = Date.now();
    const seoResult = await seoService.autoUpdateArticleSEO(200); // Process 200 articles per run
    const seoDuration = Date.now() - seoStartTime;

    console.log(`[CRON] SEO update complete: ${seoResult.updated} updated, ${seoResult.errors} errors in ${seoDuration}ms`);

    // Log SEO update to database
    await env.DB.prepare(`
      INSERT INTO cron_logs (cron_type, status, articles_processed, errors, execution_time_ms, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      'seo_batch_update',
      seoResult.errors === 0 ? 'success' : 'partial',
      seoResult.updated,
      seoResult.errors,
      seoDuration
    ).run();

  } catch (error: any) {
    console.error('[CRON] Scheduled task failed:', error);

    // Log failure
    await env.DB.prepare(`
      INSERT INTO cron_logs (cron_type, status, error_message, created_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).bind('scheduled_task', 'failed', error.message).run();
  }
};

// Type for scheduled controller
interface ScheduledController {
  scheduledTime: number;
  cron: string;
  noRetry(): void;
}

export default {
  fetch: app.fetch,
  scheduled: scheduledHandler
};