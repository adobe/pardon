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

import deferred, { Deferred } from "../../../../util/deferred.js";
import { PardonRuntime } from "../../../pardon/types.js";
import { FlowContext } from "./flow-context.js";

export function manualFlowContext(
  runtime: PardonRuntime,
  env: Record<string, unknown>,
  aborted: Deferred<unknown> & { reason?: unknown } = deferred(),
): FlowContext {
  return {
    runtime,
    mergeWithContext(other) {
      return manualFlowContext(
        runtime,
        { ...env, ...other.environment },
        aborted,
      );
    },
    mergeEnvironment(data) {
      return manualFlowContext(runtime, { ...env, ...data }, aborted);
    },
    overrideEnvironment(data) {
      return manualFlowContext(runtime, { ...data }, aborted);
    },
    get environment() {
      return env;
    },
    abort(reason) {
      if (aborted.reason === undefined) {
        aborted.reason = reason;
        aborted.resolution.reject(reason);
      }
    },
    checkAborted() {
      if (aborted.reason !== undefined) {
        throw aborted.reason;
      }
    },
    aborting() {
      return aborted.promise;
    },
    pending: (p) => p,
  };
}
