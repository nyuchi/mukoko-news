/**
 * Realtime Counters Durable Object
 * Global counters and live metrics for the entire platform
 * Handles platform-wide statistics that all users see
 */

export interface GlobalMetrics {
  // User metrics
  activeUsers: number
  totalUsers: number
  usersOnline: number
  
  // Content metrics
  totalArticles: number
  articlesPublishedToday: number
  totalLikes: number
  totalShares: number
  totalBookmarks: number
  
  // Engagement metrics
  pageViewsToday: number
  totalPageViews: number
  averageReadingTime: number
  
  // Top content
  trendingArticles: Array<{
    id: number
    headline: string
    likes: number
    views: number
    category: string
  }>
  
  trendingCategories: Array<{
    id: string
    name: string
    articles: number
    engagement: number
  }>
  
  // System health
  systemHealth: 'healthy' | 'degraded' | 'unhealthy'
  lastUpdated: number
}

export interface CounterUpdate {
  type: 'increment' | 'decrement' | 'set'
  metric: string
  value: number
  metadata?: Record<string, any>
}

export class RealtimeCountersDO {
  private state: DurableObjectState
  private env: any
  private metrics: GlobalMetrics
  private connections: Map<string, WebSocket> = new Map()
  private pendingUpdates: CounterUpdate[] = []
  private flushInterval?: number
  private metricsUpdateInterval?: number

  constructor(state: DurableObjectState, env: any) {
    this.state = state
    this.env = env
    
    this.initializeMetrics()
    this.startPeriodicUpdates()
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    switch (path) {
      case '/ws':
        return this.handleWebSocket(request)
      case '/metrics':
        if (method === 'GET') {
          return this.getMetrics()
        }
        break
      case '/update':
        if (method === 'POST') {
          return this.updateCounter(request)
        }
        break
      case '/trending':
        return this.getTrending()
      case '/health':
        return this.getSystemHealth()
      case '/admin/stats':
        return this.getAdminStats()
      default:
        return new Response('Not found', { status: 404 })
    }

    return new Response('Method not allowed', { status: 405 })
  }

  /**
   * Initialize metrics from storage or set defaults
   */
  private async initializeMetrics(): Promise<void> {
    try {
      const stored = await this.state.storage.get('globalMetrics')
      
      if (stored) {
        this.metrics = stored as GlobalMetrics
      } else {
        this.metrics = {
          activeUsers: 0,
          totalUsers: 0,
          usersOnline: 0,
          totalArticles: 0,
          articlesPublishedToday: 0,
          totalLikes: 0,
          totalShares: 0,
          totalBookmarks: 0,
          pageViewsToday: 0,
          totalPageViews: 0,
          averageReadingTime: 0,
          trendingArticles: [],
          trendingCategories: [],
          systemHealth: 'healthy',
          lastUpdated: Date.now()
        }
        
        // Load initial data from D1
        await this.loadInitialData()
      }
    } catch (error) {
      console.error('Failed to initialize metrics:', error)
    }
  }

  /**
   * Load initial data from D1 database
   */
  private async loadInitialData(): Promise<void> {
    try {
      const db = this.env.DB
      
      // Get total users
      const userCount = await db.prepare('SELECT COUNT(*) as count FROM users').first()
      this.metrics.totalUsers = userCount?.count || 0
      
      // Get total articles
      const articleCount = await db.prepare('SELECT COUNT(*) as count FROM articles').first()
      this.metrics.totalArticles = articleCount?.count || 0
      
      // Get articles published today
      const todayArticles = await db
        .prepare(`SELECT COUNT(*) as count FROM articles WHERE DATE(created_at) = DATE('now')`)
        .first()
      this.metrics.articlesPublishedToday = todayArticles?.count || 0
      
      // Get total likes
      const likesCount = await db.prepare('SELECT COUNT(*) as count FROM user_likes').first()
      this.metrics.totalLikes = likesCount?.count || 0
      
      // Get total bookmarks
      const bookmarksCount = await db.prepare('SELECT COUNT(*) as count FROM user_bookmarks').first()
      this.metrics.totalBookmarks = bookmarksCount?.count || 0
      
      // Get trending articles
      await this.updateTrendingContent()
      
      await this.saveMetrics()
    } catch (error) {
      console.error('Failed to load initial data:', error)
    }
  }

  /**
   * Handle WebSocket connections for real-time metrics
   */
  private async handleWebSocket(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade')
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected websocket', { status: 400 })
    }

    const webSocketPair = new WebSocketPair()
    const [client, server] = Object.values(webSocketPair)

    const connectionId = crypto.randomUUID()
    this.connections.set(connectionId, server)

    server.accept()
    
    // Send current metrics to new connection
    server.send(JSON.stringify({
      type: 'metrics_update',
      data: this.metrics
    }))

    // Update active users count
    this.metrics.usersOnline = this.connections.size
    this.broadcastUpdate({ type: 'users_online', data: this.metrics.usersOnline })

