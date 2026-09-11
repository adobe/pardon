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
  type FlowParamsDict,
  composeValuesDict,
  flowFunctionSignature,
} from "./flow-params.js";
import {
  type FlowContext,
  createFlowContext as buildFlowContext,
} from "./flow-context.js";
import {
  type FlowFrame,
  type FlowFrameInfo,
  makeFlowFrame,
} from "./flow-report.js";
import type { CompiledHttpsSequence } from "./https-flow-types.js";
import { pardonRuntime } from "../../../runtime/runtime-deferred.js";
import deferred from "../../../util/deferred.js";

/**
 * - Flows -
 *
 * A flow is an async function that transforms input data to output data.
 * The data is passed both explicitly in the argument of the function,
 * and implicitly via the flowContext environment.
 *
 * A flow can be predicated on other flows for some of their data.
 * For the flowContext environment to apply, these must be started at the top of the
 * flow function before any awaiting is done.
 *
 * Flows can be described in https format as a sequence of requests and response
 * matchers.  They can also be described in javascript/typescript.  In the latter
 * case the function is converted to a string an reparsed to determine how the input
 * is destructured: Only destructured-in-parameter values are inferred from the
 * flow environment if not passed explicitly.
 *
 * All flow data is non-secret.
 */

export type FlowFunction = (
  values: Record<string, any>,
  extra: { context: FlowContext; signature: FlowParamsDict },
) => Promise<Record<string, unknown>>;

export type FlowParams = {
  context: FlowContext;
  input: Record<string, unknown>;
};

export type FlowResult = {
  context: FlowContext;
  result: Record<string, unknown>;
};

export type Flow = {
  action(params: FlowParams): Promise<FlowResult>;
  signature: FlowParamsDict;
  source?: FlowFunction | CompiledHttpsSequence;
};

const syncFlowContextStack: FlowContext[] = [];

let ambientRootResolver:
  | (() => FlowContext | undefined)
  | (() => Promise<FlowContext>) = () => createFlowContext();

export function setAmbientFlowContextResolver(
  resolver: () => FlowContext | undefined,
) {
  ambientRootResolver = resolver;
}

async function createFlowContext() {
  return (await pardonRuntime()).createFlowContext();
}

export async function currentFlowContext(context?: FlowContext) {
  return (
    context ??
    syncFlowContextStack[0] ??
    ambientRootResolver() ??
    createFlowContext()
  );
}

/**
 * Build a fresh root FlowContext carrying a report frame. The caller decides how
 * to make it ambient (the test runner stores it in per-trial async-local state
 * so top-level `flow()` calls resolve to it via the injected resolver).
 */
export async function createRootFlowContext(
  info: FlowFrameInfo,
): Promise<{ context: FlowContext; report: FlowFrame }> {
  const runtime = await pardonRuntime();
  const report = makeFlowFrame(info);
  const context = buildFlowContext(runtime, {}, {}, deferred(), report);
  return { context, report };
}

export async function runFlow(
  flow: Flow,
  values: Record<string, unknown>,
  context?: FlowContext,
) {
  context = await currentFlowContext(context);
  const input = composeValuesDict(flow.signature, values, {
    ...context.context,
  });

  const type = flow.source && "interactions" in flow.source ? "flow" : "unit";
  const name =
    (flow.source && "name" in flow.source && flow.source.name) || "flow";

  context = context.enterFlow({ type, name, values: input });
  const { report } = context;

  try {
    const result = await flow.action({ context, input });
    report?.finish({ result: result.result });
    return result;
  } catch (error) {
    report?.finish({ error });
    throw error;
  }
}

export function makeFlow(fn: FlowFunction): Flow {
  const signature = flowFunctionSignature(fn);

  return {
    signature,
    async action({ input, context }) {
      syncFlowContextStack.unshift(context);

      try {
        return Promise.resolve(fn(input, { context, signature })).then(
          (result) => ({
            result,
            context,
          }),
        );
      } finally {
        syncFlowContextStack.shift();
      }
    },
    source: fn,
  };
}
