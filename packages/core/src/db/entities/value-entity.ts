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
import { arrayIntoObject } from "../../util/mapping.js";
import { httpOps } from "./http-entity.js";
import { JSON } from "../../core/json.js";

type InternalValueEntity = {
  http: Id;
  // request, response (TODO: how to use)
  type: string;
  // groups related values, hierarchically
  scope: string;
  name: string;
  value: string;
  typeof: string;
};

export type ValueEntity = Omit<InternalValueEntity, "value" | "typeof"> & {
  value: unknown;
};

export type ValueEntityInsert = Omit<ValueEntity, "scope"> & {
  scope?: string;
};

export const valueOps = cachedOps(valueOps_);

function valueOps_(db: PardonDatabase) {
  httpOps(db);

  const { sqlite } = db;

  sqlite.exec(`
CREATE TABLE IF NOT EXISTS "value"
(
    "http" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT (''),
    "value" TEXT NOT NULL,
    "typeof" TEXT DEFAULT ('raw'),
    PRIMARY KEY ("http", "name", "type", "scope"),
    FOREIGN KEY ("http") REFERENCES "http" ("id")
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS "value-by-name" on "value" ("name");
CREATE INDEX IF NOT EXISTS "value-by-name-and-value" on "value" ("name", "value");
`);

  if (
    !(sqlite.pragma('table_info("value")') as any[])?.find(
      ({ name }) => name === "typeof",
    )
  ) {
    console.warn("--- (once) migrate value-table ---");
    sqlite.exec(`
ALTER TABLE "value"
ADD COLUMN "typeof" TEXT DEFAULT ('raw');
`);
  }

  const insert = sqlite.prepare<InternalValueEntity>(`
INSERT INTO "value" ("http", "type", "scope", "name", "value", "typeof")
VALUES (:http, :type, :scope, :name, :value, :typeof)
`);

  const byHttp = sqlite.prepare<{ http: Id | string }, InternalValueEntity>(`
SELECT * FROM "value"
WHERE "http" = :http
`);

  const byHttpAndNameScoped = sqlite.prepare<
    Pick<InternalValueEntity, "http" | "name" | "scope">,
    Pick<InternalValueEntity, "value" | "typeof" | "scope">
  >(
    `
SELECT "value", "typeof", "scope" FROM "value"
WHERE "http" = :http
  AND "name" = :name
  AND INSTR(:scope || ':', "scope" || ':') = 1
`,
  );

  return {
    insertValue,
    getValuesByHttp,
    getRelatedValues,
  };

  function serialize(value: unknown) {
    const jsTypeof = typeof value;
    switch (jsTypeof) {
      case "number":
      case "boolean":
        return { typeof: jsTypeof, value: JSON.stringify(value) };
      case "bigint":
        return { typeof: jsTypeof, value: JSON.rawJSON(String(value)) };
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

  function insertValue({ value, ...entity }: ValueEntityInsert) {
    return insert.run({
      ...serialize(value),
      ...entity,
      scope: `${entity.scope || ""}`,
    });
  }

  function getValuesByHttp({ http }: { http: string | Id }) {
    return byHttp.all({ http }).map(({ value, typeof: type, ...entity }) => ({
      ...entity,
      value: deserialize({ value, typeof: type }),
    })) as ValueEntity[];
  }

  function getRelatedValues(
    lookup: string[] | undefined,
    values: Record<string, string>,
  ): { [http: string]: { [scope: string]: Record<string, unknown> } } {
    const queryvalues = [...Object.entries(values)];

    const statement = sqlite.prepare<string[]>(`
WITH
  "criteria"("name", "value") AS (
    ${
      queryvalues.length > 0
        ? `VALUES
      ${queryvalues.map(() => "(?, ?)").join(`,
      `)}`
        : `SELECT 1,2 WHERE 1=0`
    }
  ),
  "lookup"("name") AS (
      ${
        lookup?.length
          ? `VALUES ${lookup.map(() => "(?)").join(`,
      `)}`
          : `SELECT 1 WHERE 1=0`
      }
  ),
  "search"("http", "name", "scope", "value") AS (
    SELECT "http", "name", "scope", "value"
    FROM "criteria"
    JOIN "value" USING ("name", "value")
    UNION ALL
    SELECT "http", "name", "scope", NULL
    FROM "lookup" JOIN "value" USING ("name")
  ),
  "scopes"("http", "scope") AS (
    SELECT DISTINCT "http", "scope"
    FROM "search"
    WHERE NOT EXISTS (
      SELECT "scope"
      FROM "search" AS "deeper"
      WHERE "deeper"."http" = "search"."http"
        AND INSTR("deeper"."scope", "search"."scope" || ':') = 1
    )
  ),
  "expanded"("http", "name", "scope", "value") AS (
    SELECT "http", "name", "scopes"."scope", "value"
    FROM "search" JOIN "scopes" USING ("http")
    WHERE INSTR("scopes"."scope" || ':', "search"."scope" || ':') = 1
  ),
  "matches"("http", "scope") AS (
    SELECT "http", "scope"
    FROM "scopes"
    WHERE (SELECT COUNT(*) FROM "criteria") = (
      SELECT COUNT(DISTINCT "name")
      FROM "criteria"
      JOIN "expanded" USING ("name", "value")
      WHERE "expanded"."http" = "scopes"."http"
        AND "expanded"."scope" = "scopes"."scope"
    ) AND (SELECT COUNT(*) FROM "lookup") = (
      SELECT COUNT(DISTINCT "name") 
      FROM "lookup"
      JOIN "expanded" USING ("name")
      WHERE "expanded"."http" = "scopes"."http"
        AND "expanded"."scope" = "scopes"."scope"
    )
  )
SELECT * FROM "matches"
`);

    const query = statement.all(...queryvalues.flat(1), ...(lookup ?? [])) as {
      http: Id;
      scope: string;
    }[];

    const result = {};
    for (const { http, scope } of query) {
      (result[String(http)] ??= {})[scope] = arrayIntoObject(
        lookup ?? [],
        (name) => {
          const entry = byHttpAndNameScoped.get({ http, scope, name });
          const value = entry && deserialize(entry);
          return (
            value !== undefined && {
              [name]: value,
            }
          );
        },
      );
    }

    return result;
  }
}
