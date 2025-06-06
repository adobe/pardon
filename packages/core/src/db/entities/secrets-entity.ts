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

type SecretEntity = {
  http: Id;
  secret: string;
  value: string;
  typeof: string;
};

type SecretCriteriaEntity = {
  http: Id;
  secret: string;
  name: string;
};

export const secretOps = cachedOps(secretOps_);

function secretOps_(db: PardonDatabase) {
  const { sqlite } = db;

  valueOps(db);

  sqlite.exec(`
CREATE TABLE IF NOT EXISTS "secrets"
(
    "http" INTEGER NOT NULL,
    "secret" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "typeof" TEXT DEFAULT ('raw'),
    PRIMARY KEY ("http", "secret"),
    FOREIGN KEY ("http") REFERENCES "http" ("id")
) WITHOUT ROWID;
`);

  sqlite.exec(`
CREATE TABLE IF NOT EXISTS "secrets-criteria"
(
    "http" INTEGER NOT NULL,
    "secret" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    PRIMARY KEY ("http", "name", "secret"),
    FOREIGN KEY ("http", "secret") REFERENCES "secrets" ("http", "secret")
) WITHOUT ROWID;
`);

  const insertSecret = sqlite.prepare<SecretEntity>(`
INSERT INTO "secrets" ("http", "secret", "value", "typeof")
VALUES (:http, :secret, :value, :typeof)
`);

  const insertSecretCriteria = sqlite.prepare<SecretCriteriaEntity>(`
INSERT INTO "secrets-criteria" ("http", "secret", "name")
VALUES (:http, :secret, :name)
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

  function memorizeSecret(http: Id) {
    return (secrets: Record<string, unknown>, ...criteria: string[]) => {
      return sqlite.transaction(() => {
        for (const [secret, value] of Object.entries(secrets)) {
          insertSecret.run({ http, secret, ...serialize(value) });
          for (const name of criteria) {
            insertSecretCriteria.run({ http, secret, name });
          }
        }
      })();
    };
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
        ),
        "relevant-value"("http", "name", "value") AS (
          SELECT "http", "name", "value"
          FROM "value" INNER JOIN "context" USING ("name", "value")
          WHERE "scope" = ''
        ),
        "matched"("http", "secret", "value", "typeof") AS (
          SELECT "http", "secret", "value", "typeof"
          FROM "secrets" AS "s" INNER JOIN "secret-names" USING ("secret")
          WHERE (
            SELECT COUNT(*) FROM "secrets-criteria" JOIN "relevant-value" USING ("http", "name")
            WHERE "s"."http" = "secrets-criteria"."http"
          ) = (
            SELECT COUNT(*) FROM "secrets-criteria" JOIN "secrets" USING ("http", "secret")
            WHERE "s"."http" = "secrets-criteria"."http"
          )
        )
      SELECT "secret", "value", "typeof" FROM "matched" JOIN "http" ON "matched"."http" = "http"."id"
        GROUP BY "secret" HAVING "http" = MAX("http")
      `);

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
        return deserialize(query[0]);
      }

      const result = {};
      for (const { secret, ...info } of query) {
        result[secret] = deserialize(info);
      }

      return result as Record<T[number], any>;
    };
  }
}
