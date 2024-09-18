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

export { KV } from "../core/formats/kv-fmt.js";

export { PardonFetchExecution } from "../core/pardon.js";
export { pardonExecutionHandle } from "../api/pardon-wrapper.js";

export {
  resolvePardonApplicationCollection,
  type PardonAppContextOptions,
} from "../core/app-context.js";

export { hookExecution } from "../core/execution/execution-hook.js";
export {
  intoFetchParams,
  intoResponseObject,
} from "../core/request/fetch-pattern.js";
export { getContextualValues } from "../core/schema/core/context.js";

export {
  default as describeCases,
  type CaseContext,
} from "../entry/testing/testcases/index.js";

export { cases, gamut, trial } from "./testing.js";
export {
  flushTrialRegistry,
  runRegistrationTask,
  withGamutConfiguration,
} from "../entry/testing/trial.js";
export {
  applySmokeConfig,
  parseSmokeConfig,
  type SmokeConfig,
} from "../entry/testing/smoking.js";
