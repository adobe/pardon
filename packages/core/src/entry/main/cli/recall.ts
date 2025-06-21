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
import { PardonError } from "../../../core/error.js";
import { PardonRuntime } from "../../../core/pardon/types.js";
import { FILE } from "../../../runtime/file.js";
import { HTTP, HTTPS, ResponseObject } from "../../../modules/formats.js";
import {
  HttpsScheme,
  isHttpResponseStep,
  isHttpScriptStep,
} from "../../../core/formats/https-fmt.js";
import { httpsResponseSchema } from "../../../core/request/https-template.js";
import { mergeSchema } from "../../../core/schema/core/schema-utils.js";
import { evaluation } from "../../../core/evaluation/expression.js";

export async function recall(
  { database }: PardonRuntime<"loading">,
  lookup: string[],
  values: Record<string, string>,
  { locale, args }: { locale?: Intl.Locale; args?: string[] } = {},
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

  const [filter] = args?.filter((name) => name.endsWith(".filter.https")) ?? [];

  const filterexecution = filter
    ? HTTPS.parse(await FILE.text(filter), "filter" as "merge")
    : undefined;

  for (const [http, scope] of Object.entries(related)) {
    const { req, res, ask, created_at } = getHttpEntity({ http });

    if (!(await acceptResult({ req, res }, values, filterexecution))) {
      continue;
    }

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

/**
 * this is a quick implementation, need to move this to the UI
 * (and probably refactor the pattern in general.)
 */
async function acceptResult(
  { res }: { req?: string; res?: string },
  { ...values }: Record<string, any>,
  filterexecution?: HttpsScheme<"source">,
) {
  if (!filterexecution) {
    return true;
  }

  if (!res && filterexecution.steps.some(isHttpResponseStep)) {
    return false;
  }

  const steps = filterexecution.steps.slice();

  while (steps.length) {
    const step = steps.shift()!;
    if (isHttpResponseStep(step)) {
      const responseObject: ResponseObject = {
        status: step.status,
        headers: new Headers(step.headers),
        meta: step.meta,
        body: step.body,
      };
      const { schema } = mergeSchema(
        { mode: "merge", phase: "build" },
        httpsResponseSchema(),
        responseObject,
      );

      const merged =
        schema &&
        mergeSchema(
          { mode: "match", phase: "validate" },
          schema!,
          HTTP.responseObject.parse(res!),
        );

      if (!merged?.schema) {
        while (steps.length && !isHttpResponseStep(step)) {
          steps.shift();
        }
        if (!steps.length) {
          return false;
        }
        continue;
      }
      Object.assign(
        values,
        merged.context!.evaluationScope.resolvedValues({ secrets: true }),
      );
    } else if (isHttpScriptStep(step)) {
      let filtered = true;
      await evaluation(`(async () => { ${step.script} ;;; })()`, {
        binding(key) {
          return (
            values[key] ??
            {
              get $filter() {
                return (condition: any) => (filtered &&= condition);
              },
              FILE,
            }[key] ??
            globalThis[key]
          );
        },
      });

      if (!filtered) {
        return false;
      }
    }
  }

  return true;
}
