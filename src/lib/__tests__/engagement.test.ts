import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Db } from 'mongodb'
import {
  resolveEngagementSubject,
  claimSessionEngagement,
  userEngagementKey,
  USER_KEY_PREFIX,
} from '../engagement'

const { mockWithAuth } = vi.hoisted(() => ({ mockWithAuth: vi.fn() }))

vi.mock('@workos-inc/authkit-nextjs', () => ({
  withAuth: mockWithAuth,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockWithAuth.mockResolvedValue({ user: null })
})

describe('userEngagementKey', () => {
  it('prefixes the WorkOS user id so key spaces never collide', () => {
    expect(userEngagementKey('user_123')).toBe(`${USER_KEY_PREFIX}user_123`)
  })
})

describe('resolveEngagementSubject', () => {
  it('returns the stable user key when signed in', async () => {
    mockWithAuth.mockResolvedValue({ user: { id: 'user_123' } })
    const subject = await resolveEngagementSubject('cookie-abc')
    expect(subject).toEqual({ key: 'user:user_123', isUser: true })
  })

  it('returns the cookie session when anonymous', async () => {
    const subject = await resolveEngagementSubject('cookie-abc')
    expect(subject).toEqual({ key: 'cookie-abc', isUser: false })
  })

  it('returns a null key when anonymous with no cookie', async () => {
    const subject = await resolveEngagementSubject(undefined)
    expect(subject).toEqual({ key: null, isUser: false })
  })

  it('degrades to anonymous when withAuth() throws (auth must never break engagement)', async () => {
    mockWithAuth.mockRejectedValue(new Error('WorkOS misconfigured'))
    const subject = await resolveEngagementSubject('cookie-abc')
    expect(subject).toEqual({ key: 'cookie-abc', isUser: false })
  })
})

/** Minimal fake of the two collection surfaces claimSessionEngagement touches. */
function fakeDb(ownedByCollection: Record<string, string[]>) {
  const calls: Record<string, { updateMany: unknown[]; deleteMany: unknown[] }> = {}
  const db = {
    collection: (name: string) => {
      calls[name] ??= { updateMany: [], deleteMany: [] }
      return {
        find: () => ({
          map: () => ({
            toArray: async () => ownedByCollection[name] ?? [],
          }),
        }),
        updateMany: async (filter: unknown, update: unknown) => {
          calls[name].updateMany.push([filter, update])
          return { modifiedCount: 0 }
        },
        deleteMany: async (filter: unknown) => {
          calls[name].deleteMany.push(filter)
          return { deletedCount: 0 }
        },
      }
    },
  } as unknown as Db
  return { db, calls }
}

describe('claimSessionEngagement', () => {
  it('re-keys cookie docs to the user key and cleans up leftovers in both collections', async () => {
    const { db, calls } = fakeDb({})
    await claimSessionEngagement(db, 'cookie-abc', 'user:user_123')

    for (const name of ['articleSaves', 'articleLikes']) {
      expect(calls[name].updateMany).toEqual([
        [{ sessionId: 'cookie-abc' }, { $set: { sessionId: 'user:user_123' } }],
      ])
      expect(calls[name].deleteMany).toEqual([{ sessionId: 'cookie-abc' }])
    }
  })

  it('excludes articles the user already owns from the re-key (user doc wins)', async () => {
    const { db, calls } = fakeDb({ articleSaves: ['a1', 'a2'] })
    await claimSessionEngagement(db, 'cookie-abc', 'user:user_123')

    expect(calls['articleSaves'].updateMany).toEqual([
      [
        { sessionId: 'cookie-abc', articleId: { $nin: ['a1', 'a2'] } },
        { $set: { sessionId: 'user:user_123' } },
      ],
    ])
    // Overlapping cookie docs still get dropped.
    expect(calls['articleSaves'].deleteMany).toEqual([{ sessionId: 'cookie-abc' }])
  })

  it('no-ops when the cookie key is empty or already the user key', async () => {
    const { db, calls } = fakeDb({})
    await claimSessionEngagement(db, '', 'user:user_123')
    await claimSessionEngagement(db, 'user:user_123', 'user:user_123')
    expect(Object.keys(calls)).toHaveLength(0)
  })

  it('swallows collection errors (best-effort, converges on the next interaction)', async () => {
    const db = {
      collection: () => {
        throw new Error('mongo down')
      },
    } as unknown as Db
    await expect(claimSessionEngagement(db, 'cookie-abc', 'user:u')).resolves.toBeUndefined()
  })
})
