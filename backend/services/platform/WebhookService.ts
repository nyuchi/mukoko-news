/**
 * WebhookService - Event-driven webhook subscriptions and delivery
 *
 * No competitor offers webhooks. Mukoko leapfrogs everyone here.
 *
 * Developers can subscribe to events like:
 * - article.published - New article published
 * - article.updated - Article content updated
 * - breaking_news - Breaking news alert
 * - source.health_changed - Source health status changed
 * - category.trending - Category is trending
 * - keyword.discovered - New keyword/tag discovered
 *
 * Features:
 * - HMAC signature verification (SHA-256)
 * - Exponential backoff retry (3 attempts)
 * - Delivery logging and analytics
 * - Webhook testing endpoint
 */

export interface WebhookSubscription {
  id: string;
  api_key_id: string;
  url: string;
  events: WebhookEvent[];
  secret: string;       // HMAC secret for signature verification
  is_active: boolean;
  description: string;
  filters: WebhookFilters;
  delivery_stats: {
    total_sent: number;
    total_failed: number;
    last_delivery_at: string | null;
    last_status_code: number | null;
    consecutive_failures: number;
  };
  created_at: string;
  updated_at: string;
}

export type WebhookEvent =
  | 'article.published'
  | 'article.updated'
  | 'article.deleted'
  | 'article.flagged'
  | 'breaking_news'
  | 'source.added'
  | 'source.removed'
  | 'source.health_changed'
  | 'category.created'
  | 'category.trending'
  | 'keyword.discovered'
  | 'keyword.trending'
  | 'publisher.verified'
  | 'publisher.article_submitted'
  | 'moderation.completed';

export interface WebhookFilters {
  countries?: string[];     // Only events from these countries
  categories?: string[];    // Only events in these categories
  sources?: string[];       // Only events from these sources
  min_quality_score?: number; // Only articles above this quality
}

export interface WebhookDelivery {
  id: string;
  subscription_id: string;
  event: WebhookEvent;
  payload: Record<string, unknown>;
  status: 'pending' | 'delivered' | 'failed' | 'retrying';
  attempt: number;
  max_attempts: number;
  response_status: number | null;
  response_body: string | null;
  error: string | null;
  delivered_at: string | null;
  next_retry_at: string | null;
  created_at: string;
}

export interface WebhookPayload {
  id: string;
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, unknown>;
  _mukoko: {
    version: '1.0';
    platform: 'mukoko-news';
  };
}

export class WebhookService {
  constructor(private db: D1Database) {}

  /**
   * Create a webhook subscription
   */
  async createSubscription(params: {
    api_key_id: string;
    url: string;
    events: WebhookEvent[];
    description?: string;
    filters?: WebhookFilters;
  }): Promise<WebhookSubscription> {
    // Validate URL
    try {
      const url = new URL(params.url);
      if (url.protocol !== 'https:') {
        throw new WebhookError('Webhook URL must use HTTPS', 'INVALID_URL');
      }
    } catch (error) {
      if (error instanceof WebhookError) throw error;
      throw new WebhookError('Invalid webhook URL', 'INVALID_URL');
    }

    const id = crypto.randomUUID();
    const secret = await this.generateSecret();
    const now = new Date().toISOString();

    await this.db.prepare(`
      INSERT INTO webhook_subscriptions
        (id, api_key_id, url, events, secret, is_active, description,
         filters, total_sent, total_failed, consecutive_failures,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, 0, 0, 0, ?, ?)
    `).bind(
      id, params.api_key_id, params.url,
      JSON.stringify(params.events),
      secret,
      params.description ?? '',
      JSON.stringify(params.filters ?? {}),
      now, now
    ).run();

    return (await this.getSubscription(id))!;
  }

  /**
   * Get a webhook subscription
   */
  async getSubscription(id: string): Promise<WebhookSubscription | null> {
    const result = await this.db.prepare(
      'SELECT * FROM webhook_subscriptions WHERE id = ?'
    ).bind(id).first();

    if (!result) return null;
    return this.rowToSubscription(result);
  }

  /**
   * List subscriptions for an API key
   */
  async listSubscriptions(apiKeyId: string): Promise<WebhookSubscription[]> {
    const result = await this.db.prepare(`
      SELECT * FROM webhook_subscriptions
      WHERE api_key_id = ?
      ORDER BY created_at DESC
    `).bind(apiKeyId).all();

    return (result.results ?? []).map(row => this.rowToSubscription(row as Record<string, unknown>));
  }

