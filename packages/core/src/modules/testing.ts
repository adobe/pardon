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
export { semaphore } from "../core/tracking.js";
export type { PardonTestConfiguration } from "../entry/testing/runner.js";
export { verify } from "../entry/testing/assertions.js";
export { createFlow } from "../core/execution/flow/flow.js";
export { trial, gamut, cases } from "../entry/testing/trial.js";

import { FlowContext } from "../core/execution/flow/data/flow-context.js";
import { executeFlow } from "../core/execution/flow/flow.js";
import { FlowName } from "../core/formats/https-fmt.js";
import { TrackingFlowContext } from "../core/execution/flow/data/tracking-flow-context.js";
import { pardonRuntime } from "../runtime/runtime-deferred.js";

export async function execute(
  name: FlowName,
  context: Record<string, unknown>,
  dataFlow: FlowContext = TrackingFlowContext,
): Promise<FlowContext> {
  const runtime = await pardonRuntime();

  return executeFlow(runtime, name, context, dataFlow);
}
