import { MongoClient, type MongoClientOptions } from 'mongodb'

const dbName = process.env.MONGODB_DATABASE || 'news'

// Fail fast when Atlas is unreachable instead of hanging Server-Action reads
// for the driver-default 30s. 8s absorbs Atlas failover jitter without
// blocking every page render behind a dead cluster.
export const MONGO_CLIENT_OPTIONS: MongoClientOptions = {
  serverSelectionTimeoutMS: 8000,
  connectTimeoutMS: 8000,
  socketTimeoutMS: 20000,
}

// Lazily initialised so next build can collect page data without a live DB.
let clientPromise: Promise<MongoClient> | null = null

function getClientPromise(): Promise<MongoClient> {
  if (clientPromise) return clientPromise

  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI environment variable is not set')

  if (process.env.NODE_ENV === 'development') {
    const g = global as typeof globalThis & { _mongoClientPromise?: Promise<MongoClient> }
    if (!g._mongoClientPromise) {
      g._mongoClientPromise = new MongoClient(uri, MONGO_CLIENT_OPTIONS).connect()
    }
    clientPromise = g._mongoClientPromise
  } else {
    clientPromise = new MongoClient(uri, MONGO_CLIENT_OPTIONS).connect()
  }

  return clientPromise
}

export async function getDb() {
  const client = await getClientPromise()
  return client.db(dbName)
}

/**
 * A database other than `news`, for the rare cross-domain READ.
 *
 * The platform is one cluster of ~29 domain-separated databases, each the SSOT
 * for its own domain, and this app owns none of them but `news`. So this is
 * deliberately a narrow, named union rather than an arbitrary string: reading
 * another domain is legitimate (that is what "resolve it from the owning
 * domain" means), inventing a database name is not.
 *
 * `places` owns geography — the country list every filter in this app is built
 * on. `entity` and `identity` are already read through their own modules; they
 * are named here so those can converge on one accessor rather than each opening
 * its own.
 *
 * READ ONLY by convention: this app writes to `news` and to its own profile
 * record, never to another domain's collections.
 */
export type DomainDbName = 'places' | 'entity' | 'identity' | 'platform'

export async function getDomainDb(name: DomainDbName) {
  const client = await getClientPromise()
  return client.db(name)
}

export default { getDb, getDomainDb }
