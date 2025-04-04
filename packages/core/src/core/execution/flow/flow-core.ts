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
  composeValuesDict,
  FlowParamsDict,
  flowFunctionSignature,
} from "./flow-params.js";
import { FlowContext } from "./data/flow-context.js";
import { pardonRuntime } from "../../../runtime/runtime-deferred.js";
import { CompiledHttpsSequence } from "./https-flow-types.js";

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
  argument: Record<string, unknown>;
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

async function createFlowContext() {
  return (await pardonRuntime()).createFlowContext();
}

export async function currentFlowContext(context?: FlowContext) {
  return context ?? syncFlowContextStack[0] ?? createFlowContext();
}

export async function runFlow(
  flow: Flow,
  input: Record<string, unknown> = {},
  context?: FlowContext,
) {
  context = await currentFlowContext(context);
  const argument = composeValuesDict(flow.signature, input, {
    ...context.environment,
  });

  return flow.action({
    context,
    argument,
  });
}

export function makeFlow(fn: FlowFunction): Flow {
  const signature = flowFunctionSignature(fn);

  return {
    signature,
    async action({ argument, context }) {
      syncFlowContextStack.unshift(context);

      try {
        return Promise.resolve(fn(argument, { context, signature })).then(
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
