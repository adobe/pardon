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
import { PardonDatabase, Id, cachedOps } from "../sqlite.js";
import { JSON } from "../../core/raw-json.js";
import { valueOps } from "./value-entity.js";

//
// TODO: seperate database and/or encryption at rest.
//

type SecretContextEntity = {
  id: Id;
  created_at: string;
};

type SecretValueEntity = {
  context: Id;
  secret: string;
  value: string;
  typeof: string;
};

type SecretCriteriaEntity = {
  context: Id;
  name: string;
  value: string;
};

export const secretOps = cachedOps(secretOps_);

function secretOps_(db: PardonDatabase) {
  const { sqlite } = db;

  valueOps(db);

  sqlite.exec(`
CREATE TABLE IF NOT EXISTS "secret-contexts"
(
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);

  sqlite.exec(`
CREATE TABLE IF NOT EXISTS "secrets"
(
    "context" INTEGER,
    "secret" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "typeof" TEXT DEFAULT ('raw'),
    PRIMARY KEY ("context", "secret"),
    FOREIGN KEY ("context") REFERENCES "secret-contexts" ("id")
) WITHOUT ROWID;
`);

  sqlite.exec(`
CREATE TABLE IF NOT EXISTS "secret-criteria"
(
    "context" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    PRIMARY KEY ("name", "context"),
    FOREIGN KEY ("context") REFERENCES "secret-contexts" ("id")
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS "secret-criteria-by-name-and-value" on "secret-criteria" ("context", "name", "value");
-- CREATE INDEX IF NOT EXISTS "secret-criteria-by-name" on "secret-criteria" ("context", "name");
`);

  const createContext = sqlite
    .prepare<Omit<SecretContextEntity, "id" | "created_at">>(
      `
INSERT INTO "secret-contexts"
DEFAULT VALUES
RETURNING "id"
`,
    )
    .pluck();

  const insertSecretCriteria = sqlite.prepare<SecretCriteriaEntity>(`
INSERT INTO "secret-criteria" ("context", "name", "value")
VALUES (:context, :name, :value)
`);

  const insertSecretValue = sqlite.prepare<SecretValueEntity>(`
INSERT INTO "secrets" ("context", "secret", "value")
VALUES (:context, :secret, :value)
`);

  return {
    memorizeSecret,
    rememberSecrets,
  };

  function serialize(value: unknown) {
    const jsTypeof = typeof value;
    switch (jsTypeof) {
      case "number":
      case "boolean":
        return { typeof: jsTypeof, value: JSON.stringify(value) };
      case "bigint":
        return { typeof: jsTypeof, value: String(value) };
      case "string":
        return { typeof: jsTypeof, value: value as string };
      case "undefined":
        return { typeof: jsTypeof, value: "" };
      case "object":
        if (value === null) {
          return { typeof: "null", value: JSON.stringify(value) };
        }

        return {
          typeof: Array.isArray(value) ? "array" : "object",
          value: JSON.stringify(value),
        };
      default:
        return { typeof: jsTypeof, value: String(value) };
    }
  }

  function deserialize({
    value,
    typeof: type,
  }: {
    value: string;
    typeof: string;
  }) {
    switch (type) {
      case "raw":
      case "string":
        return value;
      case "bigint":
      case "number":
      case "boolean":
      case "object":
      case "array":
      case "null":
        try {
          return JSON.parse(value);
        } catch (error) {
          void error;
          return value;
        }
      default:
        return value;
    }
  }

  function memorizeSecret(
    criteria: Record<string, string | number | boolean>,
    secrets: Record<string, unknown>,
  ) {
    return sqlite.transaction(() => {
      const id = createContext.get({}) as Id;

      for (const [name, value] of Object.entries(criteria)) {
        insertSecretCriteria.run({
          context: id,
          name,
          value: String(value),
        });
      }

      for (const [secret, value] of Object.entries(secrets)) {
        insertSecretValue.run({ context: id, secret, ...serialize(value) });
      }
    })();
  }

  function rememberSecrets(
    context: Record<string, string>,
  ): <T extends any[]>(...names: T) => unknown | Record<T[number], unknown> {
    const contextvalues = [...Object.entries(context)];

    return <T extends any[]>(...names: T) => {
      const statement = sqlite.prepare<string[]>(`
      WITH
        "context"("name", "value") AS (
          ${
            contextvalues.length > 0
              ? `VALUES
            ${contextvalues.map(() => "(?, ?)").join(`,
            `)}`
              : `SELECT 1,2 WHERE 1=0`
          }
        ),
        "secret-names"("secret") AS (
            ${
              names?.length
                ? `VALUES ${names.map(() => "(?)").join(`,
            `)}`
                : `SELECT 1 WHERE 1=0`
            }
        )

      SELECT *
      FROM "secrets" INNER JOIN "secret-names" USING ("secret")
      WHERE NOT EXISTS (
        SELECT * FROM "secret-criteria" LEFT JOIN "context" USING ("name")
        WHERE "secrets"."context" = "secret-criteria"."context"
          AND "secret-criteria"."value" <> "context"."value"
      )
      GROUP BY "secret"
      HAVING "context" = MAX("context")`);

      const query = statement.all(
        ...contextvalues.flat(1),
        ...(names ?? []),
      ) as {
        http: Id;
        secret: string;
        value: string;
        typeof: string;
      }[];

      if (names.length == 1) {
        return query.length ? deserialize(query[0]) : undefined;
      }

      const result = {};
      for (const { secret, ...info } of query) {
        result[secret] = deserialize(info);
      }

      return result as Record<T[number], any>;
    };
  }
}
