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
import { PardonDatabase, Id, Datetime, cachedOps } from "../sqlite.js";

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

export const httpOps = cachedOps(httpOps_);

export function httpOps_({ sqlite }: PardonDatabase) {
  sqlite.exec(`
CREATE TABLE IF NOT EXISTS "http"
(
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "ask" TEXT NOT NULL,
    "req" TEXT NOT NULL,
    "res" TEXT,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);

  const insertHttpStmt = sqlite
    .prepare<Pick<HttpEntity, "req" | "ask">>(
      `
INSERT INTO "http" ("req", "ask")
VALUES (:req, :ask)
RETURNING "id"
`,
    )
    .pluck();

  const getHttpStmt = sqlite.prepare<{ http: Id | string }, HttpEntity>(`
SELECT * FROM "http"
WHERE "id" = :http
`);

  const updateWithResponseStmt = sqlite.prepare<{
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
