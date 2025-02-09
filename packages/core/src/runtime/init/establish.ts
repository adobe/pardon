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
import {
  PardonContext,
  PardonAppContextOptions,
  createPardonApplicationContext,
} from "../../core/app-context.js";
import {
  awaitChildProcess,
  hostRpcChild,
} from "../loader/legacy/rpc-register.js";
import createCompiler from "../compiler.js";
import { PardonError } from "../../core/error.js";
import { registerPardonLoader } from "../loader/modern/register.js";

/**
 * ensures we have the pardon compiler/loader:
 *  - preferably with the node 20 `import("node:module").register()` api,
 *  - alternatively by spawning a new process with the loader pre-registered.
 *
 * (this should be called early in the command startup process because
 * node before 20.6 will need to be reexcuted and run again through
 * this call.)
 */
export async function establishPardonRuntime(
  options?: PardonAppContextOptions,
) {
  const [major, minor] = process.version
    .split(".")
    .map((v) => Number(v.replace(/[^\d]/g, "")));

  if (major > 20 || (major == 20 && minor >= 6)) {
    const context = await createPardonApplicationContext(options);
    await registerModernLoader(context);
    return context;
  }

  // otherwise we're here the first time as the host or the second time
  // as the spawned child process.

  if (!process.send) {
    const context = await createPardonApplicationContext(options);

    // no process.send, we're in the host process:
    // we create a compiler with the current context and
    // pass that to the child.
    const child = hostRpcChild(createCompiler(context));

    // wait for it
    process.exit(await awaitChildProcess(child));
  } else {
    // if process.send is present: we are the child process.
    //
    // we could, (as an optimization), have for the host process send
    // the context here rather than re-doing the loading work.
    return await createPardonApplicationContext(options);
  }
}

async function registerModernLoader(context: PardonContext) {
  try {
    await registerPardonLoader(context);
  } catch (error) {
    console.error("failed to load pardon", error);
    throw new PardonError("error registering pardon loaders", error);
  }
}
