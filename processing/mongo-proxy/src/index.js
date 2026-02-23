/**
 * Mukoko News — MongoDB Proxy Worker
 *
 * Provides MongoDB access to the Python Worker via Service Binding.
 * Uses the official MongoDB Node.js driver with TCP socket support.
 *
 * SECURITY: Public access is disabled (workers_dev = false in wrangler.toml).
 * Only accessible via Service Binding from the Python Worker (env.MONGO.fetch).
 * A shared secret (PROXY_SECRET) provides defense-in-depth authentication.
 *
 * Request body: { action, collection, ...params }
 *
 * Supported actions:
 *   find, findOne, count, aggregate,
 *   insertOne, insertMany, updateOne, updateMany,
 *   deleteOne, deleteMany
 */

import { MongoClient } from "mongodb";

/** @type {MongoClient | null} */
let client = null;

/** Allowed collections — reject requests to any other collection. */
const ALLOWED_COLLECTIONS = new Set([
  "articles",
  "sources",
  "source_health",
  "health_records",
  "trending",
  "keywords",
  "clusters",
  "search_cache",
  "processing_log",
  "feed_state",
]);

/** Dangerous MongoDB operators that must not appear in filters. */
const BLOCKED_FILTER_OPS = ["$where", "$function", "$accumulator", "$expr"];

/** Aggregation stages that could write data or leak system info. */
const BLOCKED_AGG_STAGES = new Set([
  "$out",
  "$merge",
  "$collStats",
  "$currentOp",
  "$listSessions",
  "$planCacheStats",
]);

/**
 * Get or create a MongoDB client.
 * Connection pooling is handled by the driver; we use maxPoolSize=1
 * because Workers have short-lived request contexts.
 */
function getClient(env) {
  if (!client) {
    client = new MongoClient(env.MONGODB_URI, {
      maxPoolSize: 1,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 10000,
    });
  }
  return client;
}

/** Get the database, defaulting to mukoko_news. */
function getDb(env) {
  return getClient(env).db(env.MONGODB_DATABASE || "mukoko_news");
}

/**
 * Check if a JSON object contains any blocked operators (recursive).
 * Returns the first blocked key found, or null.
 */
function findBlockedOperator(obj) {
  if (!obj || typeof obj !== "object") return null;
  for (const key of Object.keys(obj)) {
    if (BLOCKED_FILTER_OPS.includes(key)) return key;
    const nested = findBlockedOperator(obj[key]);
    if (nested) return nested;
  }
  return null;
}

export default {
  async fetch(request, env) {
    // ── Auth: require shared secret (mandatory, defense-in-depth) ──
    if (!env.PROXY_SECRET) {
      return Response.json({ error: "Server misconfigured" }, { status: 500 });
    }
    const authHeader = request.headers.get("Authorization");
    if (authHeader !== `Bearer ${env.PROXY_SECRET}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only accept POST with JSON body
    if (request.method !== "POST") {
      return Response.json({ error: "POST required" }, { status: 405 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { action, collection, ...params } = body;

    if (!action || !collection) {
      return Response.json(
        { error: "action and collection required" },
        { status: 400 }
      );
    }

    // ── Validate collection name ──
    if (!ALLOWED_COLLECTIONS.has(collection)) {
      console.warn(
        `[MONGO-PROXY] Rejected access to disallowed collection: ${collection}`
      );
      return Response.json(
        { error: "Collection not allowed" },
        { status: 403 }
      );
    }

    // ── Validate filter for dangerous operators ──
    if (params.filter) {
      const blocked = findBlockedOperator(params.filter);
      if (blocked) {
        console.warn(
          `[MONGO-PROXY] Rejected dangerous operator ${blocked} in ${action} on ${collection}`
        );
        return Response.json(
          { error: "Query operator not allowed" },
          { status: 403 }
        );
      }
    }

    try {
      const db = getDb(env);
      const coll = db.collection(collection);
      let result;

      switch (action) {
        // ── Read ──
        case "find": {
          const cursor = coll.find(params.filter || {});
          if (params.projection) cursor.project(params.projection);
          if (params.sort) cursor.sort(params.sort);
          if (params.skip) cursor.skip(params.skip);
          // Clamp limit to prevent abuse
          const limit = Math.min(Math.max(params.limit ?? 20, 1), 1000);
          cursor.limit(limit);
          const documents = await cursor.toArray();
          result = { documents };
          break;
        }

        case "findOne": {
          const doc = await coll.findOne(
            params.filter || {},
            params.projection ? { projection: params.projection } : {}
          );
          result = { document: doc };
          break;
        }

        case "count": {
          const total = await coll.countDocuments(params.filter || {});
          result = { total };
          break;
        }

        case "aggregate": {
          const pipeline = params.pipeline || [];
          // Validate pipeline stages
          for (const stage of pipeline) {
            const stageKey = Object.keys(stage)[0];
            if (BLOCKED_AGG_STAGES.has(stageKey)) {
              console.warn(
                `[MONGO-PROXY] Rejected blocked aggregation stage: ${stageKey}`
              );
              return Response.json(
                { error: "Aggregation stage not allowed" },
                { status: 403 }
              );
            }
          }
          const docs = await coll.aggregate(pipeline).toArray();
          result = { documents: docs };
          break;
        }

        // ── Write ──
        case "insertOne": {
          const ins = await coll.insertOne(params.document);
          result = { insertedId: ins.insertedId };
          break;
        }

        case "insertMany": {
          const docs = params.documents || [];
          if (docs.length > 500) {
            return Response.json(
              { error: "Batch size exceeds limit (500)" },
              { status: 400 }
            );
          }
          const insMany = await coll.insertMany(docs);
          result = { insertedIds: Object.values(insMany.insertedIds) };
          break;
        }

        case "updateOne": {
          const blockedUpd = findBlockedOperator(params.update);
          if (blockedUpd) {
            console.warn(
              `[MONGO-PROXY] Rejected dangerous operator ${blockedUpd} in update on ${collection}`
            );
            return Response.json(
              { error: "Update operator not allowed" },
              { status: 403 }
            );
          }
          const upd = await coll.updateOne(
            params.filter || {},
            params.update || {},
            { upsert: params.upsert || false }
          );
          result = {
            matchedCount: upd.matchedCount,
            modifiedCount: upd.modifiedCount,
            upsertedId: upd.upsertedId,
          };
          break;
        }

        case "updateMany": {
          const blockedUpdMany = findBlockedOperator(params.update);
          if (blockedUpdMany) {
            console.warn(
              `[MONGO-PROXY] Rejected dangerous operator ${blockedUpdMany} in update on ${collection}`
            );
            return Response.json(
              { error: "Update operator not allowed" },
              { status: 403 }
            );
          }
          const updMany = await coll.updateMany(
            params.filter || {},
            params.update || {}
          );
          result = {
            matchedCount: updMany.matchedCount,
            modifiedCount: updMany.modifiedCount,
          };
          break;
        }

        case "deleteOne": {
          const del = await coll.deleteOne(params.filter || {});
          result = { deletedCount: del.deletedCount };
          break;
        }

        case "deleteMany": {
          const delMany = await coll.deleteMany(params.filter || {});
          result = { deletedCount: delMany.deletedCount };
          break;
        }

        default:
          return Response.json(
            { error: `Unknown action: ${action}` },
            { status: 400 }
          );
      }

      return Response.json(result);
    } catch (err) {
      console.error(`[MONGO-PROXY] ${action} on ${collection} failed:`, err);
      return Response.json(
        { error: "Database operation failed" },
        { status: 500 }
      );
    }
  },
};
