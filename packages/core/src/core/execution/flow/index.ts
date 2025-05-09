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

import { disarm } from "../../../util/promise.js";
import { PardonError } from "../../error.js";
import { FlowName } from "../../formats/https-fmt.js";
import type { FlowContext } from "./data/flow-context.js";
import {
  Flow,
  currentFlowContext,
  FlowResult,
  runFlow,
  FlowFunction,
  FlowParams,
} from "./flow-core.js";
export type {
  FlowParam,
  FlowParamsDict,
  FlowParamsList,
  FlowParamsItem,
} from "./flow-params.js";

export type {
  Flow,
  FlowContext,
  FlowName,
  FlowResult,
  FlowFunction,
  FlowParams,
};

let flowHook: <T>(p: Promise<T>) => Promise<T> = (p) => p;

export function registerFlowHook(hook: typeof flowHook) {
  flowHook = hook;
}

export function flow(
  name: FlowName,
  input?: Record<string, unknown>,
  context?: FlowContext,
) {
  return disarm(flowHook(__flow(name, input, context)));
}

async function __flow(
  name: FlowName,
  input?: Record<string, unknown>,
  context?: FlowContext,
) {
  context ??= await currentFlowContext(context);
  const { result } = await executeFlowInContext(name, input ?? {}, context);
  return result;
}

export function executeFlowInContext(
  name: FlowName,
  input: Record<string, unknown>,
  context: FlowContext,
) {
  const flow = context.runtime.collection.flows[name];

  if (!flow) {
    throw new PardonError(`no flow named ${name}`);
  }

  return runFlow(flow, input, context);
}
