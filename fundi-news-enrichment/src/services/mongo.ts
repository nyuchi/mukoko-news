import { MongoClient, type Db } from 'mongodb';

let clientPromise: Promise<MongoClient> | null = null;

export function getDb(uri: string, dbName = 'news'): Promise<Db> {
  if (!clientPromise) {
    clientPromise = new MongoClient(uri).connect();
  }
  return clientPromise.then(c => c.db(dbName));
}

export function getEntityDb(uri: string): Promise<Db> {
  return getDb(uri, 'entity');
}
