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
import type {
  InitializeHook,
  LoadFnOutput,
  LoadHook,
  ResolveHook,
} from "node:module";
import { ts } from "ts-morph";
import { createIpcSender } from "../runtime/loader/modern/ipc.js";
import { createRpcSender } from "../runtime/loader/legacy/rpc-register.js";
import { PardonError } from "../core/error.js";

let ipc: ReturnType<typeof createIpcSender>;
let rpc: ReturnType<typeof createRpcSender>;

function host() {
  return ipc ?? (rpc ??= createRpcSender());
}

export const initialize: InitializeHook = async ({ port }) => {
  ipc = createIpcSender(port);
  ipc.ready();
};

export const resolve: ResolveHook = async (specifier, context, nextResolve) => {
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
    // skip any more resolution, we'll handle this in the loader.
    return { url: specifier, shortCircuit: true };
  }

  if (context.parentURL?.startsWith("pardon:")) {
    if (
      ts.isExternalModuleNameRelative(specifier) &&
      !/[.][a-z]+$/i.test(specifier)
    ) {
      const resolved = new URL(
        specifier,
        `file:///__service__/${context.parentURL.replace(/^[^/]*[/]/, "")}`,
      ).pathname;

      if (!resolved.startsWith("/__service__/")) {
        throw new PardonError(
          `invalid relative module ${specifier} from ${context.parentURL}`,
        );
      }

      return {
        url: join(
          context.parentURL.replace(/[/].*$/, ""),
          resolved.replace(/^[/]__service__[/]/, "/"),
        ),
        shortCircuit: true,
      };
    }

    if (specifier.endsWith(".https")) {
      return nextResolve(`${specifier}`, {
        ...context,
        parentURL: import.meta.url,
      });
    }

    return nextResolve(specifier, {
      ...context,
      parentURL: await host().send("resolve", specifier, context.parentURL),
    });
  }

  return nextResolve(specifier, context);
};

export const load: LoadHook = async (url, context, nextLoad) => {
  if (
    !url.startsWith("pardon:") &&
    !url.endsWith(".ts") &&
    !url.endsWith(".http") &&
    !url.endsWith(".https") &&
    !url.endsWith(".yaml")
  ) {
    return nextLoad(url, context);
  }

  const compiled = (await host().send("compile", url, context)) as string;

  return {
    format: "module",
    source: compiled,
    shortCircuit: true,
  } as LoadFnOutput;
};
