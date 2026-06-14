import { NextResponse } from 'next/server'
import { getDb } from '@/lib/mongodb/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APPROVED = ['approved', 'published']
const ONE_DAY = 24 * 60 * 60 * 1000
const EIGHT_DAYS = 8 * ONE_DAY
const THIRTY_DAYS = 30 * ONE_DAY

export async function GET() {
  const db = await getDb()
  const now = Date.now()
  const recent24h = new Date(now - ONE_DAY)
  const baseline8d = new Date(now - EIGHT_DAYS)
  const last30d = new Date(now - THIRTY_DAYS)

  const [trending, surgeRaw, countryBreakdown, categoryBreakdown, totalArticles, activeSources] =
    await Promise.all([
      // Trending topics (last 7 days by article count)
      db
        .collection('articles')
        .aggregate([
          { $match: { status: { $in: APPROVED }, datePublished: { $gte: new Date(now - 7 * ONE_DAY) } } },
          { $unwind: '$tagIds' },
          { $group: { _id: '$tagIds', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 20 },
          {
            $lookup: {
              from: 'tags',
              localField: '_id',
              foreignField: '_id',
              as: '_tag',
              pipeline: [{ $project: { name: 1, tagSlug: 1 } }],
            },
          },
          { $unwind: { path: '$_tag', preserveNullAndEmpty: false } },
          { $project: { _id: 0, tag_id: '$_id', name: '$_tag.name', slug: '$_tag.tagSlug', count: 1 } },
        ])
        .toArray(),

      // Surge detection: recent 24h count vs 7-day daily avg
      db
        .collection('articles')
        .aggregate([
          { $match: { status: { $in: APPROVED }, datePublished: { $gte: baseline8d } } },
          { $unwind: '$tagIds' },
          {
            $group: {
              _id: '$tagIds',
              recent: {
                $sum: { $cond: [{ $gte: ['$datePublished', recent24h] }, 1, 0] },
              },
              baseline_total: {
                $sum: { $cond: [{ $lt: ['$datePublished', recent24h] }, 1, 0] },
              },
            },
          },
          {
            $addFields: {
              daily_avg: { $divide: ['$baseline_total', 7] },
            },
          },
          {
            $match: {
              recent: { $gt: 0 },
              $expr: {
                $gte: ['$recent', { $multiply: ['$daily_avg', 2] }],
              },
            },
          },
          { $sort: { recent: -1 } },
          { $limit: 10 },
          {
            $lookup: {
              from: 'tags',
              localField: '_id',
              foreignField: '_id',
              as: '_tag',
              pipeline: [{ $project: { name: 1 } }],
            },
          },
          { $unwind: { path: '$_tag', preserveNullAndEmpty: false } },
          {
            $project: {
              _id: 0,
              tag: '$_tag.name',
              recent_24h: '$recent',
              daily_avg: { $round: ['$daily_avg', 1] },
              multiplier: {
                $round: [
                  { $cond: [{ $gt: ['$daily_avg', 0] }, { $divide: ['$recent', '$daily_avg'] }, '$recent'] },
                  1,
                ],
              },
            },
          },
        ])
        .toArray(),

      // Country breakdown (last 30d)
      db
        .collection('articles')
        .aggregate([
          { $match: { status: { $in: APPROVED }, datePublished: { $gte: last30d } } },
          {
            $lookup: {
              from: 'feedSources',
              localField: 'feedSourceId',
              foreignField: '_id',
              as: '_src',
              pipeline: [{ $project: { countryCode: 1, name: 1 } }],
            },
          },
          { $unwind: { path: '$_src', preserveNullAndEmpty: false } },
          { $group: { _id: '$_src.countryCode', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 16 },
          { $project: { _id: 0, country: '$_id', count: 1 } },
        ])
        .toArray(),

      // Category breakdown (last 30d)
      db
        .collection('articles')
        .aggregate([
          {
            $match: {
              status: { $in: APPROVED },
              datePublished: { $gte: last30d },
              articleSection: { $nin: [null, ''] },
            },
          },
          { $group: { _id: '$articleSection', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 12 },
          { $project: { _id: 0, category: '$_id', count: 1 } },
        ])
        .toArray(),

      // Total article count
      db.collection('articles').countDocuments({ status: { $in: APPROVED } }),

      // Active sources
      db.collection('feedSources').countDocuments({ isActive: true }),
    ])

  return NextResponse.json({
    meta: { generated_at: new Date().toISOString(), total_articles: totalArticles, active_sources: activeSources },
    trending_topics: trending,
    surge_alerts: surgeRaw,
    country_breakdown: countryBreakdown,
    category_breakdown: categoryBreakdown,
  })
}
