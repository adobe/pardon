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
import { FlowName } from "../../formats/https-fmt.js";
import { PardonContext } from "../../app-context.js";
import { pardonRuntime } from "../../../runtime/runtime-deferred.js";
import { PardonAppContext } from "../../pardon.js";
import { CompiledHttpsSequence, executeHttpsSequence } from "./https-flow.js";
import {
  composeValuesDict,
  FlowParamsDict,
  parseParams,
} from "./flow-params.js";

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

export async function execute(
  name: FlowName,
  context?: Record<string, unknown>,
): Promise<Record<string, any>> {
  if (name.endsWith(".flow")) {
    const { context: appContext } = await pardonRuntime();

    return executeFlow(appContext, name.slice(0, -".flow".length), context);
  }

  throw new Error("execute only supports .flow sequences");
}

function executeFlow(
  appContext: PardonContext,
  name: string,
  context?: Record<string, unknown>,
): Promise<Record<string, any>> {
  const {
    collection: { flows },
  } = appContext;

  if (!flows[name]) {
    throw new Error(`executeFlow(${JSON.stringify(name)}): flow not defined`);
  }

  const { action, params } = compileFlow(appContext, flows[name]);

  const values = composeValuesDict(params, context, { ...environment });

  return executeCallback(
    action(values).then((result) => {
      if (result) {
        environment = result;
      }

      return result;
    }),
  );
}

export function compileFlow(
  { compiler }: PardonAppContext,
  flow: CompiledHttpsSequence,
) {
  return {
    params: flow.params ?? {
      dict: {},
      rested: "",
      required: false,
    },
    async action(values?: Record<string, unknown>) {
      return await executeHttpsSequence({ compiler }, flow, {
        ...environment,
        ...values,
      });
    },
  };
}
