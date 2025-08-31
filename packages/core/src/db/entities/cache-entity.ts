/*
Copyright 2025 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/
import { PardonError } from "../../core/error.js";
import { JSON } from "../../core/raw-json.js";
import { disconnected, shared } from "../../core/tracking.js";
import { type PardonDatabase, type Datetime, cachedOps } from "../sqlite.js";

export type CacheEntity = {
  key: string;
  value: string;
  created_at: Datetime;
  expires_at: Datetime;
};

export type CacheEntry<T> = {
  value: T; // encoded/decoded with JSON.stringify()
  expires_at?: number; // epoch/milliseconds
  expires_in?: number; // milliseconds
  nocache?: boolean;
};

const inflightCache: Record<string, Promise<CacheEntry<unknown>> | undefined> =
  {};

export const initDb = cachedOps(initDb_);

function initDb_({ sqlite }: PardonDatabase) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "cache"
    (
      "key" TEXT PRIMARY KEY NOT NULL,
      "value" TEXT NOT NULL,
      "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      "expires_at" DATETIME NOT NULL
    );`);

  const updateCacheStmt = sqlite.prepare<{
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

  const readCacheStmt = sqlite
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
    sqlite.exec(`
    DELETE FROM "cache"
    WHERE "expires_at" < CURRENT_TIME
    `);
  }

  function cleanCache() {
    sqlite.exec(`DELETE FROM "cache"`);
  }

  function readCache(key: string) {
    return readCacheStmt.get({ key });
  }

  function updateCache({
    key,
    value,
    expires_at,
  }: {
    key: string;
    value: string;
    expires_at: string;
  }) {
    return updateCacheStmt.run({ key, value, expires_at });
  }

  return { updateCache, readCache, cleanExpiredCache, cleanCache };
}

export function cacheOps(db?: PardonDatabase) {
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
  ): Promise<CacheEntry<T>> {
    let { value, expires_in, expires_at, nocache } = (await loader()) ?? {};

    if (value === undefined) {
      throw new PardonError(`failed to compute cached value for ${key}`);
    }

    expires_at ??= expires_in
      ? Date.now() + expires_in
      : Number.MAX_SAFE_INTEGER;

    const entry = {
      key,
      value,
      expires_at,
    };

    if (!nocache) {
      updateCache?.({
        ...entry,
        value: JSON.stringify(value),
        expires_at: new Date(expires_at).toISOString(),
      });
    }

    return entry;
  }

  async function cached<T>(
    key: string,
    loader: () => Promise<CacheEntry<T>>,
  ): Promise<T> {
    const now = Date.now();

    const inflight = inflightCache[key];

    if (inflight) {
      try {
        const entry = await disconnected(async () => {
          const entry = await inflight.catch(() => ({
            value: undefined,
            expires_at: Number.MIN_SAFE_INTEGER,
          }));

          if (!entry.expires_at || entry.expires_at > now) {
            return entry;
          }
        });

        if (entry) {
          await inflight;
          return entry.value as T;
        }
      } catch (error) {
        delete inflightCache[key];
        // continue
        void error;
      }
    }

    const entry = readCache?.(key) as string | undefined;

    if (entry) {
      return JSON.parse(entry);
    }

    const result = (inflightCache[key] = shared(() =>
      insertCache(key, loader),
    ));

    result.catch(() => {
      delete inflightCache[key];
    });

    return (await result).value;
  }
}
