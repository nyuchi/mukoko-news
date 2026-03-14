/**
 * Realtime Analytics Durable Object
 * Handles real-time analytics aggregation and live metrics
 * Replaces Analytics Engine for detailed, immediate insights
 */

export interface AnalyticsEvent {
  type: string
  data: Record<string, any>
  userId?: string
  sessionId?: string
  articleId?: number
  categoryId?: string
  timestamp: number
  metadata: {
    ip?: string
    userAgent?: string
    referer?: string
    device?: string
    browser?: string
    os?: string
    country?: string
    city?: string
  }
}

export interface LiveMetrics {
  activeUsers: number
  pageViews: number
  articlesRead: number
  topArticles: Array<{ id: number; headline: string; views: number }>
  topCategories: Array<{ id: string; name: string; views: number }>
  realtimeEvents: AnalyticsEvent[]
  lastUpdated: number
}

export class RealtimeAnalyticsDO {
  private state: DurableObjectState
  private env: any
  private sessions: Map<string, WebSocket> = new Map()
  private liveMetrics: LiveMetrics
  private eventBuffer: AnalyticsEvent[] = []
  private flushInterval?: number

  constructor(state: DurableObjectState, env: any) {
    this.state = state
    this.env = env
    
    // Initialize live metrics
    this.liveMetrics = {
      activeUsers: 0,
      pageViews: 0,
      articlesRead: 0,
      topArticles: [],
      topCategories: [],
      realtimeEvents: [],
      lastUpdated: Date.now()
    }
    
    // Set up periodic flushing to D1 database
    this.setupPeriodicFlush()
  }

  /**
   * Handle HTTP requests to the Durable Object
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    switch (path) {
      case '/ws':
        return this.handleWebSocket(request)
      case '/metrics':
        return this.handleGetMetrics()
      case '/event':
        return this.handleTrackEvent(request)
      default:
        return new Response('Not found', { status: 404 })
    }
  }

  /**
   * Handle WebSocket connections for real-time updates
   */
  private async handleWebSocket(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade')
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected websocket', { status: 400 })
    }

    const webSocketPair = new WebSocketPair()
    const [client, server] = Object.values(webSocketPair)

    const sessionId = crypto.randomUUID()
    this.sessions.set(sessionId, server)

    server.accept()
    
    // Send current metrics to new connection
    server.send(JSON.stringify({
      type: 'metrics',
      data: this.liveMetrics
    }))

