/*
Copyright 2024 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/
import { PardonError } from "../../core/error.js";
import { shared } from "../../core/async.js";
import { Database, Datetime } from "../sqlite.js";

export type CacheEntity = {
  key: string;
  value: string;
  created_at: Datetime;
  expires_at: Datetime;
};

export type CacheEntry<T> = {
  value: T; // encoded/decoded with JSON.stringify()
  expires_in: number; // milliseconds
  nocache?: boolean;
};

const inflightCache: Record<string, Promise<unknown>> = {};

function initDb(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS "cache"
    (
      "key" TEXT PRIMARY KEY NOT NULL,
      "value" TEXT NOT NULL,
      "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      "expires_at" DATETIME NOT NULL
    );`);

  const updateCache = db.prepare<{
    key: string;
    value: unknown;
    expires_at: string;
  }>(`
    INSERT INTO CACHE ("key", "value", "expires_at")
    VALUES (:key, :value, :expires_at)
    ON CONFLICT DO UPDATE SET
      "value" = "excluded"."value",
      "expires_at" = "excluded"."expires_at"
  `);

  const readCache = db
    .prepare<{ key: string }>(
      `
    SELECT "value"
    FROM "cache"
    WHERE :key = "key"
    AND DATETIME("expires_at") > CURRENT_TIMESTAMP
    ORDER BY "created_at" DESC
    LIMIT 1
    `,
    )
    .pluck();

  function cleanExpiredCache() {
    db.exec(`
    DELETE FROM "cache"
    WHERE "expires_at" < CURRENT_TIME
    `);
  }

  function cleanCache() {
    db.exec(`DELETE FROM "cache"`);
  }

  return { updateCache, readCache, cleanExpiredCache, cleanCache };
}

export function cacheOps(db?: Database) {
  const memoryCache: Record<string, { value: unknown; expires_at: number }> =
    {};

  const { updateCache, readCache, cleanExpiredCache, cleanCache } = db
    ? initDb(db)
    : {
        updateCache: undefined,
        readCache: undefined,
        cleanCache: undefined,
        cleanExpiredCache: undefined,
      };

  return {
    cleanCache,
    cleanExpiredCache,
    cached,
  };

  async function insertCache<T>(
    key: string,
    loader: () => Promise<CacheEntry<T>>,
  ): Promise<T> {
    const { value, expires_in } = (await loader()) ?? {};

    if (value === undefined) {
      throw new PardonError(`failed to compute cached value for ${key}`);
    }

    const expires_at = expires_in
      ? Date.now() + expires_in
      : Number.MAX_SAFE_INTEGER;

    memoryCache[key] = {
      value,
      expires_at,
    };

    updateCache?.run({
      key,
      value: JSON.stringify(value),
      expires_at: new Date(expires_at).toISOString(),
    });

    return value;
  }

  async function cached<T>(
    key: string,
    loader: () => Promise<CacheEntry<T>>,
  ): Promise<T> {
    const inflight = inflightCache[key];
    if (inflight) {
      if (!memoryCache[key] || memoryCache[key].expires_at > Date.now()) {
        return inflight as Promise<T>;
      }

      delete inflightCache[key];
    }

    const entry = readCache?.get({ key }) as string;

    if (entry) {
      return JSON.parse(entry);
    }

    const result = (inflightCache[key] = shared(() =>
      insertCache(key, loader),
    ));

    result.catch(() => delete inflightCache[key]);

    return result;
  }
}
