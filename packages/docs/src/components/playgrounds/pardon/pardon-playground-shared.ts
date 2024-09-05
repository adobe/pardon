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

import type { ApplicationContext } from "@components/playgrounds/pardon/PardonApplication";
import { PardonFetchExecution, pardonExecutionHandle } from "pardon/playground";
import { type pardon as pardonFn } from "pardon";
import { createMemo, type Accessor } from "solid-js";
export { deferred } from "pardon/utils";

export type ExecutionHandle = ReturnType<typeof createExecutionMemo>;
export type ExecutionContinuation = Exclude<
  ReturnType<ExecutionHandle>["execution"],
  undefined
>;

export type PlaygroundOptions = {
  secrets?: boolean | "shown";
  values?: boolean | string;
  editor?: boolean | string;
  data?: boolean;
  response?: boolean;
  server?: "products";
};

export function createExecutionMemo({
  context,
  FetchExecution,
  input,
  env,
  restart,
  runtime,
}: {
  context: Accessor<{ application: ApplicationContext } | { error: unknown }>;
  input: Accessor<string>;
  env: Accessor<Record<string, unknown>>;
  FetchExecution: typeof PardonFetchExecution;
  restart: Accessor<object>;
  runtime?: (pardon: typeof pardonFn) => Record<string, unknown>;
}) {
  const commonRuntime = {
    delayed: (time: number, value: unknown) =>
      new Promise((resolve) => setTimeout(() => resolve(value), time)),
    async serviceToken(env: string) {
      await new Promise((resolve) => setTimeout(resolve, 700));

      return `service-token-${env}-${`${Date.now()}`.slice(-5)}`;
    },
    async digest(value: string) {
      return Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(value),
          ),
        ),
      )
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    },
  };

  const setup = createMemo(() => {
    const ctx = context();

    if ("error" in ctx) {
      return { error: ctx.error };
    }

    const { compiler, collection } = ctx.application;

    const pardon: typeof pardonFn = (values = {}, executionContext) => {
      return pardonExecutionHandle({
        FetchExecution,
        context: {
          app: () => ctx.application,
          durations: {},
          timestamps: {},
          ...executionContext,
          values,
          options: { pretty: true, ...executionContext?.options },
          runtime: {
            ...commonRuntime,
            ...executionContext?.runtime,
          },
        },
      });
    };

    compiler.import = async (sp, pa) => {
      let resolved = compiler.resolve(sp, pa);
      const configuration =
        collection.configurations[resolved.replace(/^pardon:/, "")];

      if (configuration?.export) {
        resolved = compiler.resolve(
          configuration.export,
          `pardon:${configuration.path}`,
        );
      }

      // hack for scripting.mdx
      if (resolved === "pardon:example/products/products-helper.ts") {
        return {
          async price({ product, env }: { product: string; env: string }) {
            const {
              inbound: {
                values: { price },
              },
            } = await pardon({
              product,
              env,
            })`https://example.com/products/{{product}}`();

            return price;
          },
        };
      }

      console.warn(`no playground import definition for ${resolved}`);
    };

    return { pardon };
  });

  return createMemo(() => {
    const ctx = setup();

    if ("error" in ctx) {
      return { error: ctx.error };
    }

    const { pardon } = ctx;

    try {
      const handle = pardon(env(), {
        runtime: runtime?.(pardon),
      });
      const http = input();
      const execution = http ? handle`${input()}`.init() : handle.match("");

      restart();

      return { execution };
    } catch (error) {
      return { error };
    }
  });
}
