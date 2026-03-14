/**
 * SSEStreamService - Server-Sent Events for real-time news streaming
 *
 * No competitor offers real-time streaming. Mukoko leapfrogs everyone.
 *
 * Provides:
 * - Breaking news alerts (instant push to connected clients)
 * - Live article updates (new articles as they're published)
 * - Trending topic changes
 * - Source health status updates
 *
 * SSE is chosen over WebSocket because:
 * - Simpler (one-directional, server → client)
 * - Works through proxies and CDNs
 * - Auto-reconnects natively in browsers
 * - Compatible with Cloudflare Workers (via TransformStream)
 */

export interface SSEEvent {
  id: string;
  event: SSEEventType;
  data: Record<string, unknown>;
  retry?: number;
}

export type SSEEventType =
  | 'article.new'
  | 'article.update'
  | 'breaking_news'
  | 'trending.update'
  | 'source.health'
  | 'heartbeat';

export interface SSEStreamOptions {
  events?: SSEEventType[];
  countries?: string[];
  categories?: string[];
  sources?: string[];
  heartbeatIntervalMs?: number;
}

export class SSEStreamService {
  private activeStreams: Map<string, {
    controller: ReadableStreamDefaultController;
    options: SSEStreamOptions;
    connectedAt: string;
    lastEventId: string;
  }> = new Map();

  constructor(private db: D1Database) {}

