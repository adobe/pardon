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
import { PardonAppContext } from "../../pardon/pardon.js";
import { CompiledHttpsSequence, executeHttpsSequence } from "./https-flow.js";
import {
  composeValuesDict,
  FlowParamsDict,
  parseParams,
} from "./flow-params.js";
import { FlowContext } from "./data/flow-context.js";
import { TrackingFlowContext } from "./data/tracking-flow-context.js";
import { PardonRuntime } from "../../pardon/types.js";

export type FlowOptions = { target?: string };

export type FlowFn = (
  values: Record<string, any>,
) => Promise<void | undefined | Record<string, any>>;

type FlowAction = {
  action: (
    values: Record<string, unknown>,
    key: string,
  ) => Promise<Record<string, any>>;
  params: FlowParamsDict;
};

let executeCallback: <T>(_: Promise<T>) => Promise<T> = (p) => p;

export function onExecute(callback: typeof executeCallback) {
  executeCallback = (promise) => disarm(callback(promise));
}

export function createFlow(fn: FlowFn): FlowAction {
  return {
    params: parseParams(fn),
    async action(values = {}) {
      await (null! as Promise<void>);

      return (await fn(values)) || {};
    },
  };
}

export function executeFlow(
  runtime: PardonRuntime,
  name: string,
  context: Record<string, unknown>,
  dataFlow: FlowContext,
): Promise<FlowContext> {
  const {
    collection: { flows },
  } = runtime;

  if (!flows[name]) {
    throw new Error(`executeFlow(${JSON.stringify(name)}): flow not defined`);
  }

  const { action, params } = compileFlow(runtime, flows[name]);

  const values = composeValuesDict(params, context, {
    ...dataFlow.environment,
  });

  return executeCallback(action(values));
}

export function compileFlow(
  { compiler }: PardonAppContext,
  flow: CompiledHttpsSequence,
  dataFlow: FlowContext = TrackingFlowContext,
) {
  return {
    params: flow.params ?? {
      dict: {},
      rested: "",
      required: false,
    },
    async action(values?: Record<string, unknown>) {
      await (null! as Promise<any>);
      dataFlow = dataFlow.mergeEnvironment(values);

      return await executeHttpsSequence({ compiler }, flow, dataFlow);
    },
  };
}
