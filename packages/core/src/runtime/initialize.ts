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
import { PardonAppContextOptions } from "../core/app-context.js";
import { establishPardonRuntime } from "./init/establish.js";
import { PardonFetchExecution } from "../core/pardon.js";
import { resolveRuntime } from "./runtime-deferred.js";

export type FeatureHook<T> = (_: T) => T;

// this is only exported via pardon/runtime, but it's here since it initializes
// the FetchExecution backing the api functions.
export async function initializePardon(
  options: PardonAppContextOptions,
  featureHooks: (
    | FeatureHook<typeof PardonFetchExecution>
    | false
    | null
    | undefined
  )[] = [],
) {
  const context = await establishPardonRuntime(options);

  // compose the basic pardon execution with feature hooks.
  // execution-hook.ts provides the framework to create hooks.
  const execution = featureHooks
    .filter(Boolean)
    .reduce((execution, feature) => feature(execution), PardonFetchExecution);

  // resolve the runtime promise so other
  // modules can receive these values.
  // (currently only internal modules are allowed to receive these)
  resolveRuntime({ context, execution });

  // Ideas:
  //  - simplify: move execution into the app context, or
  //  - flexibility: make hooks dynamic per-request.

  return context;
}
