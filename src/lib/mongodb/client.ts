import { MongoClient } from 'mongodb'

const dbName = process.env.MONGODB_DATABASE || 'news'

// Lazily initialised so next build can collect page data without a live DB.
let clientPromise: Promise<MongoClient> | null = null

function getClientPromise(): Promise<MongoClient> {
  if (clientPromise) return clientPromise

  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI environment variable is not set')

  if (process.env.NODE_ENV === 'development') {
    const g = global as typeof globalThis & { _mongoClientPromise?: Promise<MongoClient> }
    if (!g._mongoClientPromise) {
      g._mongoClientPromise = new MongoClient(uri).connect()
    }
    clientPromise = g._mongoClientPromise
  } else {
    clientPromise = new MongoClient(uri).connect()
  }

  return clientPromise
}

export async function getDb() {
  const client = await getClientPromise()
  return client.db(dbName)
}

export default { getDb }
