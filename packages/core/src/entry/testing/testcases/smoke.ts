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
import {
  Alternation,
  CaseContext,
  CaseValues,
  Generation,
  desequenced,
  exalternates,
  fi,
  local,
  shuffle,
  sort,
} from "./core.js";
import { counter } from "./counter.js";

export function smoke(
  ...keys: [number | Record<string, number>, ...string[]] | string[]
) {
  const seen: Record<string, Record<string, Record<string, number>>> = {};

  const key0 = keys[0];
  const max = (key: string) =>
    typeof key0 === "number"
      ? key0
      : typeof key0 === "object"
        ? (key0[key] ?? 1)
        : 1;

  if (typeof keys[0] !== "string") {
    if (typeof keys[0] === "object") {
      keys = Object.keys(keys[0]);
    } else {
      keys = keys.slice(1) as string[];
    }
  }

  keys = keys.filter(Boolean) as string[];

  function makeSmokeFilter(...cats: (string | Alternation)[]) {
    return fi(
      (
        env: CaseValues,
        defs: Record<string | symbol, Alternation | Generation>,
      ) => {
        const context: CaseContext = { environment: env, defs };
        const category = [
          ...cats.map((cat) =>
            typeof cat === "string" ? env[cat] : smalt(context, cat),
          ),
        ]
          .filter(Boolean)
          .join(":");

        const view = Object.keys(env).filter((key) => keys.includes(key));

        const scategory = (seen[category] ??= {});
        if (
          keys.length === 0
            ? ((scategory["count"] ??= {})["count"] ??= 0) < max("default")
            : view.some(
                (key) => ((scategory[key] ??= {})[env[key]] ??= 0) < max(key),
              )
        ) {
          if (keys.length === 0) {
            (scategory["count"] ??= {})["count"]++;
          } else {
            for (const key of view) {
              (scategory[key] ??= {})[env[key]]++;
            }
          }

          return true;
        }
      },
    );
  }

  const filter = makeSmokeFilter();

  return shufflable(
    Object.assign(filter, {
      per(...keys: (string | Alternation)[]) {
        desequenced(filter);
        return shufflable(makeSmokeFilter(...keys));
      },
    }),
  );

  function shufflable<T extends Generation>(
    filter: T,
  ): T & { shuffled(n?: number) } {
    return Object.assign(filter, {
      shuffled(n?: number) {
        return local(counter("shuffle-counter"), shuffle(n)).export(
          desequenced(filter),
          sort("shuffle-counter"),
        );
      },
    });
  }
}

function smalt(context: CaseContext, alternate: Alternation) {
  const alternates = exalternates(context, alternate);

  if (alternates.length == 0) {
    throw new Error("unexpected smoke.per category: no alternates for value");
  }

  if (alternates.length > 1) {
    throw new Error(
      "unexpected smoke.per category: multiple alternates: " + alternates,
    );
  }

  const value = alternates[0];

  if (value && !["string", "number", "boolean"].includes(typeof value)) {
    throw new Error("unexpected smoke.per category type:" + typeof value);
  }

  return value;
}