    // Handle connection close
    server.addEventListener('close', () => {
      this.connections.delete(connectionId)
      this.metrics.usersOnline = this.connections.size
      this.broadcastUpdate({ type: 'users_online', data: this.metrics.usersOnline })
    })

    // Handle ping/pong for connection health
    server.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data as string)
        if (message.type === 'ping') {
          server.send(JSON.stringify({ type: 'pong' }))
        }
      } catch (error) {
        console.error('Invalid WebSocket message:', error)
      }
    })

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  /**
   * Update counter values
   */
  private async updateCounter(request: Request): Promise<Response> {
    const body = await request.json() as {
      type?: 'increment' | 'decrement' | 'set';
      metric?: string;
      value?: number;
      metadata?: Record<string, unknown>;
    }
    const update: CounterUpdate = {
      type: body.type || 'increment',
      metric: body.metric || 'unknown',
      value: body.value || 0,
      metadata: body.metadata
    }

    await this.processCounterUpdate(update)

    return new Response(JSON.stringify({ 
      success: true, 
      currentValue: this.getMetricValue(update.metric)
    }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  /**
   * Process counter update
   */
  private async processCounterUpdate(update: CounterUpdate): Promise<void> {
    const { type, metric, value } = update
    
    switch (metric) {
      case 'totalLikes':
        if (type === 'increment') this.metrics.totalLikes += value
        else if (type === 'decrement') this.metrics.totalLikes -= value
        else this.metrics.totalLikes = value
        break
        
      case 'totalShares':
        if (type === 'increment') this.metrics.totalShares += value
        else if (type === 'decrement') this.metrics.totalShares -= value
        else this.metrics.totalShares = value
        break
        
      case 'totalBookmarks':
        if (type === 'increment') this.metrics.totalBookmarks += value
        else if (type === 'decrement') this.metrics.totalBookmarks -= value
        else this.metrics.totalBookmarks = value
        break
        
      case 'pageViewsToday':
        if (type === 'increment') this.metrics.pageViewsToday += value
        else if (type === 'decrement') this.metrics.pageViewsToday -= value
        else this.metrics.pageViewsToday = value
        break
        
      case 'totalPageViews':
        if (type === 'increment') this.metrics.totalPageViews += value
        else if (type === 'decrement') this.metrics.totalPageViews -= value
        else this.metrics.totalPageViews = value
        break
        
      case 'totalUsers':
        this.metrics.totalUsers = value
        break
        
      case 'totalArticles':
        this.metrics.totalArticles = value
        break
    }
    
    this.metrics.lastUpdated = Date.now()
    
    // Add to pending updates for batch processing
    this.pendingUpdates.push(update)
    
    // Save metrics and broadcast update
    await this.saveMetrics()
    this.broadcastUpdate({ type: 'counter_update', data: { metric, value: this.getMetricValue(metric) } })
  }

  /**
   * Get current metrics
   */
  private async getMetrics(): Promise<Response> {
    return new Response(JSON.stringify(this.metrics), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  /**
   * Get trending content
   */
  private async getTrending(): Promise<Response> {
    return new Response(JSON.stringify({
      articles: this.metrics.trendingArticles,
      categories: this.metrics.trendingCategories,
      lastUpdated: this.metrics.lastUpdated
    }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  /**
   * Get system health status
   */
  private async getSystemHealth(): Promise<Response> {
    // Calculate system health based on metrics
    let health: 'healthy' | 'degraded' | 'unhealthy' = 'healthy'
    
    if (this.connections.size === 0 && this.metrics.usersOnline > 0) {
      health = 'degraded' // WebSocket issues
    }
    
    if (Date.now() - this.metrics.lastUpdated > 300000) { // 5 minutes without update
      health = 'unhealthy'
    }
    
    this.metrics.systemHealth = health
    
    return new Response(JSON.stringify({
      status: health,
      metrics: {
        activeConnections: this.connections.size,
        lastUpdated: this.metrics.lastUpdated,
        usersOnline: this.metrics.usersOnline,
        totalUsers: this.metrics.totalUsers
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  /**
   * Get admin statistics
   */
  private async getAdminStats(): Promise<Response> {
    const stats = {
      users: {
        total: this.metrics.totalUsers,
        online: this.metrics.usersOnline,
        active: this.metrics.activeUsers
      },
      content: {
        totalArticles: this.metrics.totalArticles,
        publishedToday: this.metrics.articlesPublishedToday,
        totalLikes: this.metrics.totalLikes,
        totalShares: this.metrics.totalShares,
        totalBookmarks: this.metrics.totalBookmarks
      },
      engagement: {
        pageViewsToday: this.metrics.pageViewsToday,
        totalPageViews: this.metrics.totalPageViews,
        averageReadingTime: this.metrics.averageReadingTime
      },
      trending: {
        articles: this.metrics.trendingArticles.slice(0, 5),
        categories: this.metrics.trendingCategories.slice(0, 3)
      },
      system: {
        health: this.metrics.systemHealth,
        connections: this.connections.size,
        lastUpdated: this.metrics.lastUpdated
      }
    }

    return new Response(JSON.stringify(stats), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  /**
   * Update trending content from database
   */
  private async updateTrendingContent(): Promise<void> {
    try {
      const db = this.env.DB
      
      // Get trending articles (most liked/viewed in last 24 hours)
      const trendingArticles = await db
        .prepare(`
          SELECT a.id, a.headline, a.article_section_id,
                 COUNT(DISTINCT l.user_id) as likes,
                 a.view_count as views
          FROM articles a
          LEFT JOIN user_likes l ON a.id = l.article_id
            AND datetime(l.created_at) > datetime('now', '-24 hours')
          WHERE datetime(a.date_created) > datetime('now', '-7 days')
          GROUP BY a.id, a.headline, a.article_section_id, a.view_count
          ORDER BY (COUNT(DISTINCT l.user_id) * 2 + a.view_count) DESC
          LIMIT 10
        `)
        .all()
      
      this.metrics.trendingArticles = trendingArticles.results.map((article: any) => ({
        id: article.id,
        headline: article.headline,
        likes: article.likes,
        views: article.views,
        category: article.article_section_id
      }))
      
      // Get trending categories
      const trendingCategories = await db
        .prepare(`
          SELECT c.id, c.name, 
                 COUNT(DISTINCT a.id) as articles,
                 COUNT(DISTINCT l.user_id) as engagement
          FROM article_sections c
          JOIN articles a ON c.id = a.article_section_id
          LEFT JOIN user_likes l ON a.id = l.article_id
            AND datetime(l.created_at) > datetime('now', '-24 hours')
          WHERE c.enabled = true
          GROUP BY c.id, c.name
          ORDER BY engagement DESC, articles DESC
          LIMIT 5
        `)
        .all()
      
      this.metrics.trendingCategories = trendingCategories.results.map((category: any) => ({
        id: category.id,
        name: category.name,
        articles: category.articles,
        engagement: category.engagement
      }))
      
    } catch (error) {
      console.error('Failed to update trending content:', error)
    }
  }

  /**
   * Start periodic updates
   */
  private startPeriodicUpdates(): void {
    // Update trending content every 15 minutes
    this.metricsUpdateInterval = setInterval(() => {
      this.updateTrendingContent()
      this.saveMetrics()
    }, 15 * 60 * 1000) as any

    // Flush pending updates every 30 seconds
    this.flushInterval = setInterval(() => {
      this.flushUpdatesToD1()
    }, 30 * 1000) as any
  }

  /**
   * Flush pending updates to D1
   */
  private async flushUpdatesToD1(): Promise<void> {
    if (this.pendingUpdates.length === 0) return

    try {
      const updates = [...this.pendingUpdates]
      this.pendingUpdates = []

      const db = this.env.DB

      // Store metric updates for analytics
      for (const update of updates) {
        await db
          .prepare(`
            INSERT INTO system_metrics (
              name, value, type, tags, created_at
            ) VALUES (?, ?, 'counter', '{}', datetime('now'))
          `)
          .bind(update.metric, update.value)
          .run()
      }

      console.log(`Flushed ${updates.length} counter updates to D1`)
    } catch (error) {
      console.error('Failed to flush counter updates:', error)
    }
  }

  /**
   * Save metrics to storage
   */
  private async saveMetrics(): Promise<void> {
    try {
      await this.state.storage.put('globalMetrics', this.metrics)
    } catch (error) {
      console.error('Failed to save metrics:', error)
    }
  }

  /**
   * Broadcast update to all connected clients
   */
  private broadcastUpdate(update: any): void {
    const message = JSON.stringify(update)
    
    for (const [connectionId, ws] of this.connections) {
      try {
        ws.send(message)
      } catch (error) {
        console.error(`Failed to send to connection ${connectionId}:`, error)
        this.connections.delete(connectionId)
      }
    }
  }

  /**
   * Get metric value by name
   */
  private getMetricValue(metric: string): number {
    switch (metric) {
      case 'totalLikes': return this.metrics.totalLikes
      case 'totalShares': return this.metrics.totalShares
      case 'totalBookmarks': return this.metrics.totalBookmarks
      case 'pageViewsToday': return this.metrics.pageViewsToday
      case 'totalPageViews': return this.metrics.totalPageViews
      case 'totalUsers': return this.metrics.totalUsers
      case 'totalArticles': return this.metrics.totalArticles
      case 'usersOnline': return this.metrics.usersOnline
      default: return 0
    }
  }

  /**
   * Clean up intervals on destruction
   */
  async alarm(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval)
    }
    if (this.metricsUpdateInterval) {
      clearInterval(this.metricsUpdateInterval)
    }
    
    // Final flush
    await this.flushUpdatesToD1()
    await this.saveMetrics()
  }
}