    // Handle WebSocket messages
    server.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data as string)
        this.handleWebSocketMessage(sessionId, message)
      } catch (error) {
        console.error('Invalid WebSocket message:', error)
      }
    })

    // Clean up on close
    server.addEventListener('close', () => {
      this.sessions.delete(sessionId)
      this.updateActiveUsers()
    })

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  /**
   * Handle WebSocket messages from clients
   */
  private handleWebSocketMessage(sessionId: string, message: any): void {
    switch (message.type) {
      case 'heartbeat':
        // Keep connection alive and track active user
        const ws = this.sessions.get(sessionId)
        if (ws) {
          ws.send(JSON.stringify({ type: 'pong' }))
        }
        break
      case 'page_view':
        this.trackEvent({
          type: 'page_view',
          data: message.data,
          sessionId,
          timestamp: Date.now(),
          metadata: message.metadata || {}
        })
        break
      default:
        console.log('Unknown WebSocket message type:', message.type)
    }
  }

  /**
   * Get current live metrics
   */
  private async handleGetMetrics(): Promise<Response> {
    return new Response(JSON.stringify(this.liveMetrics), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  /**
   * Track analytics event
   */
  private async handleTrackEvent(request: Request): Promise<Response> {
    try {
      const event: AnalyticsEvent = await request.json()
      event.timestamp = Date.now()
      
      this.trackEvent(event)
      
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Invalid event data' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }
  }

  /**
   * Core event tracking logic
   */
  private trackEvent(event: AnalyticsEvent): void {
    // Add to event buffer
    this.eventBuffer.push(event)
    
    // Update live metrics based on event type
    this.updateLiveMetrics(event)
    
    // Add to realtime events (keep last 100)
    this.liveMetrics.realtimeEvents.unshift(event)
    if (this.liveMetrics.realtimeEvents.length > 100) {
      this.liveMetrics.realtimeEvents.pop()
    }
    
    this.liveMetrics.lastUpdated = Date.now()
    
    // Broadcast to all connected clients
    this.broadcastUpdate(event)
  }

  /**
   * Update live metrics based on event
   */
  private updateLiveMetrics(event: AnalyticsEvent): void {
    switch (event.type) {
      case 'page_view':
        this.liveMetrics.pageViews++
        break
      case 'article_view':
        this.liveMetrics.articlesRead++
        this.updateTopArticles(event)
        this.updateTopCategories(event)
        break
    }
    
    this.updateActiveUsers()
  }

  /**
   * Update active users count
   */
  private updateActiveUsers(): void {
    this.liveMetrics.activeUsers = this.sessions.size
  }

  /**
   * Update top articles ranking
   */
  private updateTopArticles(event: AnalyticsEvent): void {
    if (!event.articleId || !event.data.headline) return

    const existing = this.liveMetrics.topArticles.find(a => a.id === event.articleId)
    if (existing) {
      existing.views++
    } else {
      this.liveMetrics.topArticles.push({
        id: event.articleId,
        headline: event.data.headline,
        views: 1
      })
    }
    
    // Keep top 10, sorted by views
    this.liveMetrics.topArticles.sort((a, b) => b.views - a.views)
    this.liveMetrics.topArticles = this.liveMetrics.topArticles.slice(0, 10)
  }

  /**
   * Update top categories ranking
   */
  private updateTopCategories(event: AnalyticsEvent): void {
    if (!event.categoryId || !event.data.categoryName) return
    
    const existing = this.liveMetrics.topCategories.find(c => c.id === event.categoryId)
    if (existing) {
      existing.views++
    } else {
      this.liveMetrics.topCategories.push({
        id: event.categoryId,
        name: event.data.categoryName,
        views: 1
      })
    }
    
    // Keep top 5, sorted by views
    this.liveMetrics.topCategories.sort((a, b) => b.views - a.views)
    this.liveMetrics.topCategories = this.liveMetrics.topCategories.slice(0, 5)
  }

  /**
   * Broadcast update to all connected clients
   */
  private broadcastUpdate(event: AnalyticsEvent): void {
    const message = JSON.stringify({
      type: 'live_update',
      data: {
        event,
        metrics: {
          activeUsers: this.liveMetrics.activeUsers,
          pageViews: this.liveMetrics.pageViews,
          articlesRead: this.liveMetrics.articlesRead
        }
      }
    })

    for (const [sessionId, ws] of this.sessions) {
      try {
        ws.send(message)
      } catch (error) {
        console.error(`Failed to send to session ${sessionId}:`, error)
        this.sessions.delete(sessionId)
      }
    }
  }

  /**
   * Set up periodic flush to D1 database
   */
  private setupPeriodicFlush(): void {
    // Flush events to D1 every 30 seconds
    this.flushInterval = setInterval(() => {
      this.flushToDatabase()
    }, 30000) as any
  }

  /**
   * Flush buffered events to D1 database
   */
  private async flushToDatabase(): Promise<void> {
    if (this.eventBuffer.length === 0) return

    try {
      const db = this.env.DB
      const events = [...this.eventBuffer]
      this.eventBuffer = []

      // Batch insert events
      for (const event of events) {
        await db
          .prepare(`
            INSERT INTO analytics_events (
              event_type, event_data, user_id, session_id, article_id,
              article_section_id, ip_address, user_agent, referer, device_type, 
              browser, os, country, city, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          `)
          .bind(
            event.type,
            JSON.stringify(event.data),
            event.userId || null,
            event.sessionId || null,
            event.articleId || null,
            event.categoryId || null,
            event.metadata.ip || null,
            event.metadata.userAgent || null,
            event.metadata.referer || null,
            event.metadata.device || null,
            event.metadata.browser || null,
            event.metadata.os || null,
            event.metadata.country || null,
            event.metadata.city || null
          )
          .run()
      }

      console.log(`Flushed ${events.length} events to D1 database`)
    } catch (error) {
      console.error('Failed to flush events to database:', error)
      // Re-add events to buffer on failure
      this.eventBuffer.unshift(...this.eventBuffer)
    }
  }

  /**
   * Get aggregated analytics for admin dashboard
   */
  async getAnalyticsSummary(timeframe: string = '24h'): Promise<any> {
    const db = this.env.DB

    // Strict whitelist for timeframe to prevent SQL injection
    const timeConditions: Record<string, string> = {
      '1h': "created_at >= datetime('now', '-1 hour')",
      '24h': "created_at >= datetime('now', '-24 hours')",
      '7d': "created_at >= datetime('now', '-7 days')",
      '30d': "created_at >= datetime('now', '-30 days')",
    }
    const timeCondition = timeConditions[timeframe] || timeConditions['24h']

    const [totalEvents, topArticles, topCategories, userActivity] = await Promise.all([
      // Total events by type
      db.prepare(`
        SELECT event_type, COUNT(*) as count 
        FROM analytics_events 
        WHERE ${timeCondition}
        GROUP BY event_type
        ORDER BY count DESC
      `).all(),
      
      // Top articles
      db.prepare(`
        SELECT article_id, COUNT(*) as views
        FROM analytics_events 
        WHERE event_type = 'article_view' AND ${timeCondition}
        GROUP BY article_id
        ORDER BY views DESC
        LIMIT 10
      `).all(),
      
      // Top categories
      db.prepare(`
        SELECT article_section_id, COUNT(*) as views
        FROM analytics_events
        WHERE event_type = 'article_view' AND ${timeCondition}
        GROUP BY article_section_id
        ORDER BY views DESC
        LIMIT 5
      `).all(),
      
      // User activity patterns
      db.prepare(`
        SELECT strftime('%H', created_at) as hour, COUNT(*) as events
        FROM analytics_events 
        WHERE ${timeCondition}
        GROUP BY hour
        ORDER BY hour
      `).all()
    ])

    return {
      live: this.liveMetrics,
      summary: {
        totalEvents: totalEvents.results,
        topArticles: topArticles.results,
        topCategories: topCategories.results,
        userActivity: userActivity.results
      },
      timeframe,
      generatedAt: Date.now()
    }
  }

  /**
   * Cleanup when Durable Object is destroyed
   */
  async alarm(): Promise<void> {
    // Flush any remaining events before shutdown
    await this.flushToDatabase()
    
    if (this.flushInterval) {
      clearInterval(this.flushInterval)
    }
  }
}