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
import { AsyncLocalStorage } from "async_hooks";
import { PardonHttpExecutionContext } from "../../../features/remember.js";
import {
  hookExecution,
  PardonFetchExecution,
} from "../../../modules/playground.js";
import { PardonError } from "../../../core/error.js";
import deferred, { Deferred } from "../../../util/deferred.js";

const fornever = new Promise(() => {});

const ffContext = new AsyncLocalStorage<{
  error?: Error;
  failure: Deferred<Error>;
}>();

export function checkFastFailed() {
  const { error } = ffContext.getStore() || {};
  if (error) {
    throw new PardonError(`aborting test: ${error}`);
  }
}

// Use Promise.race() with this for test delay promise.
export function pendingFastFailure() {
  const store = ffContext.getStore();

  return store?.failure.promise ?? fornever;
}

export function notifyFastFailed(error: Error | unknown) {
  const store = ffContext.getStore();

  if (store && !store.error) {
    if (!(error instanceof Error || (error as Error)?.["message"])) {
      error = new Error(`on ${error}`);
    }

    store.error = error as Error;
    store.failure.resolution.reject(error);
  }
}

export function executeWithFastFail<T>(fn: () => Promise<T>) {
  return ffContext.run({ failure: deferred() }, () => fn());
}

export default function failfast(
  execution: typeof PardonFetchExecution,
): typeof PardonFetchExecution {
  return hookExecution<PardonHttpExecutionContext, typeof PardonFetchExecution>(
    execution,
    {
      init() {
        checkFastFailed();
        return undefined!; // fix typing for hooks to allow voids
      },
    },
  );
}