  /**
   * Update a subscription
   */
  async updateSubscription(
    id: string,
    updates: Partial<{
      url: string;
      events: WebhookEvent[];
      description: string;
      filters: WebhookFilters;
      is_active: boolean;
    }>
  ): Promise<WebhookSubscription | null> {
    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (updates.url !== undefined) {
      setClauses.push('url = ?');
      params.push(updates.url);
    }
    if (updates.events !== undefined) {
      setClauses.push('events = ?');
      params.push(JSON.stringify(updates.events));
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?');
      params.push(updates.description);
    }
    if (updates.filters !== undefined) {
      setClauses.push('filters = ?');
      params.push(JSON.stringify(updates.filters));
    }
    if (updates.is_active !== undefined) {
      setClauses.push('is_active = ?');
      params.push(updates.is_active ? 1 : 0);
    }

    setClauses.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    await this.db.prepare(`
      UPDATE webhook_subscriptions SET ${setClauses.join(', ')} WHERE id = ?
    `).bind(...params).run();

    return this.getSubscription(id);
  }

  /**
   * Delete a subscription
   */
  async deleteSubscription(id: string): Promise<void> {
    await this.db.prepare('DELETE FROM webhook_subscriptions WHERE id = ?').bind(id).run();
  }

  /**
   * Dispatch an event to all matching subscriptions
   */
  async dispatch(
    event: WebhookEvent,
    data: Record<string, unknown>
  ): Promise<{ dispatched: number; failed: number }> {
    // Find all active subscriptions for this event
    const subscriptions = await this.db.prepare(`
      SELECT * FROM webhook_subscriptions
      WHERE is_active = 1
        AND events LIKE ?
        AND consecutive_failures < 10
    `).bind(`%"${event}"%`).all();

    let dispatched = 0;
    let failed = 0;

    for (const row of (subscriptions.results ?? [])) {
      const sub = this.rowToSubscription(row as Record<string, unknown>);

      // Check filters
      if (!this.matchesFilters(sub.filters, data)) continue;

      // Build payload
      const payload: WebhookPayload = {
        id: crypto.randomUUID(),
        event,
        timestamp: new Date().toISOString(),
        data,
        _mukoko: {
          version: '1.0',
          platform: 'mukoko-news',
        },
      };

      // Deliver
      const success = await this.deliver(sub, payload);
      if (success) dispatched++;
      else failed++;
    }

    return { dispatched, failed };
  }

  /**
   * Deliver a webhook to a single subscription
   */
  private async deliver(
    subscription: WebhookSubscription,
    payload: WebhookPayload,
    attempt: number = 1,
    maxAttempts: number = 3
  ): Promise<boolean> {
    const body = JSON.stringify(payload);
    const signature = await this.sign(body, subscription.secret);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const response = await fetch(subscription.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Mukoko-Signature': signature,
          'X-Mukoko-Event': payload.event,
          'X-Mukoko-Delivery': payload.id,
          'X-Mukoko-Timestamp': payload.timestamp,
          'User-Agent': 'MukokoNews-Webhook/1.0',
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // Log delivery
      await this.logDelivery({
        id: crypto.randomUUID(),
        subscription_id: subscription.id,
        event: payload.event,
        payload: payload.data,
        status: response.ok ? 'delivered' : 'failed',
        attempt,
        max_attempts: maxAttempts,
        response_status: response.status,
        response_body: (await response.text()).slice(0, 500),
        error: response.ok ? null : `HTTP ${response.status}`,
        delivered_at: response.ok ? new Date().toISOString() : null,
        next_retry_at: null,
        created_at: new Date().toISOString(),
      });

      if (response.ok) {
        // Reset failure counter
        await this.db.prepare(`
          UPDATE webhook_subscriptions
          SET total_sent = total_sent + 1,
              consecutive_failures = 0,
              last_delivery_at = ?,
              last_status_code = ?
          WHERE id = ?
        `).bind(new Date().toISOString(), response.status, subscription.id).run();
        return true;
      }

      // Retry on failure
      if (attempt < maxAttempts) {
        const backoffMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        return this.deliver(subscription, payload, attempt + 1, maxAttempts);
      }

      // Max retries reached
      await this.db.prepare(`
        UPDATE webhook_subscriptions
        SET total_failed = total_failed + 1,
            consecutive_failures = consecutive_failures + 1,
            last_status_code = ?
        WHERE id = ?
      `).bind(response.status, subscription.id).run();

      return false;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await this.logDelivery({
        id: crypto.randomUUID(),
        subscription_id: subscription.id,
        event: payload.event,
        payload: payload.data,
        status: 'failed',
        attempt,
        max_attempts: maxAttempts,
        response_status: null,
        response_body: null,
        error: errorMessage,
        delivered_at: null,
        next_retry_at: null,
        created_at: new Date().toISOString(),
      });

      if (attempt < maxAttempts) {
        const backoffMs = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        return this.deliver(subscription, payload, attempt + 1, maxAttempts);
      }

      await this.db.prepare(`
        UPDATE webhook_subscriptions
        SET total_failed = total_failed + 1, consecutive_failures = consecutive_failures + 1
        WHERE id = ?
      `).bind(subscription.id).run();

      return false;
    }
  }

