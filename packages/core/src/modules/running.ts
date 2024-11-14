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
export { loadTests, executeTest, filterTestPlanning } from "../entry/testing/cli/runner.js";
export { initTrackingEnvironment } from "../runtime/environment.js";
export { sequenceRegistry } from "../entry/testing/sequence.js";

export {
  awaitedSequences,
  awaitedSteps,
} from "../entry/testing/https-sequence.js";

export {
  flushTrialRegistry,
  runRegistrationTask,
  withGamutConfiguration as withGamutConfiguration,
} from "../entry/testing/trial.js";

export {
  applySmokeConfig,
  parseSmokeConfig,
  type SmokeConfig,
} from "../entry/testing/smoking.js";

export {
  default as describeCases,
  type CaseContext,
} from "../entry/testing/testcases/index.js";

export {
  default as failfast,
  executeWithFastFail,
  checkFastFailed,
  notifyFastFailed,
} from "../entry/testing/cli/failfast.js";

export {
  registerSequenceNotificationHooks,
  type CompiledHttpsSequence,
} from "../entry/testing/https-sequence.js";

export {
  all_disconnected,
  disconnected,
  semaphore,
  shared,
} from "../core/tracking.js";
