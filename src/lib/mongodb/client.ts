import { MongoClient } from 'mongodb'

const uri = process.env.MONGODB_URI
const dbName = process.env.MONGODB_DATABASE || 'news'

if (!uri) {
  throw new Error('MONGODB_URI environment variable is not set')
}

let clientPromise: Promise<MongoClient>

if (process.env.NODE_ENV === 'development') {
  const g = global as typeof globalThis & { _mongoClientPromise?: Promise<MongoClient> }
  if (!g._mongoClientPromise) {
    g._mongoClientPromise = new MongoClient(uri).connect()
  }
  clientPromise = g._mongoClientPromise
} else {
  clientPromise = new MongoClient(uri).connect()
}

export async function getDb() {
  const client = await clientPromise
  return client.db(dbName)
}

export default clientPromise
