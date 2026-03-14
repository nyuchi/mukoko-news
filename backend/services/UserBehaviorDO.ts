/**
 * User Behavior Durable Object
 * Tracks individual user activity, preferences, and personalized data
 * Uses Cloudflare Durable Objects for real-time state management
 */

export interface UserActivity {
  type: 'page_view' | 'article_read' | 'search' | 'category_browse' | 'share' | 'bookmark' | 'like'
  articleId?: number
  categoryId?: string
  searchQuery?: string
  duration?: number
  scrollDepth?: number
  timestamp: number
  metadata?: Record<string, any>
}

export interface ReadingSession {
  articleId: number
  startTime: number
  endTime?: number
  scrollDepth: number
  readingTime: number
  completed: boolean
  source: string // how they arrived at article
}

export interface UserBehaviorState {
  userId: string
  
  // Activity tracking
  totalPageViews: number
  totalReadingTime: number // in seconds
  articlesRead: number
  averageReadingTime: number
  
  // Preferences (learned behavior)
  favoriteCategories: Map<string, number> // category -> engagement score
  readingTimes: number[] // preferred reading times (hour of day)
  preferredSources: Map<string, number> // source -> engagement score
  
  // Current session
  currentSession?: {
    startTime: number
    activities: UserActivity[]
    articlesViewed: Set<number>
  }
  
  // Recent activity (last 24 hours)
  recentArticles: Set<number>
  recentCategories: Map<string, number>
  
  // Personalization scores
  interestScores: Map<string, number> // topic/keyword -> interest score
  
  lastUpdated: number
  connections: Map<string, WebSocket>
}

export class UserBehaviorDO {
  private state: DurableObjectState
  private env: any
  private userState: UserBehaviorState
  private pendingWrites: UserActivity[] = []
  private flushTimeout?: any
  private sessionTimeout?: any

  constructor(state: DurableObjectState, env: any) {
    this.state = state
    this.env = env
    
    this.initializeState()
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    switch (path) {
      case '/ws':
        return this.handleWebSocket(request)
      case '/activity':
        if (method === 'POST') {
          return this.trackActivity(request)
        } else if (method === 'GET') {
          return this.getActivity()
        }
        break
      case '/session':
        if (method === 'POST') {
          return this.startSession(request)
        } else if (method === 'PUT') {
          return this.updateSession(request)
        } else if (method === 'DELETE') {
          return this.endSession()
        }
        break
      case '/preferences':
        return this.getPreferences()
      case '/recommendations':
        return this.getRecommendations()
      case '/stats':
        return this.getUserStats()
      default:
        return new Response('Not found', { status: 404 })
    }

    return new Response('Method not allowed', { status: 405 })
  }

