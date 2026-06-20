/**
 * MongoService — native MongoDB Atlas connection for the gateway Worker.
 *
 * Cloudflare Workers (with nodejs_compat) run the native `mongodb` driver.
 * The MongoClient is cached at module scope so it is reused across requests
 * within the same isolate instead of reconnecting on every invocation.
 */
import { MongoClient, type Db } from "mongodb";

let clientPromise: Promise<MongoClient> | null = null;

export function getMongoDb(uri: string, dbName = "news"): Promise<Db> {
  if (!clientPromise) {
    clientPromise = new MongoClient(uri).connect();
  }
  return clientPromise.then((client) => client.db(dbName));
}