  /**
   * Send a test webhook to verify endpoint
   */
  async test(subscriptionId: string): Promise<{
    success: boolean;
    statusCode: number | null;
    error: string | null;
    latencyMs: number;
  }> {
    const subscription = await this.getSubscription(subscriptionId);
    if (!subscription) {
      return { success: false, statusCode: null, error: 'Subscription not found', latencyMs: 0 };
    }

    const payload: WebhookPayload = {
      id: crypto.randomUUID(),
      event: 'article.published',
      timestamp: new Date().toISOString(),
      data: {
        test: true,
        message: 'This is a test webhook from Mukoko News',
        article: {
          id: 'test-123',
          title: 'Test Article',
          source: 'Mukoko News',
          country_code: 'ZW',
        },
      },
      _mukoko: { version: '1.0', platform: 'mukoko-news' },
    };

    const body = JSON.stringify(payload);
    const signature = await this.sign(body, subscription.secret);
    const start = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(subscription.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Mukoko-Signature': signature,
          'X-Mukoko-Event': 'article.published',
          'X-Mukoko-Delivery': payload.id,
          'X-Mukoko-Test': 'true',
          'User-Agent': 'MukokoNews-Webhook/1.0',
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      return {
        success: response.ok,
        statusCode: response.status,
        error: response.ok ? null : `HTTP ${response.status}`,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return {
        success: false,
        statusCode: null,
        error: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - start,
      };
    }
  }

  /**
   * Get delivery history for a subscription
   */
  async getDeliveryHistory(
    subscriptionId: string,
    limit: number = 50
  ): Promise<WebhookDelivery[]> {
    const result = await this.db.prepare(`
      SELECT * FROM webhook_deliveries
      WHERE subscription_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(subscriptionId, limit).all();

    return (result.results ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      subscription_id: row.subscription_id as string,
      event: row.event as WebhookEvent,
      payload: JSON.parse((row.payload as string) || '{}'),
      status: row.status as WebhookDelivery['status'],
      attempt: row.attempt as number,
      max_attempts: row.max_attempts as number,
      response_status: row.response_status as number | null,
      response_body: row.response_body as string | null,
      error: row.error as string | null,
      delivered_at: row.delivered_at as string | null,
      next_retry_at: row.next_retry_at as string | null,
      created_at: row.created_at as string,
    }));
  }

  // --- Private ---

  private async sign(payload: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const hashArray = Array.from(new Uint8Array(signature));
    return 'sha256=' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private async generateSecret(): Promise<string> {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return 'whsec_' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private matchesFilters(
    filters: WebhookFilters,
    data: Record<string, unknown>
  ): boolean {
    if (filters.countries?.length) {
      const country = data.country_code as string;
      if (country && !filters.countries.includes(country)) return false;
    }

    if (filters.categories?.length) {
      const category = data.category as string;
      if (category && !filters.categories.includes(category)) return false;
    }

    if (filters.sources?.length) {
      const source = data.source_id as string;
      if (source && !filters.sources.includes(source)) return false;
    }

    if (filters.min_quality_score !== undefined) {
      const score = data.quality_score as number;
      if (score !== undefined && score < filters.min_quality_score) return false;
    }

    return true;
  }

  private async logDelivery(delivery: WebhookDelivery): Promise<void> {
    try {
      await this.db.prepare(`
        INSERT INTO webhook_deliveries
          (id, subscription_id, event, payload, status, attempt,
           max_attempts, response_status, response_body, error,
           delivered_at, next_retry_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        delivery.id, delivery.subscription_id, delivery.event,
        JSON.stringify(delivery.payload), delivery.status,
        delivery.attempt, delivery.max_attempts,
        delivery.response_status, delivery.response_body,
        delivery.error, delivery.delivered_at,
        delivery.next_retry_at, delivery.created_at
      ).run();
    } catch (error) {
      console.error('[WEBHOOK] Failed to log delivery:', error);
    }
  }

  private rowToSubscription(row: Record<string, unknown>): WebhookSubscription {
    return {
      id: row.id as string,
      api_key_id: row.api_key_id as string,
      url: row.url as string,
      events: JSON.parse((row.events as string) || '[]'),
      secret: row.secret as string,
      is_active: Boolean(row.is_active),
      description: row.description as string,
      filters: JSON.parse((row.filters as string) || '{}'),
      delivery_stats: {
        total_sent: (row.total_sent as number) ?? 0,
        total_failed: (row.total_failed as number) ?? 0,
        last_delivery_at: row.last_delivery_at as string | null,
        last_status_code: row.last_status_code as number | null,
        consecutive_failures: (row.consecutive_failures as number) ?? 0,
      },
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}

export class WebhookError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'WebhookError';
  }
}