  /**
   * Create an SSE stream for a client
   * Returns a ReadableStream that can be used as a Response body
   */
  createStream(options: SSEStreamOptions = {}): {
    stream: ReadableStream;
    streamId: string;
  } {
    const streamId = crypto.randomUUID();
    const heartbeatInterval = options.heartbeatIntervalMs ?? 30000; // 30s default
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
      start: (controller) => {
        this.activeStreams.set(streamId, {
          controller,
          options,
          connectedAt: new Date().toISOString(),
          lastEventId: '',
        });

        // Send initial connection event
        const connectEvent = this.formatSSE({
          id: crypto.randomUUID(),
          event: 'heartbeat',
          data: {
            type: 'connected',
            streamId,
            subscribedEvents: options.events ?? ['all'],
            filters: {
              countries: options.countries ?? [],
              categories: options.categories ?? [],
              sources: options.sources ?? [],
            },
          },
          retry: 5000, // Client should reconnect after 5s if disconnected
        });

        controller.enqueue(new TextEncoder().encode(connectEvent));

        // Start heartbeat
        heartbeatTimer = setInterval(() => {
          try {
            const heartbeat = this.formatSSE({
              id: crypto.randomUUID(),
              event: 'heartbeat',
              data: {
                type: 'ping',
                timestamp: new Date().toISOString(),
                activeStreams: this.activeStreams.size,
              },
            });
            controller.enqueue(new TextEncoder().encode(heartbeat));
          } catch {
            // Stream might be closed
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            this.activeStreams.delete(streamId);
          }
        }, heartbeatInterval);
      },

      cancel: () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        this.activeStreams.delete(streamId);
      },
    });

    return { stream, streamId };
  }

  /**
   * Push an event to all matching streams
   */
  pushEvent(event: SSEEvent): number {
    let pushed = 0;
    const encoder = new TextEncoder();
    const formatted = this.formatSSE(event);

    for (const [streamId, streamInfo] of this.activeStreams) {
      if (!this.matchesStream(event, streamInfo.options)) continue;

      try {
        streamInfo.controller.enqueue(encoder.encode(formatted));
        streamInfo.lastEventId = event.id;
        pushed++;
      } catch {
        // Stream is closed, remove it
        this.activeStreams.delete(streamId);
      }
    }

    return pushed;
  }

  /**
   * Push a breaking news event
   */
  pushBreakingNews(article: {
    id: string;
    title: string;
    description: string;
    source_name: string;
    country_code: string;
    category?: string;
    url: string;
  }): number {
    return this.pushEvent({
      id: crypto.randomUUID(),
      event: 'breaking_news',
      data: {
        article,
        urgency: 'high',
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Push a new article event
   */
  pushNewArticle(article: {
    id: string;
    title: string;
    description: string;
    source_name: string;
    country_code: string;
    category?: string;
    image_url?: string;
    published_at: string;
  }): number {
    return this.pushEvent({
      id: crypto.randomUUID(),
      event: 'article.new',
      data: { article, timestamp: new Date().toISOString() },
    });
  }

  /**
   * Push trending topics update
   */
  pushTrendingUpdate(trending: Array<{
    keyword: string;
    score: number;
    change: 'up' | 'down' | 'new' | 'stable';
  }>): number {
    return this.pushEvent({
      id: crypto.randomUUID(),
      event: 'trending.update',
      data: { topics: trending, timestamp: new Date().toISOString() },
    });
  }

  /**
   * Push source health update
   */
  pushSourceHealthUpdate(source: {
    id: string;
    name: string;
    previous_status: string;
    new_status: string;
    country_code: string;
  }): number {
    return this.pushEvent({
      id: crypto.randomUUID(),
      event: 'source.health',
      data: { source, timestamp: new Date().toISOString() },
    });
  }

  /**
   * Get stream status info
   */
  getStreamInfo(): {
    activeStreams: number;
    streams: Array<{
      id: string;
      connectedAt: string;
      subscribedEvents: SSEEventType[] | string[];
      filters: {
        countries: string[];
        categories: string[];
        sources: string[];
      };
    }>;
  } {
    const streams = Array.from(this.activeStreams.entries()).map(([id, info]) => ({
      id,
      connectedAt: info.connectedAt,
      subscribedEvents: info.options.events ?? ['all'],
      filters: {
        countries: info.options.countries ?? [],
        categories: info.options.categories ?? [],
        sources: info.options.sources ?? [],
      },
    }));

    return {
      activeStreams: this.activeStreams.size,
      streams,
    };
  }

  /**
   * Close a specific stream
   */
  closeStream(streamId: string): boolean {
    const stream = this.activeStreams.get(streamId);
    if (!stream) return false;

    try {
      stream.controller.close();
    } catch {
      // Already closed
    }
    this.activeStreams.delete(streamId);
    return true;
  }

  /**
   * Close all streams (for graceful shutdown)
   */
  closeAllStreams(): number {
    let closed = 0;
    for (const [streamId, stream] of this.activeStreams) {
      try {
        stream.controller.close();
      } catch {
        // Already closed
      }
      this.activeStreams.delete(streamId);
      closed++;
    }
    return closed;
  }

  /**
   * Replay missed events for a reconnecting client
   * Uses Last-Event-ID header
   */
  async replayEvents(
    lastEventId: string,
    options: SSEStreamOptions
  ): Promise<SSEEvent[]> {
    // Get events since the last event ID from DB
    const result = await this.db.prepare(`
      SELECT * FROM sse_event_log
      WHERE id > ?
      ORDER BY created_at ASC
      LIMIT 100
    `).bind(lastEventId).all();

    return (result.results ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      event: row.event as SSEEventType,
      data: JSON.parse((row.data as string) || '{}'),
    }));
  }

  // --- Private ---

  private formatSSE(event: SSEEvent): string {
    const lines: string[] = [];
    lines.push(`id: ${event.id}`);
    lines.push(`event: ${event.event}`);
    if (event.retry !== undefined) {
      lines.push(`retry: ${event.retry}`);
    }
    lines.push(`data: ${JSON.stringify(event.data)}`);
    lines.push(''); // Empty line terminates the event
    lines.push(''); // Extra newline for SSE spec
    return lines.join('\n');
  }

  private matchesStream(event: SSEEvent, options: SSEStreamOptions): boolean {
    // Check event type filter
    if (options.events?.length) {
      if (!options.events.includes(event.event)) return false;
    }

    // Check country filter
    if (options.countries?.length) {
      const country = event.data.country_code as string
        ?? (event.data.article as Record<string, unknown>)?.country_code as string;
      if (country && !options.countries.includes(country)) return false;
    }

    // Check category filter
    if (options.categories?.length) {
      const category = event.data.category as string
        ?? (event.data.article as Record<string, unknown>)?.category as string;
      if (category && !options.categories.includes(category)) return false;
    }

    // Check source filter
    if (options.sources?.length) {
      const source = event.data.source_id as string
        ?? (event.data.source as Record<string, unknown>)?.id as string;
      if (source && !options.sources.includes(source)) return false;
    }

    return true;
  }
}
