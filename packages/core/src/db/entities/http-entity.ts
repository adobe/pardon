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
import { Database, Id, Datetime } from "../sqlite.js";
import "./endpoint-entity.js";

export type HttpEntity = {
  id: Id;
  ask: string;
  req: string;
  res?: string;
  created_at: Datetime;
};

export type HttpEntityEpoch = {
  id: Id;
  ask: string;
  req: string;
  res?: string;
  created_at: number;
};

export type HttpAwaited = {
  http: Id;
  awaited: Id;
};

export type HttpEntityInsert = Pick<HttpEntity, "req">;

export function httpOps(db: Database) {
  // transitional code to update the http table
  if (
    (db.pragma('table_info("http")') as any[])?.find(
      ({ name }) => name === "endpoint",
    )
  ) {
    console.warn("-- (once) migrating http table! --");
    db.exec(`
PRAGMA foreign_keys=off;
BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS "http-temp" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "ask" TEXT NOT NULL,
    "req" TEXT NOT NULL,
    "res" TEXT,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "http-temp" SELECT "id", "req" as "ask", "req", "res", "created_at" FROM "http";
DROP TABLE "http";
ALTER TABLE "http-temp" RENAME TO "http";

COMMIT;
PRAGMA foreign_keys=on;

DROP TABLE IF EXISTS "http_awaited";
`);
  }

  db.exec(`
CREATE TABLE IF NOT EXISTS "http"
(
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "ask" TEXT NOT NULL,
    "req" TEXT NOT NULL,
    "res" TEXT,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);

  const insertHttpStmt = db
    .prepare<Pick<HttpEntity, "req" | "ask">>(
      `
INSERT INTO "http" ("req", "ask")
VALUES (:req, :ask)
RETURNING "id"
`,
    )
    .pluck();

  const getHttpStmt = db.prepare<{ http: Id | string }, HttpEntity>(`
SELECT * FROM "http"
WHERE "id" = :http
`);

  const updateWithResponseStmt = db.prepare<{
    http: Id | string;
    res: string;
  }>(`
UPDATE "http"
SET "res" = :res
WHERE "id" = :http
`);

  return { insertHttp, updateWithResponse, getHttpEntity };

  function insertHttp({ req, ask }: Pick<HttpEntity, "req" | "ask">) {
    const http = insertHttpStmt.get({
      req,
      ask: ask ?? req,
    }) as Id;

    return http as Id;
  }

  function updateWithResponse({ http, res }: { http: Id; res: string }) {
    return updateWithResponseStmt.run({ http, res });
  }

  function getHttpEntity({ http }: { http: Id | string }) {
    return getHttpStmt.get({ http }) as HttpEntity;
  }
}