  /**
   * Initialize user state from storage
   */
  private async initializeState(): Promise<void> {
    try {
      const stored = await this.state.storage.get('userState')
      
      if (stored) {
        const parsed = stored as any
        this.userState = {
          ...parsed,
          favoriteCategories: new Map(parsed.favoriteCategories || []),
          preferredSources: new Map(parsed.preferredSources || []),
          recentArticles: new Set(parsed.recentArticles || []),
          recentCategories: new Map(parsed.recentCategories || []),
          interestScores: new Map(parsed.interestScores || []),
          connections: new Map(),
          currentSession: parsed.currentSession ? {
            ...parsed.currentSession,
            articlesViewed: new Set(parsed.currentSession.articlesViewed || [])
          } : undefined
        }
      } else {
        // Initialize new user state
        this.userState = {
          userId: '',
          totalPageViews: 0,
          totalReadingTime: 0,
          articlesRead: 0,
          averageReadingTime: 0,
          favoriteCategories: new Map(),
          readingTimes: [],
          preferredSources: new Map(),
          recentArticles: new Set(),
          recentCategories: new Map(),
          interestScores: new Map(),
          lastUpdated: Date.now(),
          connections: new Map()
        }
      }
    } catch (error) {
      console.error('Failed to initialize user state:', error)
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

    const connectionId = crypto.randomUUID()
    this.userState.connections.set(connectionId, server)

    server.accept()
    
    // Send current user state
    server.send(JSON.stringify({
      type: 'user_state',
      data: {
        totalPageViews: this.userState.totalPageViews,
        articlesRead: this.userState.articlesRead,
        totalReadingTime: this.userState.totalReadingTime,
        averageReadingTime: this.userState.averageReadingTime,
        favoriteCategories: Array.from(this.userState.favoriteCategories.entries()).slice(0, 5)
      }
    }))

    // Handle connection close
    server.addEventListener('close', () => {
      this.userState.connections.delete(connectionId)
    })

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  /**
   * Track user activity
   */
  private async trackActivity(request: Request): Promise<Response> {
    const body = await request.json() as {
      type?: string;
      articleId?: string;
      categoryId?: string;
      searchQuery?: string;
      duration?: number;
      scrollDepth?: number;
      metadata?: Record<string, unknown>;
    }
    const activity: UserActivity = {
      type: (body.type as UserActivity['type']) || 'page_view',
      articleId: body.articleId ? Number(body.articleId) : undefined,
      categoryId: body.categoryId,
      searchQuery: body.searchQuery,
      duration: body.duration,
      scrollDepth: body.scrollDepth,
      timestamp: Date.now(),
      metadata: body.metadata
    }

    // Update user state based on activity
    await this.processActivity(activity)

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  /**
   * Start a new user session
   */
  private async startSession(request: Request): Promise<Response> {
    const body = await request.json() as { userId?: string }
    const { userId } = body

    if (this.userState.userId === '') {
      this.userState.userId = userId
    }

    this.userState.currentSession = {
      startTime: Date.now(),
      activities: [],
      articlesViewed: new Set()
    }

    await this.saveState()

    return new Response(JSON.stringify({ success: true, sessionStart: Date.now() }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  /**
   * Update current session
   */
  private async updateSession(request: Request): Promise<Response> {
    const body = await request.json() as { activity?: UserActivity }
    const { activity } = body

    if (!this.userState.currentSession) {
      return new Response('No active session', { status: 400 })
    }

    this.userState.currentSession.activities.push(activity)
    
    if (activity.articleId) {
      this.userState.currentSession.articlesViewed.add(activity.articleId)
    }

    await this.processActivity(activity)

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  /**
   * End current session
   */
  private async endSession(): Promise<Response> {
    if (!this.userState.currentSession) {
      return new Response('No active session', { status: 400 })
    }

    const session = this.userState.currentSession
    const sessionDuration = Date.now() - session.startTime

    // Update user statistics
    this.userState.totalPageViews += session.activities.length
    this.userState.articlesRead += session.articlesViewed.size

    // Calculate average reading time
    const readingActivities = session.activities.filter(a => a.type === 'article_read' && a.duration)
    if (readingActivities.length > 0) {
      const totalReading = readingActivities.reduce((sum, a) => sum + (a.duration || 0), 0)
      this.userState.totalReadingTime += totalReading
      this.userState.averageReadingTime = this.userState.totalReadingTime / this.userState.articlesRead
    }

    // Store session data for analysis
    await this.storeSessionData(session, sessionDuration)

    // Clear current session
    this.userState.currentSession = undefined
    await this.saveState()

    return new Response(JSON.stringify({ 
      success: true, 
      sessionDuration,
      stats: {
        totalPageViews: this.userState.totalPageViews,
        articlesRead: this.userState.articlesRead,
        totalReadingTime: this.userState.totalReadingTime
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  /**
   * Get user preferences based on behavior
   */
  private async getPreferences(): Promise<Response> {
    const preferences = {
      favoriteCategories: Array.from(this.userState.favoriteCategories.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
      preferredSources: Array.from(this.userState.preferredSources.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
      readingTimes: this.getPreferredReadingTimes(),
      interestScores: Array.from(this.userState.interestScores.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
    }

    return new Response(JSON.stringify(preferences), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  /**
   * Get personalized recommendations
   */
  private async getRecommendations(): Promise<Response> {
    try {
      const db = this.env.DB
      
      // Get articles from user's favorite categories
      const topCategories = Array.from(this.userState.favoriteCategories.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([category]) => category)

      if (topCategories.length === 0) {
        // No preferences yet, return trending articles
        const trending = await db
          .prepare(`
            SELECT * FROM articles 
            WHERE created_at > datetime('now', '-24 hours')
            ORDER BY view_count DESC 
            LIMIT 10
          `)
          .all()
        
        return new Response(JSON.stringify({ 
          type: 'trending', 
          articles: trending.results 
        }), {
          headers: { 'Content-Type': 'application/json' }
        })
      }

      // Get personalized recommendations
      const recommendations = await db
        .prepare(`
          SELECT a.*, COUNT(DISTINCT l.user_id) as like_count
          FROM articles a
          LEFT JOIN user_likes l ON a.id = l.article_id
          WHERE a.category IN (${topCategories.map(() => '?').join(',')})
          AND a.id NOT IN (${Array.from(this.userState.recentArticles).join(',') || '0'})
          GROUP BY a.id
          ORDER BY like_count DESC, a.created_at DESC
          LIMIT 10
        `)
        .bind(...topCategories)
        .all()

      return new Response(JSON.stringify({
        type: 'personalized',
        articles: recommendations.results,
        basedOn: topCategories
      }), {
        headers: { 'Content-Type': 'application/json' }
      })
    } catch (error) {
      console.error('Failed to get recommendations:', error)
      return new Response(JSON.stringify({ error: 'Failed to get recommendations' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }
  }

  /**
   * Get user statistics
   */
  private async getUserStats(): Promise<Response> {
    const stats = {
      totalPageViews: this.userState.totalPageViews,
      articlesRead: this.userState.articlesRead,
      totalReadingTime: this.userState.totalReadingTime,
      averageReadingTime: this.userState.averageReadingTime,
      readingStreak: await this.calculateReadingStreak(),
      topCategories: Array.from(this.userState.favoriteCategories.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3),
      activityThisWeek: await this.getWeeklyActivity(),
      lastActive: this.userState.lastUpdated
    }

    return new Response(JSON.stringify(stats), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  /**
   * Process user activity and update behavior patterns
   */
  private async processActivity(activity: UserActivity): Promise<void> {
    // Add to pending writes
    this.pendingWrites.push(activity)

    // Update behavior patterns
    if (activity.categoryId) {
      const current = this.userState.favoriteCategories.get(activity.categoryId) || 0
      this.userState.favoriteCategories.set(activity.categoryId, current + 1)
      
      const recentCount = this.userState.recentCategories.get(activity.categoryId) || 0
      this.userState.recentCategories.set(activity.categoryId, recentCount + 1)
    }

    if (activity.articleId) {
      this.userState.recentArticles.add(activity.articleId)
      
      // Keep only recent articles (last 100)
      if (this.userState.recentArticles.size > 100) {
        const articlesArray = Array.from(this.userState.recentArticles)
        this.userState.recentArticles = new Set(articlesArray.slice(-100))
      }
    }

    // Track reading time patterns
    const hour = new Date().getHours()
    if (!this.userState.readingTimes.includes(hour)) {
      this.userState.readingTimes.push(hour)
    }

    this.userState.lastUpdated = Date.now()
    
    // Save state and broadcast update
    await this.saveState()
    this.broadcastUpdate(activity)
    
    // Schedule flush to D1
    this.scheduleFlush()
  }

  /**
   * Save state to Durable Object storage
   */
  private async saveState(): Promise<void> {
    try {
      const stateToSave = {
        ...this.userState,
        favoriteCategories: Array.from(this.userState.favoriteCategories.entries()),
        preferredSources: Array.from(this.userState.preferredSources.entries()),
        recentArticles: Array.from(this.userState.recentArticles),
        recentCategories: Array.from(this.userState.recentCategories.entries()),
        interestScores: Array.from(this.userState.interestScores.entries()),
        connections: undefined,
        currentSession: this.userState.currentSession ? {
          ...this.userState.currentSession,
          articlesViewed: Array.from(this.userState.currentSession.articlesViewed)
        } : undefined
      }
      
      await this.state.storage.put('userState', stateToSave)
    } catch (error) {
      console.error('Failed to save user state:', error)
    }
  }

  /**
   * Broadcast updates to connected clients
   */
  private broadcastUpdate(activity: UserActivity): void {
    const update = {
      type: 'activity_update',
      data: {
        activity,
        stats: {
          totalPageViews: this.userState.totalPageViews,
          articlesRead: this.userState.articlesRead,
          totalReadingTime: this.userState.totalReadingTime
        }
      }
    }

    const message = JSON.stringify(update)
    
    for (const [connectionId, ws] of this.userState.connections) {
      try {
        ws.send(message)
      } catch (error) {
        console.error(`Failed to send to connection ${connectionId}:`, error)
        this.userState.connections.delete(connectionId)
      }
    }
  }

  /**
   * Schedule flush to D1 database
   */
  private scheduleFlush(): void {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout)
    }

    this.flushTimeout = setTimeout(() => {
      this.flushToD1()
    }, 10000) // Flush every 10 seconds

    if (this.pendingWrites.length >= 20) {
      this.flushToD1()
    }
  }

  /**
   * Flush activities to D1 database
   */
  private async flushToD1(): Promise<void> {
    if (this.pendingWrites.length === 0) return

    try {
      const activities = [...this.pendingWrites]
      this.pendingWrites = []

      const db = this.env.DB

      // Store activities in analytics_events table
      for (const activity of activities) {
        await db
          .prepare(`
            INSERT INTO analytics_events (
              event_type, event_data, user_id, article_id, article_section_id, created_at
            ) VALUES (?, ?, ?, ?, ?, datetime('now'))
          `)
          .bind(
            activity.type,
            JSON.stringify(activity.metadata || {}),
            this.userState.userId,
            activity.articleId || null,
            activity.categoryId || null
          )
          .run()
      }

      console.log(`Flushed ${activities.length} activities for user ${this.userState.userId}`)
    } catch (error) {
      console.error('Failed to flush user activities:', error)
    }
  }

  private getActivity(): Promise<Response> {
    return new Promise(resolve => {
      resolve(new Response(JSON.stringify({
        currentSession: this.userState.currentSession,
        recentActivities: this.pendingWrites.slice(-10),
        stats: {
          totalPageViews: this.userState.totalPageViews,
          articlesRead: this.userState.articlesRead,
          totalReadingTime: this.userState.totalReadingTime
        }
      }), {
        headers: { 'Content-Type': 'application/json' }
      }))
    })
  }

  private async calculateReadingStreak(): Promise<number> {
    // Implement reading streak calculation
    return 0 // Placeholder
  }

  private async getWeeklyActivity(): Promise<any[]> {
    // Implement weekly activity calculation
    return [] // Placeholder
  }

  private getPreferredReadingTimes(): number[] {
    // Get most common reading hours
    const hourCounts = this.userState.readingTimes.reduce((acc, hour) => {
      acc[hour] = (acc[hour] || 0) + 1
      return acc
    }, {} as Record<number, number>)

    return Object.entries(hourCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([hour]) => parseInt(hour))
  }

  private async storeSessionData(session: any, duration: number): Promise<void> {
    // Store session data in D1 for analysis
    try {
      const db = this.env.DB
      await db
        .prepare(`
          INSERT INTO user_sessions (
            user_id, session_data, duration, articles_viewed, created_at
          ) VALUES (?, ?, ?, ?, datetime('now'))
        `)
        .bind(
          this.userState.userId,
          JSON.stringify({
            activities: session.activities,
            articlesViewed: Array.from(session.articlesViewed)
          }),
          duration,
          session.articlesViewed.size
        )
        .run()
    } catch (error) {
      console.error('Failed to store session data:', error)
    }
  }
}