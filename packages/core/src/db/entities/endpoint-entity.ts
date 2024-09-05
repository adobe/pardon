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
import * as YAML from "yaml";
import { Endpoint, LayeredEndpoint } from "../../config/collection-types.js";
import { Database, Id, Datetime } from "../sqlite.js";

export type HttpsEntity = {
  id: Id;
  created_at: Datetime;
  scheme: string;
};

export type HttpEntityInsert = Pick<HttpsEntity, "scheme">;

export function endpointOps(db: Database) {
  db.exec(`
CREATE TABLE IF NOT EXISTS "endpoint"
(
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "endpoint" TEXT NOT NULL,
    "https" TEXT NOT NULL,
    UNIQUE ("endpoint", "https")
);
`);

  const insertEndpointStmt = db
    .prepare<{ endpoint: string; https: string }>(
      `
INSERT INTO "endpoint" ("endpoint", "https")
VALUES (:endpoint, :https)
RETURNING "id"
    `,
    )
    .pluck();

  const checkEndpointStmt = db
    .prepare<{ endpoint: string; https: string }>(
      `
SELECT "id" FROM "endpoint"
WHERE "endpoint" = :endpoint
  AND "https" = :https
    `,
    )
    .pluck();

  return {
    insertEndpoint,
  };

  function insertEndpoint({
    configuration,
    layers: [{ steps }], // FIXME: layers
  }: LayeredEndpoint): Id {
    const { name: endpoint } = configuration;
    const https = formatHttpsScheme({ configuration, steps });

    return (
      (checkEndpointStmt.get({ endpoint, https }) as Id | false) ||
      (insertEndpointStmt.get({
        endpoint,
        https,
      }) as unknown as Id)
    );
  }

  function formatHttpsScheme({
    configuration,
    steps,
  }: Pick<Endpoint, "configuration" | "steps">) {
    return `
${YAML.stringify(configuration)}
${steps.map(({ source }) => source).join("\n")}
`.trim();
  }
}
