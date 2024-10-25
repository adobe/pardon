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
import type { pardon, template } from "../../api/pardon-wrapper.js";
import { definedObject } from "../../util/mapping.js";
import { disarm } from "../../util/promise.js";
import { shared } from "../../core/tracking.js";
import { resolve } from "node:path";
import { ts } from "ts-morph";

type PardonResult = Awaited<ReturnType<ReturnType<ReturnType<typeof pardon>>>>;

type OutcomeMapping<T> = Record<
  string,
  (result: PardonResult) => T | Promise<T>
>;

export function bindHttp(meta: ImportMeta, parent?: string) {
  return (
    path: string,
    values?: Record<string, unknown>,
    extraInit?: Parameters<typeof pardon>[1],
  ) =>
    httpFn(
      meta,
      parent && new URL(meta.resolve(parent)).pathname,
      path,
      definedObject({ ...values }),
      extraInit,
    );
}

function httpFn(
  meta: ImportMeta,
  parent: string | undefined,
  path: string,
  values: Record<string, unknown>,
  extraInit: Parameters<typeof pardon>[1] = {},
): Promise<PardonResult> & {
  outcome<T>(
    mapping: OutcomeMapping<T>,
    state?: {
      retries?: number;
      delay?: (retry: number) => number | Promise<void>;
    },
  ): Promise<Awaited<ReturnType<OutcomeMapping<T>[string]>>>;
} {
  const promise: Promise<PardonResult> = shared(
    () =>
      import(
        meta.resolve(
          parent || ts.isExternalModuleNameRelative(path)
            ? resolve(parent ?? ".", `${path}.http`)
            : `${path}.http`,
        )
      ),
  ).then(
    ({ default: httpTemplate }: { default: ReturnType<typeof template> }) =>
      httpTemplate({ ...environment, ...values }, extraInit),
  );

  return Object.assign(promise, {
    async outcome<T>(
      outcomeMapping: OutcomeMapping<T>,
      { retry = 0, retries = 0, delay = () => 1000 } = {},
    ) {
      const result = await promise;
      const { outcome = "default" } = result.inbound;
      const outcomeProcessor =
        outcomeMapping[outcome] ?? outcomeMapping.default;

      if (outcomeProcessor == null) {
        throw new Error(`unexpected outcome from ${path}: ${outcome}`);
      }

      try {
        const response = await outcomeProcessor(result);
        if (response === "retry") {
          throw response;
        }
        return response;
      } catch (error) {
        if (error === "retry" && retry < retries) {
          await waitFor(delay());
          return (await httpFn(meta, parent, path, values, extraInit).outcome(
            outcomeMapping,
            {
              retry: retry + 1,
              retries,
              delay,
            } as any,
          )) as any; // typescript gets confused by this.
        }

        return disarm(Promise.reject(error));
      }
    },
  });
}

function waitFor(delay: number | Promise<void>): Promise<void> {
  if (typeof delay === "number") {
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  return delay;
}
