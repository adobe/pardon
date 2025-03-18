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
export {
  loadTests,
  executeTest,
  filterTestPlanning,
} from "../entry/testing/runner.js";
export { initTrackingEnvironment } from "../runtime/environment.js";

export {
  flushTrialRegistry,
  runRegistrationTask,
  withGamutConfiguration as withGamutConfiguration,
} from "../entry/testing/trial.js";

export {
  applySmokeConfig,
  parseSmokeConfig,
  type SmokeConfig,
} from "../entry/testing/smoke-config.js";

export {
  default as describeCases,
  type CaseContext,
} from "../core/testcases/index.js";

export {
  default as failfast,
  executeWithFastFail,
  checkFastFailed,
  notifyFastFailed,
} from "../core/execution/flow/failfast.js";

export { type CompiledHttpsSequence } from "../core/execution/flow/https-flow-types.js";

export {
  all_disconnected,
  disconnected,
  semaphore,
  shared,
} from "../core/tracking.js";
