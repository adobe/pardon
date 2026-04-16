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
import type { PardonRuntime } from "../../core/pardon/types.js";
import {
  type PardonAppContextOptions,
  loadPardonRuntime,
} from "./workspace.js";
import { PardonError } from "../../core/error.js";
import { registerPardonLoader } from "../loader/modern/register.js";

/**
 * ensures we have the pardon compiler/loader:
 *  - preferably with the node 20 `import("node:module").register()` api,
 *  - alternatively by spawning a new process with the loader pre-registered.
 *
 * (this should be called early in the command startup process because
 * node before 20.6 will need to be reexecuted and run again through
 * this call.)
 */
export async function establishPardonRuntime(
  options?: PardonAppContextOptions,
) {
  const runtime = await loadPardonRuntime(options);
  await registerModernLoader(runtime);

  return runtime;
}

async function registerModernLoader(runtime: PardonRuntime<"loading">) {
  try {
    await registerPardonLoader(runtime);
  } catch (error: any) {
    console.error("failed to load pardon", error);
    throw new PardonError("error registering pardon loaders", error);
  }
}
