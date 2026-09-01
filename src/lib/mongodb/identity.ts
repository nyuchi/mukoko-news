import type { Db } from 'mongodb'
import { MONGO_CLIENT_OPTIONS } from './client'
import { MongoClient } from 'mongodb'

/**
 * Reads and writes for the signed-in user's own person record.
 *
 * WHY THIS READS THE DB AND NOT THE SESSION
 * -----------------------------------------
 * `identity.persons` is the canonical person record for the whole platform, and
 * it carries strictly more than the WorkOS session claims do: the profile
 * picture is hosted on `profile-images.mukoko.com` (not a WorkOS URL), plus
 * `preferredUsername` and `interests`, none of which appear in the token. A
 * profile built from `useAuth()` alone shows a different, poorer user than the
 * one every other Mukoko app displays.
 *
 * SCOPE OF THE WRITES
 * -------------------
 * Only the signed-in user's OWN record, and only the fields a person owns:
 * `givenName`, `familyName`, `name`, `picture`, `preferredUsername`,
 * `interests`. Never another person's record, never another domain's
 * collection, and never fields this app does not own (`bundu`, `role`,
 * `workosUserId`, the merge bookkeeping). The article validators are
 * `moderate` and accept unknown fields silently, so that restraint is enforced
 * here by an explicit allowlist rather than by the schema.
 */

const IDENTITY_DB = 'identity'

let clientPromise: Promise<MongoClient> | null = null

/**
 * A separate connection accessor from `client.ts` only because that one is
 * pinned to `MONGODB_DATABASE` (the `news` DB). Same URI, same driver options,
 * same pooling — `MongoClient` multiplexes databases over one connection pool,
 * so this does not open a second pool.
 */
async function getIdentityDb(): Promise<Db> {
  if (!clientPromise) {
    const uri = process.env.MONGODB_URI
    if (!uri) throw new Error('MONGODB_URI environment variable is not set')
    clientPromise = new MongoClient(uri, MONGO_CLIENT_OPTIONS).connect()
  }
  return (await clientPromise).db(IDENTITY_DB)
}

/** The person fields this app reads and lets its owner edit. */
export interface MyProfile {
  personId: string | null
  givenName: string | null
  familyName: string | null
  name: string | null
  preferredUsername: string | null
  picture: string | null
  interests: string[]
}

const EMPTY: MyProfile = {
  personId: null,
  givenName: null,
  familyName: null,
  name: null,
  preferredUsername: null,
  picture: null,
  interests: [],
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

/**
 * The signed-in user's person record, matched on `workosUserId` — the same key
 * the gateway's webhook upserts on.
 *
 * Fail-soft like the other read layers in this repo: a degraded cluster yields
 * an empty-but-typed profile so the header and profile page still render from
 * the session rather than throwing.
 */
export async function getPersonByWorkosId(workosUserId: string): Promise<MyProfile> {
  try {
    const db = await getIdentityDb()
    const doc = await db.collection('persons').findOne(
      { workosUserId, isActive: { $ne: false } },
      {
        projection: {
          _id: 1,
          givenName: 1,
          familyName: 1,
          name: 1,
          preferredUsername: 1,
          picture: 1,
          interests: 1,
        },
      }
    )
    if (!doc) return EMPTY
    return {
      personId: typeof doc._id === 'string' ? doc._id : null,
      givenName: toStringOrNull(doc.givenName),
      familyName: toStringOrNull(doc.familyName),
      name: toStringOrNull(doc.name),
      preferredUsername: toStringOrNull(doc.preferredUsername),
      picture: toStringOrNull(doc.picture),
      interests: Array.isArray(doc.interests)
        ? doc.interests.filter((i): i is string => typeof i === 'string')
        : [],
    }
  } catch (error) {
    console.error('[identity] getPersonByWorkosId failed:', error)
    return EMPTY
  }
}

/** The only fields a person may change about themselves from this app. */
export interface PersonPatch {
  givenName?: string
  familyName?: string
  name?: string
  preferredUsername?: string
  interests?: string[]
}

/**
 * Update the signed-in user's own record.
 *
 * Matched on `workosUserId` so the caller can never address another person by
 * id, and `$set` carries only the allowlisted keys the caller supplied — an
 * unknown key cannot ride along into the document.
 */
export async function updatePersonByWorkosId(
  workosUserId: string,
  patch: PersonPatch
): Promise<boolean> {
  const set: Record<string, unknown> = {}
  if (patch.givenName !== undefined) set.givenName = patch.givenName
  if (patch.familyName !== undefined) set.familyName = patch.familyName
  if (patch.name !== undefined) set.name = patch.name
  if (patch.preferredUsername !== undefined) set.preferredUsername = patch.preferredUsername
  if (patch.interests !== undefined) set.interests = patch.interests
  if (Object.keys(set).length === 0) return true

  set.updatedAt = new Date()

  try {
    const db = await getIdentityDb()
    const result = await db
      .collection('persons')
      .updateOne({ workosUserId, isActive: { $ne: false } }, { $set: set })
    // No upsert: the person record is created by the gateway's WorkOS webhook.
    // Creating one here would race that upsert and could mint a second record
    // for the same human with a different _id.
    return result.matchedCount > 0
  } catch (error) {
    console.error('[identity] updatePersonByWorkosId failed:', error)
    return false
  }
}
