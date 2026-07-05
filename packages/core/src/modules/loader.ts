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
import { join } from "node:path";
import {
  registerHooks,
  type LoadFnOutput,
  type LoadHookSync,
  type ResolveHookSync,
} from "node:module";
import { ts } from "ts-morph";
import { PardonError } from "../core/error.js";
import type { PardonCompiler } from "../runtime/compiler.js";
import type { PardonRuntime } from "../core/pardon/types.js";

export function registerCompiler({
  compiler,
}: Pick<PardonRuntime, "compiler">) {
  return registerHooks(createSyncHooks(compiler));
}

function createSyncHooks(compiler: PardonCompiler): {
  resolve: ResolveHookSync;
  load: LoadHookSync;
} {
  return {
    resolve(specifier, context, nextResolve) {
      const { importAttributes } = context;

      if (specifier === "pardon") {
        return nextResolve("./api.js", {
          ...context,
          parentURL: import.meta.url,
        });
      }

      if (specifier === "pardon/testing") {
        return nextResolve("./testing.js", {
          ...context,
          parentURL: import.meta.url,
        });
      }

      if (specifier.startsWith("pardon:")) {
        const { identity } = context.importAttributes;

        const [, name, index] = /^([^?]*)(?:[?](.*))?$/.exec(identity ?? "")!;

        if (index?.startsWith("-0")) {
          throw new PardonError(
            "cannot import parent from base of script stack",
          );
        }

        if (name === specifier) {
          return {
            importAttributes,
            url: `${name}?${Number(index)}`,
            shortCircuit: true,
          };
        }

        // skip any more resolution, we'll handle this in the loader.
        return { url: specifier, importAttributes, shortCircuit: true };
      }

      const contextURL = context.parentURL?.replace(/[/].*$/, "");

      if (contextURL?.startsWith("pardon:")) {
        if (
          ts.isExternalModuleNameRelative(specifier) &&
          !/[.][a-z]+$/i.test(specifier)
        ) {
          const resolved = new URL(
            specifier,
            `file:///__service__/${context.parentURL!.replace(/^[^/]*[/]/, "")}`,
          ).pathname;

          if (!resolved.startsWith("/__service__/")) {
            throw new PardonError(
              `invalid relative module ${specifier} from ${context.parentURL}`,
            );
          }

          return {
            url: join(contextURL, resolved.replace(/^[/]__service__[/]/, "/")),
            importAttributes,
            shortCircuit: true,
          };
        }

        if (specifier.endsWith(".https")) {
          return nextResolve(specifier, {
            ...context,
            parentURL: import.meta.url,
          });
        }

        return nextResolve(specifier, {
          ...context,
          parentURL: compiler.resolve(specifier, context.parentURL),
        });
      }

      return nextResolve(specifier, context);
    },

    load(url, context, nextLoad) {
      if (
        !url.startsWith("pardon:") &&
        !url.endsWith(".ts") &&
        !url.endsWith(".http") &&
        !url.endsWith(".https") &&
        !url.endsWith(".yaml")
      ) {
        const { parent, ...importAttributesWtihoutParent } =
          context.importAttributes;

        return nextLoad(url, {
          ...context,
          importAttributes: importAttributesWtihoutParent,
        });
      }

      const compiled = compiler.compile(url, context);
      const { importAttributes } = context;

      return {
        format: "module",
        source: compiled,
        importAttributes,
        shortCircuit: true,
      } as LoadFnOutput;
    },
  };
}
