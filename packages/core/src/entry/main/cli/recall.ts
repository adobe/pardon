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
import { valueOps } from "../../../db/entities/value-entity.js";
import { httpOps } from "../../../db/entities/http-entity.js";
import { PardonContext } from "../../../core/app-context.js";
import { PardonError } from "../../../core/error.js";

export function recall(
  { database }: PardonContext,
  lookup: string[],
  values: Record<string, string>,
  locale?: Intl.Locale,
) {
  if (!database) {
    throw new PardonError("database not available");
  }

  const interesting = new Set(lookup);
  const iask = interesting.delete("ask");
  const ireq = interesting.delete("req");
  const ires = interesting.delete("res");
  Object.keys(values).forEach((key) => interesting.delete(key));

  const uninteresting = interesting.size == 0;
  if (uninteresting) {
    // query requires at least one field
    interesting.add("method");
  }

  const { getRelatedValues } = valueOps(database!);
  const { getHttpEntity } = httpOps(database!);

  const related = getRelatedValues([...interesting], values);

  for (const [http, scope] of Object.entries(related)) {
    const { req, res, ask, created_at } = getHttpEntity({ http });

    console.info(
      `# (${new Intl.DateTimeFormat(locale, {
        dateStyle: "short",
        timeStyle: "long",
      }).format(
        created_at ? new Date(`${created_at}Z`) : new Date(0),
      )}) ${req?.split("\n")?.[0]}`,
    );

    if (!uninteresting) {
      Object.values(scope).map((values, i, list) => {
        for (const kv of Object.entries(values)) {
          console.info(`${kv.join("=")}`);
        }
        if (i < list.length) {
          console.info("---");
        }
      });
    }

    if (iask) {
      console.info(`???\n${ask}`);
    }
    if (ireq) {
      console.info(`>>>\n${req}`);
    }
    if (ires) {
      console.info(`<<<\n${res}`);
    }
  }
}
