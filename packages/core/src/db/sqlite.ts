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
import type { Database, Statement } from "better-sqlite3";
import { PardonAppContextOptions } from "../core/app-context.js";

export type Id = number | bigint;
export type Datetime = string;
export type PardonDatabase = {
  sqlite: Database;
  opsCache: Record<string, unknown>;
};

export type StatementOptions<S> =
  S extends Statement<infer P> ? (P extends unknown[] ? never : P) : never;

export type StatementBindArgs<S> =
  S extends Statement<infer P> ? (P extends unknown[] ? P : never) : never;

// TODO: get build to work with correct typing here.
export async function connectDb(
  path: string,
  options?: PardonAppContextOptions["sqlite3"],
): Promise<PardonDatabase | undefined> {
  try {
    return {
      sqlite: await tryConnectDb(path, options),
      opsCache: {},
    };
  } catch (error) {
    console.warn("error loading sqlite3", error);
  }
}

async function tryConnectDb(
  path: string,
  options?: PardonAppContextOptions["sqlite3"],
) {
  const { default: Sqlite3 } = await import("better-sqlite3");

  const database = new Sqlite3(path, {
    nativeBinding: options?.nativeBinding,
  });

  process.on("exit", () => database.close());

  database.pragma(`foreign_keys=ON`);

  // WAL is suggested by BetterSqlite
  // unclear if this matters for this use-case.

  // database.pragma("journal_mode=WAL");

  // these might be good to set with WAL, ... really don't know.
  // database.pragma("journal_size_limit=0");
  // database.pragma("synchronous=NORMAL");
  // database.pragma("cache_size=100000")

  return database;
}

export function cachedOps<T>(
  opsFn: (db: PardonDatabase) => T,
): (db: PardonDatabase) => T {
  return (db) => (db.opsCache[opsFn.name] ??= opsFn(db)) as T;
}
